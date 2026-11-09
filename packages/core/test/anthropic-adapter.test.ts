import { describe, it, expect, vi } from 'vitest';
import { AnthropicAdapter } from '../src/providers/anthropic.js';
import { ProviderEvent } from '../src/providers/types.js';

describe('anthropic adapter', () => {
  it('streams text response with prompt-caching markers', async () => {
    let capturedBody: any;
    const mockFetch = vi.fn().mockImplementation(async (_url, init) => {
      capturedBody = JSON.parse(init.body);

      const ssePayload = [
        'event: message_start\n',
        'data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","usage":{"input_tokens":45,"cache_read_input_tokens":10,"cache_creation_input_tokens":0}}}\n\n',
        'event: content_block_start\n',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
        'event: content_block_delta\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
        'event: content_block_delta\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there!"}}\n\n',
        'event: content_block_stop\n',
        'data: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n',
        'event: message_stop\n',
        'data: {"type":"message_stop"}\n\n',
      ].join('');

      return new Response(ssePayload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const adapter = new AnthropicAdapter({
      apiKey: 'test-ant-key',
      retryOptions: { fetchFn: mockFetch as any },
    });

    const events: ProviderEvent[] = [];
    for await (const event of adapter.stream({
      model: 'claude-sonnet-5-5',
      system: 'You are helpful.',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Hi' }],
        },
      ],
      tools: [
        {
          name: 'tool1',
          description: 'tool 1',
          parameters: { type: 'object' },
        },
      ],
    })) {
      events.push(event);
    }

    // Verify prompt-caching markers
    expect(capturedBody.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(capturedBody.tools[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(capturedBody.messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });

    // Verify events
    const textDeltas = events.filter((e) => e.type === 'text_delta').map((e: any) => e.text);
    expect(textDeltas.join('')).toBe('Hello there!');

    const usageEvent = events.find((e) => e.type === 'usage') as any;
    expect(usageEvent).toBeDefined();
    expect(usageEvent.inputTokens).toBe(45);
    expect(usageEvent.outputTokens).toBe(12);
    expect(usageEvent.cachedTokens).toBe(10);

    const stopEvent = events.find((e) => e.type === 'stop') as any;
    expect(stopEvent).toBeDefined();
    expect(stopEvent.reason).toBe('end_turn');
  });

  it('streams tool call response and parses arguments cleanly', async () => {
    const mockFetch = vi.fn().mockImplementation(async () => {
      const ssePayload = [
        'event: message_start\n',
        'data: {"type":"message_start","message":{"id":"msg_2","role":"assistant","usage":{"input_tokens":50}}}\n\n',
        'event: content_block_start\n',
        'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"call_101","name":"read_file"}}\n\n',
        'event: content_block_delta\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\": \\"src/"}}\n\n',
        'event: content_block_delta\n',
        'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"index.ts\\"}"}}\n\n',
        'event: content_block_stop\n',
        'data: {"type":"content_block_stop","index":0}\n\n',
        'event: message_delta\n',
        'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":25}}\n\n',
        'event: message_stop\n',
        'data: {"type":"message_stop"}\n\n',
      ].join('');

      return new Response(ssePayload, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    });

    const adapter = new AnthropicAdapter({
      apiKey: 'test-ant-key',
      retryOptions: { fetchFn: mockFetch as any },
    });

    const events: ProviderEvent[] = [];
    for await (const event of adapter.stream({
      model: 'claude-sonnet-5-5',
      system: 'system',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'read index' }] }],
    })) {
      events.push(event);
    }

    const start = events.find((e) => e.type === 'tool_use_start') as any;
    expect(start).toBeDefined();
    expect(start.id).toBe('call_101');
    expect(start.name).toBe('read_file');

    const end = events.find((e) => e.type === 'tool_use_end') as any;
    expect(end).toBeDefined();
    expect(end.id).toBe('call_101');
    expect(end.name).toBe('read_file');
    expect(end.input).toEqual({ path: 'src/index.ts' });

    const stop = events.find((e) => e.type === 'stop') as any;
    expect(stop.reason).toBe('tool_use');
  });

  it('retries on 429 and succeeds', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return new Response('Rate limited', { status: 429, headers: { 'retry-after': '0' } });
      }

      const ssePayload = [
        'event: message_start\n',
        'data: {"type":"message_start","message":{"usage":{"input_tokens":10}}}\n\n',
        'event: message_stop\n',
        'data: {"type":"message_stop"}\n\n',
      ].join('');

      return new Response(ssePayload, { status: 200 });
    });

    const adapter = new AnthropicAdapter({
      apiKey: 'test-key',
      retryOptions: { fetchFn: mockFetch as any, initialDelayMs: 5 },
    });

    const events: ProviderEvent[] = [];
    for await (const event of adapter.stream({
      model: 'claude-sonnet-5-5',
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
          controllerStream.enqueue(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start"}\n\n'));
          // Trigger abort
          controller.abort();
        },
      });
      return new Response(stream, { status: 200 });
    });

    const adapter = new AnthropicAdapter({
      apiKey: 'test-key',
      retryOptions: { fetchFn: mockFetch as any },
    });

    const events: ProviderEvent[] = [];
    for await (const event of adapter.stream({
      model: 'claude-sonnet-5-5',
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
