export interface RetryOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
}

export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (!isNaN(date)) {
    const diff = date - Date.now();
    return diff > 0 ? diff : 0;
  }
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(signal.reason || new Error('Request aborted'));
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason || new Error('Request aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Executes a fetch request with exponential backoff retry for 429, 5xx, and network errors.
 */
export async function fetchWithRetry(
  url: string | URL,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelayMs = options.initialDelayMs ?? 1000;
  const maxDelayMs = options.maxDelayMs ?? 30000;
  const signal = options.signal || (init.signal as AbortSignal | undefined);
  const fetchImpl = options.fetchFn ?? fetch;

  let attempt = 0;

  while (true) {
    if (signal?.aborted) {
      throw signal.reason || new Error('Request aborted');
    }

    try {
      const response = await fetchImpl(url, { ...init, signal });

      const isRetryableStatus = response.status === 429 || (response.status >= 500 && response.status <= 599);

      if (!isRetryableStatus || attempt >= maxRetries) {
        return response;
      }

      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      const exponential = initialDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 200;
      const delay = Math.min(maxDelayMs, retryAfter ?? exponential + jitter);

      attempt++;
      await sleep(delay, signal);
    } catch (err) {
      if (signal?.aborted) {
        throw signal.reason || err;
      }

      if (attempt >= maxRetries) {
        throw err;
      }

      const exponential = initialDelayMs * Math.pow(2, attempt);
      const jitter = Math.random() * 200;
      const delay = Math.min(maxDelayMs, exponential + jitter);

      attempt++;
      await sleep(delay, signal);
    }
  }
}
