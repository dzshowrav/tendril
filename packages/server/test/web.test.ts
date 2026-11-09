import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { ProviderAdapter, createId } from '@tendril/core';
import { startDaemon, DaemonInstance } from '../src/daemon.js';
import { CSP_HEADER_VALUE } from '../src/security.js';

describe('Step 10: Web UI & Server Integration Tests', () => {
  let tmpHome: string;
  let tmpWorkspace: string;
  let daemon: DaemonInstance;
  let baseUrl: string;

  const fakeProvider: ProviderAdapter = {
    stream: async function* () {
      yield { type: 'text_delta', text: 'Live mirrored response!' };
      yield { type: 'stop', reason: 'end_turn' };
    },
  };

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tendril-web-test-home-'));
    tmpWorkspace = mkdtempSync(join(tmpdir(), 'tendril-web-test-ws-'));

    daemon = await startDaemon({
      port: 0,
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
      try {
        await Promise.race([
          daemon.stop(),
          new Promise((r) => setTimeout(r, 2000)),
        ]);
      } catch {
        // ignore
      }
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

  // 1. Static Asset Serving & SPA Fallback
  it('serves index.html, static assets, and SPA fallback routes with CSP headers', async () => {
    // 1a. Root GET /
    const rootRes = await fetch(`${baseUrl}/`);
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers.get('content-type')).toContain('text/html');
    expect(rootRes.headers.get('content-security-policy')).toBe(CSP_HEADER_VALUE);
    const html = await rootRes.text();
    expect(html).toContain('id="root"');

    // 1b. SPA fallback GET /sessions
    const sessionsRouteRes = await fetch(`${baseUrl}/sessions`);
    expect(sessionsRouteRes.status).toBe(200);
    expect(sessionsRouteRes.headers.get('content-type')).toContain('text/html');
    expect(sessionsRouteRes.headers.get('content-security-policy')).toBe(CSP_HEADER_VALUE);

    // 1c. SPA fallback GET /s/01JABCDEF123456
    const sessionDetailRes = await fetch(`${baseUrl}/s/01JABCDEF123456`);
    expect(sessionDetailRes.status).toBe(200);
    expect(sessionDetailRes.headers.get('content-type')).toContain('text/html');

    // 1d. Static assets (JS & CSS)
    const assetsDir = join(process.cwd(), 'dist/assets/web/assets');
    expect(existsSync(assetsDir)).toBe(true);
    const files = readdirSync(assetsDir);
    const jsFile = files.find((f) => f.endsWith('.js'));
    const cssFile = files.find((f) => f.endsWith('.css'));

    expect(jsFile).toBeDefined();
    expect(cssFile).toBeDefined();

    const jsRes = await fetch(`${baseUrl}/assets/${jsFile}`);
    expect(jsRes.status).toBe(200);
    expect(jsRes.headers.get('content-type')).toContain('application/javascript');
    expect(jsRes.headers.get('content-security-policy')).toBe(CSP_HEADER_VALUE);

    const cssRes = await fetch(`${baseUrl}/assets/${cssFile}`);
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers.get('content-type')).toContain('text/css');

    // 1e. Budget check: Initial JS under 400 KB gzipped
    const jsContent = readFileSync(join(assetsDir, jsFile!));
    const gzipped = gzipSync(jsContent);
    expect(gzipped.byteLength).toBeLessThan(400 * 1024);
  });

  // 2. Web Pairing Flow
  it('pairs web client via pairing code, sets tdl_session cookie, and permits authenticated requests', async () => {
    // Generate 6-digit code
    const { code } = daemon.pairingManager.createPairingCode();

    // Pair request to /api/pair
    const pairRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });

    expect(pairRes.status).toBe(200);
    const pairData = await pairRes.json();
    expect(pairData.ok).toBe(true);
    expect(pairData.client).toBeDefined();
    expect(pairData.client.id).toBeDefined();

    // Verify Set-Cookie header contains tdl_session
    const setCookie = pairRes.headers.get('set-cookie');
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain('tdl_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');

    // Extract cookie value for subsequent requests
    const cookieHeader = setCookie!.split(';')[0];

    // Authenticated request to /api/sessions using cookie
    const sessionsRes = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Cookie: cookieHeader },
    });
    expect(sessionsRes.status).toBe(200);
    const sessionsData = await sessionsRes.json();
    expect(Array.isArray(sessionsData.sessions)).toBe(true);
  });

  // Helper to open an SSE stream and collect events asynchronously
  function openSSE(url: string, headers: Record<string, string>) {
    const received: Array<{ seq: number; type: string; data: any }> = [];
    const controller = new AbortController();
    let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

    const readyPromise = (async () => {
      try {
        const res = await fetch(url, {
          headers,
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`SSE stream failed: HTTP ${res.status}`);
        }

        const reader = res.body!.getReader();
        activeReader = reader;
        const decoder = new TextDecoder();
        let buffer = '';

        (async () => {
          try {
            while (!controller.signal.aborted) {
              const res = await reader.read().catch(() => ({ done: true as const, value: undefined }));
              if (res.done) break;
              buffer += decoder.decode(res.value, { stream: true });
              const parts = buffer.split('\n\n');
              buffer = parts.pop() || '';

              for (const part of parts) {
                if (!part.trim()) continue;
                let seq = 0;
                let type = 'message';
                let dataStr = '';

                for (const line of part.split('\n')) {
                  if (line.startsWith('id:')) {
                    seq = parseInt(line.slice(3).trim(), 10) || 0;
                  } else if (line.startsWith('event:')) {
                    type = line.slice(6).trim();
                  } else if (line.startsWith('data:')) {
                    dataStr = line.slice(5).trim();
                  }
                }

                if (dataStr) {
                  try {
                    received.push({ seq, type, data: JSON.parse(dataStr) });
                  } catch {
                    received.push({ seq, type, data: dataStr });
                  }
                }
              }
            }
          } catch {
            // aborted
          }
        })().catch(() => {});
      } catch {
        // aborted
      }
      return true;
    })();

    return {
      ready: readyPromise,
      events: received,
      close: () => {
        try {
          controller.abort();
          activeReader?.cancel().catch(() => {});
        } catch {
          // ignore
        }
      },
    };
  }

  // 3. Live Mirroring between Web and CLI
  it('mirrors messages and streaming turns live between web and CLI clients', async () => {
    // Pair web client
    const { code } = daemon.pairingManager.createPairingCode();
    const pairRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const cookieHeader = pairRes.headers.get('set-cookie')!.split(';')[0];

    // Create session via CLI
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspace: tmpWorkspace,
        title: 'Mirror Session',
      }),
    });
    const { session } = await createRes.json();
    const sessionId = session.id;

    // Connect Web and CLI SSE clients
    const webSSE = openSSE(`${baseUrl}/api/sessions/${sessionId}/events`, {
      Cookie: cookieHeader,
    });
    const cliSSE = openSSE(`${baseUrl}/api/sessions/${sessionId}/events`, {
      Authorization: `Bearer ${daemon.cliToken}`,
    });

    await Promise.all([webSSE.ready, cliSSE.ready]);
    await new Promise((r) => setTimeout(r, 100));

    // Web client sends a user prompt
    const webMsgRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: {
        Cookie: cookieHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: 'Prompt from Web client',
      }),
    });
    expect(webMsgRes.status).toBe(202);

    // Wait for turn completion
    const timeout = Date.now() + 4000;
    while (Date.now() < timeout) {
      if (
        webSSE.events.some((e) => e.type === 'session.status' && e.data?.status === 'idle') &&
        cliSSE.events.some((e) => e.type === 'session.status' && e.data?.status === 'idle')
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    // Both Web and CLI clients must receive message.created, text.delta, and session.status
    const webEventTypes = webSSE.events.map((e) => e.type);
    const cliEventTypes = cliSSE.events.map((e) => e.type);

    expect(webEventTypes).toContain('message.created');
    expect(webEventTypes).toContain('text.delta');
    expect(webEventTypes).toContain('session.status');

    expect(cliEventTypes).toContain('message.created');
    expect(cliEventTypes).toContain('text.delta');
    expect(cliEventTypes).toContain('session.status');

    const webUserMsg = webSSE.events.find((e) => e.type === 'message.created');
    const cliUserMsg = cliSSE.events.find((e) => e.type === 'message.created');
    expect(webUserMsg?.data?.message?.content?.[0]?.text).toBe('Prompt from Web client');
    expect(cliUserMsg?.data?.message?.content?.[0]?.text).toBe('Prompt from Web client');

    webSSE.close();
    cliSSE.close();
  });

  // 4. Permission Race (First Answer Wins)
  it('presents permission requests to both clients and resolves via first-answer-wins (409 on second)', async () => {
    // Pair web client
    const { code } = daemon.pairingManager.createPairingCode();
    const pairRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const cookieHeader = pairRes.headers.get('set-cookie')!.split(';')[0];

    // Create session
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspace: tmpWorkspace,
        title: 'Permission Race Session',
      }),
    });
    const { session } = await createRes.json();
    const sessionId = session.id;

    // Connect Web and CLI SSE streams
    const webSSE = openSSE(`${baseUrl}/api/sessions/${sessionId}/events`, {
      Cookie: cookieHeader,
    });
    const cliSSE = openSSE(`${baseUrl}/api/sessions/${sessionId}/events`, {
      Authorization: `Bearer ${daemon.cliToken}`,
    });

    await Promise.all([webSSE.ready, cliSSE.ready]);
    await new Promise((r) => setTimeout(r, 100));

    // Create a pending permission request
    const permReqPromise = daemon.permissionEngine.registry.createRequest({
      sessionId,
      toolRunId: createId(),
      tool: 'write_file',
      toolClass: 'edit',
      input: { path: 'hello.txt', content: 'hello' },
      workspacePath: tmpWorkspace,
      normalizedPattern: null,
      canAllowAlways: true,
    });

    const pendingList = daemon.permissionEngine.registry.listPending(sessionId);
    expect(pendingList.length).toBe(1);
    const requestId = pendingList[0].id;

    // Broadcast permission_request to SSE hub
    daemon.sseHub.publish(sessionId, 'permission_request', {
      requestId,
      toolName: 'write_file',
      description: 'Write hello.txt',
    });

    // Wait for event delivery
    const timeout = Date.now() + 2000;
    while (Date.now() < timeout) {
      if (
        webSSE.events.some((e) => e.type === 'permission_request') &&
        cliSSE.events.some((e) => e.type === 'permission_request')
      ) {
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }

    // Verify both clients received permission_request event
    expect(webSSE.events.some((e) => e.type === 'permission_request')).toBe(true);
    expect(cliSSE.events.some((e) => e.type === 'permission_request')).toBe(true);

    // 1st Answer (Web wins): allow_once
    const firstRes = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/permissions/${requestId}`,
      {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: 'allow_once' }),
      },
    );
    expect(firstRes.status).toBe(200);
    const firstData = await firstRes.json();
    expect(firstData.ok).toBe(true);
    expect(firstData.decision).toBe('allow_once');

    // 2nd Answer (CLI tries to deny): rejected with 409 already_resolved
    const secondRes = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/permissions/${requestId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${daemon.cliToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: 'deny' }),
      },
    );
    expect(secondRes.status).toBe(409);
    const secondData = await secondRes.json();
    expect(secondData.error.code).toBe('already_resolved');

    // Ensure the permission request promise resolved with the winning decision
    const resolvedReq = await permReqPromise;
    expect(resolvedReq.decision).toBe('allow_once');

    webSSE.close();
    cliSSE.close();
  });

  it('gracefully downgrades allow_always to allow_once for compound commands without 500 error', async () => {
    const sessionRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ workspace: tmpWorkspace, title: 'Compound Perm Test' }),
    });
    const { session } = await sessionRes.json();

    const reqPromise = daemon.permissionEngine.registry.createRequest({
      sessionId: session.id,
      toolRunId: 'tr_compound_1',
      tool: 'bash',
      toolClass: 'exec',
      input: { command: 'ls -la 2>/dev/null || echo "not found"' },
      workspacePath: tmpWorkspace,
      normalizedPattern: null,
      canAllowAlways: false,
      disallowAlwaysReason: 'Compound commands cannot be saved as permanent rules',
    });

    const pendingList = daemon.permissionEngine.registry.listPending(session.id);
    expect(pendingList.length).toBe(1);
    const requestId = pendingList[0].id;

    const res = await fetch(
      `${baseUrl}/api/sessions/${session.id}/permissions/${requestId}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${daemon.cliToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: 'allow_always' }),
      },
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.decision).toBe('allow_once');
    expect(data.downgraded).toBe(true);
    expect(data.warning).toContain('Cannot save');

    const resolved = await reqPromise;
    expect(resolved.decision).toBe('allow_once');
  });

  // 5. Reconnect & Stream Resync with Last-Event-ID
  it('replays missed events after reconnecting with Last-Event-ID without duplicating existing messages', async () => {
    // Create session
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspace: tmpWorkspace,
        title: 'Reconnect Session',
      }),
    });
    const { session } = await createRes.json();
    const sessionId = session.id;

    // Connect first stream
    const firstSSE = openSSE(`${baseUrl}/api/sessions/${sessionId}/events`, {
      Authorization: `Bearer ${daemon.cliToken}`,
    });
    await firstSSE.ready;
    await new Promise((r) => setTimeout(r, 100));

    // Broadcast 2 initial events
    const e1 = daemon.sseHub.publish(sessionId, 'status_update', { step: 1 });
    const e2 = daemon.sseHub.publish(sessionId, 'status_update', { step: 2 });

    const timeout1 = Date.now() + 2000;
    while (Date.now() < timeout1) {
      if (firstSSE.events.length >= 2) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(firstSSE.events.length).toBeGreaterThanOrEqual(2);
    const lastSeenSeq = e2.seq;

    // Simulate disconnect (e.g. airplane mode)
    firstSSE.close();

    // Broadcast more events while client is disconnected
    const e3 = daemon.sseHub.publish(sessionId, 'status_update', { step: 3 });
    const e4 = daemon.sseHub.publish(sessionId, 'status_update', { step: 4 });

    // Reconnect with Last-Event-ID set to lastSeenSeq
    const reconnectedSSE = openSSE(`${baseUrl}/api/sessions/${sessionId}/events`, {
      Authorization: `Bearer ${daemon.cliToken}`,
      'Last-Event-ID': String(lastSeenSeq),
    });
    await reconnectedSSE.ready;

    const timeout2 = Date.now() + 2000;
    while (Date.now() < timeout2) {
      if (reconnectedSSE.events.some((e) => e.seq === e4.seq)) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    // Verify reconnected stream replayed only e3 and e4 (no e1 or e2 replay)
    const replayedSeqs = reconnectedSSE.events.map((e) => e.seq);
    expect(replayedSeqs).toContain(e3.seq);
    expect(replayedSeqs).toContain(e4.seq);
    expect(replayedSeqs).not.toContain(e1.seq);
    expect(replayedSeqs).not.toContain(e2.seq);

    reconnectedSSE.close();
  });
});
