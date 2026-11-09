import { describe, it, expect } from 'vitest';
import { parseSSEStream, SSEMessage } from '../src/providers/sse.js';

describe('sse parser module', () => {
  it('parses standard SSE events', async () => {
    const raw = [
      'event: greeting\n',
      'data: hello world\n\n',
      'event: farewell\n',
      'data: goodbye world\n\n',
    ];

    const messages: SSEMessage[] = [];
    for await (const msg of parseSSEStream(raw)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ event: 'greeting', data: 'hello world', id: undefined });
    expect(messages[1]).toEqual({ event: 'farewell', data: 'goodbye world', id: undefined });
  });

  it('handles multiline data fields properly', async () => {
    const raw = [
      'data: line 1\n',
      'data: line 2\n',
      'data: line 3\n\n',
    ];

    const messages: SSEMessage[] = [];
    for await (const msg of parseSSEStream(raw)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe('line 1\nline 2\nline 3');
  });

  it('handles fragmented byte chunks split across characters and lines', async () => {
    const encoder = new TextEncoder();
    const chunks = [
      encoder.encode('event: test\nda'),
      encoder.encode('ta: chunked-data-value\n'),
      encoder.encode('\n'),
    ];

    const messages: SSEMessage[] = [];
    for await (const msg of parseSSEStream(chunks)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].event).toBe('test');
    expect(messages[0].data).toBe('chunked-data-value');
  });

  it('ignores comments starting with colon', async () => {
    const raw = [
      ': this is a ping comment\n',
      'data: actual message\n\n',
    ];

    const messages: SSEMessage[] = [];
    for await (const msg of parseSSEStream(raw)) {
      messages.push(msg);
    }

    expect(messages).toHaveLength(1);
    expect(messages[0].data).toBe('actual message');
  });
});
