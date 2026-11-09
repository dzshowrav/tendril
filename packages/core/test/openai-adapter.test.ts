import { describe, it, expect, vi } from 'vitest';
import { OpenAICompatibleAdapter } from '../src/providers/openai-compatible.js';
import { ProviderEvent } from '../src/providers/types.js';

describe('openai-compatible adapter', () => {
  it('streams text response with reported usage', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      const ssePayload = [
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"role":"assistant","content":"OpenAI"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":" response!"},"finish_reason":null}]}\n\n',
        'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":15,"completion_tokens":8,"prompt_tokens_details":{"cached_tokens":5}}}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      return new Response(ssePayload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'test-key',
      retryOptions: { fetchFn: mockFetch as any },
    });

    const events: ProviderEvent[] = [];
    for await (const event of adapter.stream({
      model: 'gpt-4o',
      system: 'system prompt',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })) {
      events.push(event);
    }

    const textDeltas = events.filter((e) => e.type === 'text_delta').map((e: any) => e.text);
    expect(textDeltas.join('')).toBe('OpenAI response!');

    const usageEvent = events.find((e) => e.type === 'usage') as any;
    expect(usageEvent).toBeDefined();
    expect(usageEvent.inputTokens).toBe(15);
    expect(usageEvent.outputTokens).toBe(8);
    expect(usageEvent.cachedTokens).toBe(5);

    const stopEvent = events.find((e) => e.type === 'stop') as any;
    expect(stopEvent.reason).toBe('end_turn');
  });

  it('reassembles fragmented streamed tool calls', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      const ssePayload = [
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_01","function":{"name":"write_file","arguments":"{\\"path\\": "}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"hello.txt\\", \\"content\\": \\"world\\"}"}}]},"finish_reason":null}]}\n\n',
        'data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      return new Response(ssePayload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'test-key',
      retryOptions: { fetchFn: mockFetch as any },
    });

    const events: ProviderEvent[] = [];
    for await (const event of adapter.stream({
      model: 'gpt-4o',
      system: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'write file' }] }],
    })) {
      events.push(event);
    }

    const start = events.find((e) => e.type === 'tool_use_start') as any;
    expect(start).toBeDefined();
    expect(start.id).toBe('call_01');
    expect(start.name).toBe('write_file');

    const end = events.find((e) => e.type === 'tool_use_end') as any;
    expect(end).toBeDefined();
    expect(end.id).toBe('call_01');
    expect(end.name).toBe('write_file');
    expect(end.input).toEqual({ path: 'hello.txt', content: 'world' });

    const stop = events.find((e) => e.type === 'stop') as any;
    expect(stop.reason).toBe('tool_use');
  });

  it('falls back to token estimation when provider omits usage', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      const ssePayload = [
        'data: {"choices":[{"index":0,"delta":{"content":"12345678"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      return new Response(ssePayload, { status: 200 });
    });

    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'test-key',
      retryOptions: { fetchFn: mockFetch as any },
    });

    const events: ProviderEvent[] = [];
    for await (const event of adapter.stream({
      model: 'gpt-4o',
      system: '1234', // 4 chars -> 1 token
      messages: [{ role: 'user', content: [{ type: 'text', text: '12345678' }] }], // 8 chars -> 2 tokens
    })) {
      events.push(event);
    }

    const usageEvent = events.find((e) => e.type === 'usage') as any;
    expect(usageEvent).toBeDefined();
    // 12 prompt chars / 4 = 3 tokens
    expect(usageEvent.inputTokens).toBe(3);
    // 8 output chars / 4 = 2 tokens
    expect(usageEvent.outputTokens).toBe(2);
  });

  it('retries on 429 and succeeds', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Too many requests', { status: 429, headers: { 'retry-after': '0' } });
      }

      const ssePayload = [
        'data: {"choices":[{"index":0,"delta":{"content":"success"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ].join('');

      return new Response(ssePayload, { status: 200 });
    });

    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'test-key',
      retryOptions: { fetchFn: mockFetch as any, initialDelayMs: 5 },
    });

    const events: ProviderEvent[] = [];
    for await (const event of adapter.stream({
      model: 'gpt-4o',
      system: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      events.push(event);
    }

    expect(callCount).toBe(2);
    expect(events.some((e) => e.type === 'stop')).toBe(true);
  });

  it('handles mid-stream abort', async () => {
    const controller = new AbortController();

    const mockFetch = vi.fn().mockImplementation(async () => {
      const stream = new ReadableStream({
        start(controllerStream) {
          controllerStream.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"hi"}}]}\n\n'));
          controller.abort();
        },
      });
      return new Response(stream, { status: 200 });
    });

    const adapter = new OpenAICompatibleAdapter({
      apiKey: 'test-key',
      retryOptions: { fetchFn: mockFetch as any },
    });

    const events: ProviderEvent[] = [];
    for await (const event of adapter.stream({
      model: 'gpt-4o',
      system: '',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      signal: controller.signal,
    })) {
      events.push(event);
    }

    const stopEvent = events.find((e) => e.type === 'stop') as any;
    expect(stopEvent).toBeDefined();
    expect(stopEvent.reason).toBe('aborted');
  });
});
