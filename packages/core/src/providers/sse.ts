export interface SSEMessage {
  event?: string;
  data: string;
  id?: string;
}

async function* toAsyncIterable(
  stream:
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array | string>
    | Iterable<Uint8Array | string>,
  signal?: AbortSignal,
): AsyncIterable<Uint8Array | string> {
  if (signal?.aborted) return;

  if (Symbol.asyncIterator in stream) {
    for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
      if (signal?.aborted) return;
      yield chunk;
    }
  } else if (Symbol.iterator in stream) {
    for (const chunk of stream as Iterable<Uint8Array | string>) {
      if (signal?.aborted) return;
      yield chunk;
    }
  } else {
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    const onAbort = () => {
      try {
        reader.cancel();
      } catch {}
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
      while (true) {
        if (signal?.aborted) break;
        const { done, value } = await reader.read();
        if (done || signal?.aborted) break;
        if (value) yield value;
      }
    } finally {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
      try {
        reader.releaseLock();
      } catch {}
    }
  }
}

/**
 * Parses a byte or string stream into standard Server-Sent Events (SSE).
 */
export async function* parseSSEStream(
  stream:
    | ReadableStream<Uint8Array>
    | AsyncIterable<Uint8Array | string>
    | Iterable<Uint8Array | string>,
  signal?: AbortSignal,
): AsyncGenerator<SSEMessage> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  let currentEvent: string | undefined;
  let currentData: string[] = [];
  let currentId: string | undefined;

  for await (const chunk of toAsyncIterable(stream, signal)) {
    if (signal?.aborted) break;
    if (typeof chunk === 'string') {
      buffer += chunk;
    } else {
      buffer += decoder.decode(chunk, { stream: true });
    }

    const lines = buffer.split(/\r\n|\r|\n/);
    // Keep the last incomplete part in the buffer
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line === '') {
        // Dispatch event on empty line if data is present
        if (currentData.length > 0 || currentEvent !== undefined) {
          yield {
            event: currentEvent,
            data: currentData.join('\n'),
            id: currentId,
          };
          currentEvent = undefined;
          currentData = [];
          currentId = undefined;
        }
        continue;
      }

      if (line.startsWith(':')) {
        // SSE comment, ignore
        continue;
      }

      const colonIdx = line.indexOf(':');
      let field: string;
      let value: string;

      if (colonIdx === -1) {
        field = line;
        value = '';
      } else {
        field = line.slice(0, colonIdx);
        value = line.slice(colonIdx + 1);
        if (value.startsWith(' ')) {
          value = value.slice(1);
        }
      }

      if (field === 'event') {
        currentEvent = value;
      } else if (field === 'data') {
        currentData.push(value);
      } else if (field === 'id') {
        currentId = value;
      }
    }
  }

  // Flush remaining buffer if any
  if (buffer.length > 0) {
    const remaining = decoder.decode();
    const finalLines = (buffer + remaining).split(/\r\n|\r|\n/);
    for (const line of finalLines) {
      if (line.startsWith('data:')) {
        let value = line.slice(5);
        if (value.startsWith(' ')) value = value.slice(1);
        currentData.push(value);
      } else if (line.startsWith('event:')) {
        let value = line.slice(6);
        if (value.startsWith(' ')) value = value.slice(1);
        currentEvent = value;
      }
    }
  }

  if (currentData.length > 0 || currentEvent !== undefined) {
    yield {
      event: currentEvent,
      data: currentData.join('\n'),
      id: currentId,
    };
  }
}
