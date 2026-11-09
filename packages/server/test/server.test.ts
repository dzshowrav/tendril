import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderAdapter, DatabaseStore, createId } from '@tendril/core';
import { startDaemon, DaemonInstance } from '../src/daemon.js';

describe('Server HTTP, Auth, SSE & Integration Tests', () => {
  let tmpHome: string;
  let tmpWorkspace: string;
  let daemon: DaemonInstance;
  let baseUrl: string;

  const fakeProvider: ProviderAdapter = {
    stream: async function* () {
      await new Promise((r) => setTimeout(r, 100));
      yield { type: 'text_delta', text: 'Hello from Tendril daemon!' };
      yield { type: 'stop', reason: 'end_turn' };
    },
  };

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tendril-server-test-home-'));
    tmpWorkspace = mkdtempSync(join(tmpdir(), 'tendril-server-test-ws-'));

    daemon = await startDaemon({
      port: 0, // Ephemeral port
      customHome: tmpHome,
      wakeLock: false,
      acquireLock: false,
      setupSignalHandlers: false,
      providerAdapter: fakeProvider,
    });

    baseUrl = `http://127.0.0.1:${daemon.port}`;
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
    }
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // 1. Unauthenticated /api/sessions -> 401
  it('1. unauthenticated /api/sessions returns 401', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error.code).toBe('unauthorized');
  });

  // 2. Wrong Host header -> 421 / 403
  it('2. wrong Host header returns 421 or 403', async () => {
    const res = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: daemon.port,
          path: '/api/health',
          headers: { Host: 'evil.com' },
        },
        (resp) => {
          let data = '';
          resp.on('data', (chunk) => (data += chunk));
          resp.on('end', () => {
            try {
              resolve({ status: resp.statusCode || 0, body: JSON.parse(data) });
            } catch {
              resolve({ status: resp.statusCode || 0, body: data });
            }
          });
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect([403, 421]).toContain(res.status);
    expect(res.body.error.code).toBe('misdirected_request');
  });

  // 3. Foreign Origin -> 403
  it('3. foreign Origin returns 403', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
        Origin: 'http://evil.com',
      },
      body: JSON.stringify({ workspace: tmpWorkspace }),
    });
    expect(res.status).toBe(403);

    const body = await res.json();
    expect(body.error.code).toBe('forbidden_origin');
  });

  // 4. Pairing happy path and single use
  it('4. pairing happy path, cookie auth, and single use', async () => {
    // 4a. Request code with Bearer auth
    const codeRes = await fetch(`${baseUrl}/api/pair/code`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
      },
    });
    expect(codeRes.status).toBe(200);
    const codeData = await codeRes.json();
    expect(codeData.code).toMatch(/^\d{6}$/);
    expect(codeData.url).toContain(`/pair#code=${codeData.code}`);

    // 4b. Pair with code (no auth required)
    const pairRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: codeData.code,
        userAgent: 'TestWebClient/1.0',
      }),
    });
    expect(pairRes.status).toBe(200);
    const pairData = await pairRes.json();
    expect(pairData.ok).toBe(true);
    expect(pairData.client.id).toBeTruthy();

    const setCookie = pairRes.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toContain('tdl_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');

    // Extract cookie
    const cookieMatch = setCookie?.match(/tdl_session=([^;]+)/);
    expect(cookieMatch).toBeTruthy();
    const cookieValue = cookieMatch![1];

    // 4c. Re-using the same code must fail (single use)
    const reuseRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        code: codeData.code,
      }),
    });
    expect(reuseRes.status).toBe(400);
    const reuseData = await reuseRes.json();
    expect(reuseData.error.code).toBe('invalid_code');

    // 4d. Use cookie to access protected /api/sessions endpoint
    const sessionListRes = await fetch(`${baseUrl}/api/sessions`, {
      headers: {
        Cookie: `tdl_session=${cookieValue}`,
      },
    });
    expect(sessionListRes.status).toBe(200);
    const sessionListData = await sessionListRes.json();
    expect(Array.isArray(sessionListData.sessions)).toBe(true);
  });

  // 5. 5 bad codes lock for 60 s
  it('5. 5 bad pairing codes locks for 60 seconds (returns 429)', async () => {
    // 4 bad attempts return 400
    for (let i = 0; i < 4; i++) {
      const res = await fetch(`${baseUrl}/api/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: '999999' }),
      });
      expect(res.status).toBe(400);
    }

    // 5th bad attempt triggers lockout (429)
    const fifthRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '999999' }),
    });
    expect(fifthRes.status).toBe(429);
    const fifthData = await fifthRes.json();
    expect(fifthData.error.code).toBe('rate_limited');

    // 6th attempt while locked also returns 429
    const sixthRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '999999' }),
    });
    expect(sixthRes.status).toBe(429);
  });

  // 6. SSE replay after reconnect delivers missed events in order
  it('6. SSE replay after reconnect delivers missed events in order via Last-Event-ID', async () => {
    // Create a session first
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspace: tmpWorkspace, title: 'SSE Replay Session' }),
    });
    expect(createRes.status).toBe(201);
    const { session } = await createRes.json();

    // Publish 3 events through sseHub
    const e1 = daemon.sseHub.publish(session.id, 'text.delta', { text: 'one' });
    const e2 = daemon.sseHub.publish(session.id, 'text.delta', { text: 'two' });
    const e3 = daemon.sseHub.publish(session.id, 'text.delta', { text: 'three' });

    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(e3.seq).toBe(3);

    // Now connect with Last-Event-ID: 1 -> should replay e2 and e3
    const sseRes = await fetch(`${baseUrl}/api/sessions/${session.id}/events`, {
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Last-Event-ID': '1',
      },
    });
    expect(sseRes.status).toBe(200);

    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();
    let receivedText = '';

    // Read initial replayed events
    const timeout = Date.now() + 3000;
    while (Date.now() < timeout) {
      const { value, done } = await reader.read();
      if (done) break;
      receivedText += decoder.decode(value, { stream: true });
      if (receivedText.includes('id: 2') && receivedText.includes('id: 3')) {
        break;
      }
    }
    reader.cancel();

    expect(receivedText).toContain('id: 2');
    expect(receivedText).toContain('"text":"two"');
    expect(receivedText).toContain('id: 3');
    expect(receivedText).toContain('"text":"three"');

    // Assert order: id: 2 appears before id: 3
    const idx2 = receivedText.indexOf('id: 2');
    const idx3 = receivedText.indexOf('id: 3');
    expect(idx2).toBeLessThan(idx3);
  });

  // 7. Two simultaneous message POSTs give one 202 and one 409
  it('7. two simultaneous message POSTs return one 202 and one 409 (session_busy)', async () => {
    // Create session
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspace: tmpWorkspace, title: 'Busy Test' }),
    });
    const { session } = await createRes.json();

    // Fire two message POSTs simultaneously
    const postMessage = () =>
      fetch(`${baseUrl}/api/sessions/${session.id}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${daemon.cliToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: 'concurrent turn' }),
      });

    const [res1, res2] = await Promise.all([postMessage(), postMessage()]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([202, 409]);

    const busyRes = res1.status === 409 ? res1 : res2;
    const busyBody = await busyRes.json();
    expect(busyBody.error.code).toBe('session_busy');
  });

  // 8. Revoked client's stream closes within 5 seconds
  it('8. revoked client stream closes within 5s', async () => {
    // 1. Pair client
    const codeRes = await fetch(`${baseUrl}/api/pair/code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${daemon.cliToken}` },
    });
    const { code } = await codeRes.json();

    const pairRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const { client } = await pairRes.json();
    const cookie = pairRes.headers.get('set-cookie')!.match(/tdl_session=([^;]+)/)![1];

    // 2. Create session
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspace: tmpWorkspace }),
    });
    const { session } = await createRes.json();

    // 3. Connect to SSE stream as web client
    const sseRes = await fetch(`${baseUrl}/api/sessions/${session.id}/events`, {
      headers: {
        Cookie: `tdl_session=${cookie}`,
      },
    });
    expect(sseRes.status).toBe(200);

    const reader = sseRes.body!.getReader();

    // 4. Revoke the client
    const revokeRes = await fetch(`${baseUrl}/api/clients/${client.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${daemon.cliToken}` },
    });
    expect(revokeRes.status).toBe(200);

    // 5. Watch stream close within 5 seconds
    const start = Date.now();
    let streamClosed = false;

    const readPromise = (async () => {
      try {
        while (true) {
          const { done } = await reader.read();
          if (done) {
            streamClosed = true;
            break;
          }
        }
      } catch {
        streamClosed = true;
      }
    })();

    // Revocation watchdog interval is 1s, so it must close well within 5s
    await Promise.race([
      readPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Stream did not close within 5s')), 5000)),
    ]);

    const duration = Date.now() - start;
    expect(streamClosed).toBe(true);
    expect(duration).toBeLessThan(5000);
  });

  // 9. Full prompt turn using Bearer token over HTTP
  it('9. completes a full prompt turn via HTTP Bearer token and records message', async () => {
    // 1. Create session
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspace: tmpWorkspace, title: 'Prompt Turn Test' }),
    });
    const { session } = await createRes.json();

    // 2. Post prompt turn
    const msgRes = await fetch(`${baseUrl}/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'Hello agent' }),
    });
    expect(msgRes.status).toBe(202);

    // 3. Wait for turn to complete (poll session status to become 'idle')
    const start = Date.now();
    let completed = false;
    while (Date.now() - start < 5000) {
      const pollRes = await fetch(`${baseUrl}/api/sessions/${session.id}`, {
        headers: { Authorization: `Bearer ${daemon.cliToken}` },
      });
      const data = await pollRes.json();
      if (data.session.status === 'idle') {
        const assistantMsgs = data.messages.filter((m: any) => m.role === 'assistant');
        if (assistantMsgs.length > 0) {
          completed = true;
          expect(assistantMsgs[0].content_json).toContain('Hello from Tendril daemon!');
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(completed).toBe(true);
  });
});
