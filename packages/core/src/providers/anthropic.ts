import {
  ProviderAdapter,
  ProviderStreamRequest,
  ProviderEvent,
  Block,
  Message,
  StopReason,
} from './types.js';
import { parseSSEStream } from './sse.js';
import { fetchWithRetry, RetryOptions } from './retry.js';

export interface AnthropicAdapterOptions {
  apiKey: string;
  baseUrl?: string | null;
  retryOptions?: RetryOptions;
}

export class AnthropicAdapter implements ProviderAdapter {
  private apiKey: string;
  private baseUrl: string;
  private retryOptions?: RetryOptions;

  constructor(options: AnthropicAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '');
    this.retryOptions = options.retryOptions;
  }

  public async *stream(req: ProviderStreamRequest): AsyncIterable<ProviderEvent> {
    const endpoint = `${this.baseUrl}/messages`;

    // 1. Prepare system block with cache_control
    const system = req.system
      ? [
          {
            type: 'text',
            text: req.system,
            cache_control: { type: 'ephemeral' },
          },
        ]
      : undefined;

    // 2. Prepare tools with cache_control on the last tool
    const tools = req.tools?.map((tool, idx, arr) => {
      const toolSpec: Record<string, unknown> = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      };
      if (idx === arr.length - 1) {
        toolSpec.cache_control = { type: 'ephemeral' };
      }
      return toolSpec;
    });

    // 3. Prepare messages and prompt-caching marker on the last user message
    const formattedMessages = this.formatMessages(req.messages);

    const body = {
      model: req.model,
      system,
      messages: formattedMessages,
      tools: tools && tools.length > 0 ? tools : undefined,
      max_tokens: req.maxOutputTokens ?? 4096,
      stream: true,
    };

    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'content-type': 'application/json',
    };

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
      const error = new Error(`Anthropic API error (${response.status}): ${errText}`);
      yield { type: 'error', error };
      yield { type: 'stop', reason: 'error' };
      return;
    }

    if (!response.body) {
      yield { type: 'error', error: new Error('Empty response body from Anthropic API') };
      return;
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedTokens = 0;
    let stopReason: StopReason = 'end_turn';

    let activeToolUse: { id: string; name: string; inputJson: string } | null = null;

    try {
      for await (const sse of parseSSEStream(response.body, req.signal)) {
        if (req.signal?.aborted) {
          yield { type: 'stop', reason: 'aborted' };
          return;
        }
        if (!sse.data) continue;

        let parsed: any;
        try {
          parsed = JSON.parse(sse.data);
        } catch {
          continue;
        }

        const eventType = sse.event || parsed.type;

        switch (eventType) {
          case 'message_start':
            if (parsed.message?.usage) {
              inputTokens = parsed.message.usage.input_tokens ?? 0;
              const cacheRead = parsed.message.usage.cache_read_input_tokens ?? 0;
              const cacheCreation = parsed.message.usage.cache_creation_input_tokens ?? 0;
              cachedTokens = cacheRead + cacheCreation;
            }
            break;

          case 'content_block_start':
            if (parsed.content_block?.type === 'tool_use') {
              activeToolUse = {
                id: parsed.content_block.id,
                name: parsed.content_block.name,
                inputJson: '',
              };
              yield {
                type: 'tool_use_start',
                id: activeToolUse.id,
                name: activeToolUse.name,
              };
            }
            break;

          case 'content_block_delta':
            if (parsed.delta?.type === 'text_delta') {
              yield {
                type: 'text_delta',
                text: parsed.delta.text,
              };
            } else if (parsed.delta?.type === 'input_json_delta' && activeToolUse) {
              const delta = parsed.delta.partial_json || '';
              activeToolUse.inputJson += delta;
              yield {
                type: 'tool_use_input_delta',
                id: activeToolUse.id,
                delta,
              };
            }
            break;

          case 'content_block_stop':
            if (activeToolUse) {
              let parsedInput: unknown = {};
              try {
                parsedInput = activeToolUse.inputJson ? JSON.parse(activeToolUse.inputJson) : {};
              } catch {
                parsedInput = { raw: activeToolUse.inputJson };
              }
              yield {
                type: 'tool_use_end',
                id: activeToolUse.id,
                name: activeToolUse.name,
                input: parsedInput,
              };
              activeToolUse = null;
            }
            break;

          case 'message_delta':
            if (parsed.delta?.stop_reason) {
              stopReason = this.mapStopReason(parsed.delta.stop_reason);
            }
            if (parsed.usage?.output_tokens) {
              outputTokens = parsed.usage.output_tokens;
            }
            break;

          case 'message_stop':
            yield {
              type: 'usage',
              inputTokens,
              outputTokens,
              cachedTokens,
            };
            yield {
              type: 'stop',
              reason: stopReason,
            };
            break;

          case 'error':
            yield {
              type: 'error',
              error: new Error(parsed.error?.message || 'Unknown Anthropic error'),
            };
            yield { type: 'stop', reason: 'error' };
            return;
        }
      }

      if (req.signal?.aborted) {
        yield { type: 'stop', reason: 'aborted' };
        return;
      }
    } catch (err) {
      if (req.signal?.aborted) {
        yield { type: 'stop', reason: 'aborted' };
      } else {
        yield { type: 'error', error: err as Error };
        yield { type: 'stop', reason: 'error' };
      }
    }
  }

  private formatMessages(messages: Message[]): any[] {
    const formatted = messages.map((m) => {
      const content = m.content.map((b) => this.formatBlock(b));
      return {
        role: m.role,
        content,
      };
    });

    // Mark the last user message's last block with cache_control
    for (let i = formatted.length - 1; i >= 0; i--) {
      if (formatted[i].role === 'user' && formatted[i].content.length > 0) {
        const lastBlock = formatted[i].content[formatted[i].content.length - 1];
        lastBlock.cache_control = { type: 'ephemeral' };
        break;
      }
    }

    return formatted;
  }

  private formatBlock(block: Block): any {
    switch (block.type) {
      case 'text':
        return { type: 'text', text: block.text };
      case 'tool_use':
        return {
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input,
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: block.toolUseId,
          content: block.content,
          is_error: block.isError,
        };
    }
  }

  private mapStopReason(reason: string): StopReason {
    switch (reason) {
      case 'end_turn':
      case 'stop_sequence':
        return 'end_turn';
      case 'tool_use':
        return 'tool_use';
      case 'max_tokens':
        return 'max_tokens';
      default:
        return 'end_turn';
    }
  }
}
