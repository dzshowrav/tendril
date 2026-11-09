import {
  ProviderAdapter,
  ProviderStreamRequest,
  ProviderEvent,
  Message,
  StopReason,
} from './types.js';
import { parseSSEStream } from './sse.js';
import { fetchWithRetry, RetryOptions } from './retry.js';

export interface OpenAICompatibleAdapterOptions {
  apiKey?: string | null;
  baseUrl?: string | null;
  retryOptions?: RetryOptions;
}

interface ActiveToolCall {
  index: number;
  id: string;
  name: string;
  argumentsJson: string;
}

export class OpenAICompatibleAdapter implements ProviderAdapter {
  private apiKey?: string | null;
  private baseUrl: string;
  private retryOptions?: RetryOptions;

  constructor(options: OpenAICompatibleAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    this.retryOptions = options.retryOptions;
  }

  public async *stream(req: ProviderStreamRequest): AsyncIterable<ProviderEvent> {
    const endpoint = `${this.baseUrl}/chat/completions`;

    const { messages, promptChars } = this.formatMessages(req.system, req.messages);

    const tools = req.tools?.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));

    const body: Record<string, unknown> = {
      model: req.model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
    }
    if (req.maxOutputTokens) {
      body.max_tokens = req.maxOutputTokens;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    let response: Response;
    try {
      response = await fetchWithRetry(
        endpoint,
        {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: req.signal,
        },
        this.retryOptions,
      );
    } catch (err) {
      yield { type: 'error', error: err as Error };
      return;
    }

    if (!response.ok) {
      let errText = '';
      try {
        errText = await response.text();
      } catch {}
      const error = new Error(`OpenAI API error (${response.status}): ${errText}`);
      yield { type: 'error', error };
      yield { type: 'stop', reason: 'error' };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: new Error('Empty response body from OpenAI API') };
      return;
    }

    let generatedChars = 0;
    let reportedUsage: { inputTokens: number; outputTokens: number; cachedTokens?: number } | null = null;
    let stopReason: StopReason = 'end_turn';

    const activeTools = new Map<number, ActiveToolCall>();

    try {
      for await (const sse of parseSSEStream(response.body, req.signal)) {
        if (req.signal?.aborted) {
          yield { type: 'stop', reason: 'aborted' };
          return;
        }
        if (!sse.data) continue;
        if (sse.data.trim() === '[DONE]') break;

        let parsed: any;
        try {
          parsed = JSON.parse(sse.data);
        } catch {
          continue;
        }

        // 1. Capture usage if reported
        if (parsed.usage) {
          reportedUsage = {
            inputTokens: parsed.usage.prompt_tokens ?? 0,
            outputTokens: parsed.usage.completion_tokens ?? 0,
            cachedTokens: parsed.usage.prompt_tokens_details?.cached_tokens ?? 0,
          };
        }

        const choice = parsed.choices?.[0];
        if (!choice) continue;

        // 2. Text delta
        if (choice.delta?.content) {
          const text = choice.delta.content;
          generatedChars += text.length;
          yield { type: 'text_delta', text };
        }

        // 3. Tool call fragments reassembly
        if (choice.delta?.tool_calls) {
          for (const tc of choice.delta.tool_calls) {
            const index = tc.index ?? 0;
            let active = activeTools.get(index);

            if (!active) {
              active = {
                index,
                id: tc.id || `call_${index}`,
                name: tc.function?.name || '',
                argumentsJson: '',
              };
              activeTools.set(index, active);
              yield {
                type: 'tool_use_start',
                id: active.id,
                name: active.name,
              };
            } else if (tc.function?.name && !active.name) {
              active.name = tc.function.name;
            }

            if (tc.function?.arguments) {
              const delta = tc.function.arguments;
              active.argumentsJson += delta;
              yield {
                type: 'tool_use_input_delta',
                id: active.id,
                delta,
              };
            }
          }
        }

        // 4. Finish reason
        if (choice.finish_reason) {
          stopReason = this.mapFinishReason(choice.finish_reason);
        }
      }

      if (req.signal?.aborted) {
        yield { type: 'stop', reason: 'aborted' };
        return;
      }

      // Finalize any active tool calls
      for (const [_, tool] of activeTools) {
        let input: unknown = {};
        try {
          input = tool.argumentsJson ? JSON.parse(tool.argumentsJson) : {};
        } catch {
          input = { raw: tool.argumentsJson };
        }
        yield {
          type: 'tool_use_end',
          id: tool.id,
          name: tool.name,
          input,
        };
      }

      // Usage event: use reported usage or fallback to token estimation (ceil(chars / 4))
      if (reportedUsage) {
        yield {
          type: 'usage',
          inputTokens: reportedUsage.inputTokens,
          outputTokens: reportedUsage.outputTokens,
          cachedTokens: reportedUsage.cachedTokens,
        };
      } else {
        yield {
          type: 'usage',
          inputTokens: Math.ceil(promptChars / 4),
          outputTokens: Math.ceil(generatedChars / 4),
        };
      }

      yield {
        type: 'stop',
        reason: stopReason,
      };
    } catch (err) {
      if (req.signal?.aborted) {
        yield { type: 'stop', reason: 'aborted' };
      } else {
        yield { type: 'error', error: err as Error };
        yield { type: 'stop', reason: 'error' };
      }
    }
  }

  private formatMessages(
    system: string,
    messages: Message[],
  ): { messages: any[]; promptChars: number } {
    const formatted: any[] = [];
    let promptChars = 0;

    if (system) {
      formatted.push({ role: 'system', content: system });
      promptChars += system.length;
    }

    for (const m of messages) {
      if (m.role === 'user') {
        const textParts: string[] = [];
        for (const b of m.content) {
          if (b.type === 'text') {
            textParts.push(b.text);
            promptChars += b.text.length;
          } else if (b.type === 'tool_result') {
            formatted.push({
              role: 'tool',
              tool_call_id: b.toolUseId,
              content: b.content,
            });
            promptChars += b.content.length;
          }
        }
        if (textParts.length > 0) {
          formatted.push({
            role: 'user',
            content: textParts.join('\n'),
          });
        }
      } else if (m.role === 'assistant') {
        let contentText = '';
        const toolCalls: any[] = [];

        for (const b of m.content) {
          if (b.type === 'text') {
            contentText += b.text;
            promptChars += b.text.length;
          } else if (b.type === 'tool_use') {
            const argsStr = JSON.stringify(b.input || {});
            promptChars += b.name.length + argsStr.length;
            toolCalls.push({
              id: b.id,
              type: 'function',
              function: {
                name: b.name,
                arguments: argsStr,
              },
            });
          }
        }

        formatted.push({
          role: 'assistant',
          content: contentText || null,
          tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
        });
      }
    }

    return { messages: formatted, promptChars };
  }

  private mapFinishReason(reason: string): StopReason {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'tool_calls':
      case 'function_call':
        return 'tool_use';
      case 'length':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }
}
