import { describe, it, expect, vi } from 'vitest';
import { fetchWithRetry, parseRetryAfter } from '../src/providers/retry.js';

describe('retry module', () => {
  it('parses retry-after header in seconds and date formats', () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0')).toBe(0);

    const futureDate = new Date(Date.now() + 10000).toUTCString();
    const parsed = parseRetryAfter(futureDate);
    expect(parsed).toBeGreaterThan(5000);
    expect(parsed).toBeLessThanOrEqual(10000);
  });

  it('retries on 429 and succeeds on subsequent attempt', async () => {
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return new Response('Rate limit', {
          status: 429,
          headers: { 'retry-after': '0' },
        });
      }
      return new Response('OK', { status: 200 });
    });

    const res = await fetchWithRetry(
      'http://localhost/test',
      {},
      {
        fetchFn: mockFetch as any,
        initialDelayMs: 10,
        maxRetries: 3,
      },
    );

    expect(calls).toBe(2);
    expect(res.status).toBe(200);
  });

  it('retries on 500 server errors', async () => {
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) {
        return new Response('Server Error', { status: 502 });
      }
      return new Response('Recovered', { status: 200 });
    });

    const res = await fetchWithRetry(
      'http://localhost/test',
      {},
      {
        fetchFn: mockFetch as any,
        initialDelayMs: 10,
        maxRetries: 3,
      },
    );

    expect(calls).toBe(3);
    expect(res.status).toBe(200);
  });

  it('does not retry non-retryable 401 client error', async () => {
    let calls = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      calls++;
      return new Response('Unauthorized', { status: 401 });
    });

    const res = await fetchWithRetry(
      'http://localhost/test',
      {},
      {
        fetchFn: mockFetch as any,
        initialDelayMs: 10,
        maxRetries: 3,
      },
    );

    expect(calls).toBe(1);
    expect(res.status).toBe(401);
  });

  it('aborts immediately when AbortSignal is triggered', async () => {
    const controller = new AbortController();
    controller.abort();

    const mockFetch = vi.fn();

    await expect(
      fetchWithRetry(
        'http://localhost/test',
        {},
        {
          fetchFn: mockFetch as any,
          signal: controller.signal,
        },
      ),
    ).rejects.toThrow();

    expect(mockFetch).not.toHaveBeenCalled();
  });
});
