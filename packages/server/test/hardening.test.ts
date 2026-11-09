import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DatabaseStore,
  ProviderAdapter,
  createId,
  recoverInterruptedSessions,
  scrubEnvironment,
  Logger,
} from '@tendril/core';
import { startDaemon, DaemonInstance } from '../src/daemon.js';
import { SSEHub, SSEClientConnection } from '../src/sse-hub.js';

function sendRawHttpRequest(options: {
  port: number;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: options.port,
        path: options.path,
        method: options.method || 'GET',
        headers: options.headers || {},
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 500, body: parsed });
        });
      },
    );
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('Step 14 Hardening & Resilience Tests', () => {
  let tmpHome: string;
  let tmpWorkspace: string;
  let daemon: DaemonInstance;
  let baseUrl: string;

  const fakeProvider: ProviderAdapter = {
    stream: async function* () {
      yield { type: 'text_delta', text: 'Hardened response' };
      yield { type: 'stop', reason: 'end_turn' };
    },
  };

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tendril-hardening-home-'));
    tmpWorkspace = mkdtempSync(join(tmpdir(), 'tendril-hardening-ws-'));

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
      await daemon.stop();
    }
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {}
    try {
      rmSync(tmpWorkspace, { recursive: true, force: true });
    } catch {}
  });

  // 1. DNS Rebinding / Host header check
  it('1. rejects DNS-rebinding attempts with 421 Misdirected Request', async () => {
    // Malicious Host header (evil.com)
    const evilRes = await sendRawHttpRequest({
      port: daemon.port,
      path: '/api/health',
      headers: { Host: 'evil.com' },
    });
    expect(evilRes.status).toBe(421);
    expect(evilRes.body.error.code).toBe('misdirected_request');

    // Subdomain rebinding (localhost.attacker.com)
    const rebindingRes = await sendRawHttpRequest({
      port: daemon.port,
      path: '/api/health',
      headers: { Host: 'localhost.attacker.com' },
    });
    expect(rebindingRes.status).toBe(421);
    expect(rebindingRes.body.error.code).toBe('misdirected_request');

    // Legitimate loopback Host
    const okRes = await sendRawHttpRequest({
      port: daemon.port,
      path: '/api/health',
      headers: { Host: `127.0.0.1:${daemon.port}` },
    });
    expect(okRes.status).toBe(200);

    const okLocalhost = await sendRawHttpRequest({
      port: daemon.port,
      path: '/api/health',
      headers: { Host: `localhost:${daemon.port}` },
    });
    expect(okLocalhost.status).toBe(200);
  });

  // 2. Foreign Origin guard check
  it('2. rejects foreign Origin headers with 403 Forbidden', async () => {
    // POST request with foreign origin
    const foreignRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://malicious-site.com',
      },
      body: JSON.stringify({ code: 'INVALID_CODE' }),
    });
    expect(foreignRes.status).toBe(403);
    const foreignBody = await foreignRes.json();
    expect(foreignBody.error.code).toBe('forbidden_origin');

    // POST request with valid loopback origin
    const loopbackRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: `http://127.0.0.1:${daemon.port}`,
      },
      body: JSON.stringify({ code: 'INVALID_CODE' }),
    });
    // Origin is accepted (passes guard; returns 400 for bad code)
    expect(loopbackRes.status).toBe(400);
  });

  // 3. Secrets Redaction & Environment Scrubbing
  it('3. redacts secret keys in logger and scrubs environment variables', () => {
    // A. Environment scrubbing
    const dirtyEnv: NodeJS.ProcessEnv = {
      PATH: '/bin:/usr/bin',
      TENDRIL_HOME: '/data/data/com.termux/files/home/.tendril',
      TENDRIL_MOCK_TERMUX_API: '1',
      ANTHROPIC_API_KEY: 'sk-ant-api03-super-secret-key-abcdef',
      OPENAI_API_KEY: 'sk-proj-super-secret-key-openai',
      DATABASE_PASSWORD: 'supersecretpassword',
      AWS_SECRET_ACCESS_KEY: 'awssecretkey123',
    };

    const cleanEnv = scrubEnvironment(dirtyEnv);
    expect(cleanEnv.PATH).toBe('/bin:/usr/bin');
    expect(cleanEnv.TENDRIL_HOME).toBeUndefined();
    expect(cleanEnv.TENDRIL_MOCK_TERMUX_API).toBeUndefined();
    expect(cleanEnv.ANTHROPIC_API_KEY).toBeUndefined();
    expect(cleanEnv.OPENAI_API_KEY).toBeUndefined();
    expect(cleanEnv.DATABASE_PASSWORD).toBeUndefined();
    expect(cleanEnv.AWS_SECRET_ACCESS_KEY).toBeUndefined();

    // B. Logger redaction
    const testLogFile = join(tmpHome, 'logs', 'redaction-test.log');
    const logger = new Logger({ logFilePath: testLogFile, level: 'debug' });
    const secretKey = 'sk-ant-api03-topsecretanthropictoken123';
    logger.registerSecret(secretKey);

    logger.info(`Sending request to Anthropic with key ${secretKey}`);
    logger.info('Authorization: Bearer sk-ant-api03-topsecretanthropictoken123');
    logger.info('Cookie: tdl_session=abcdef1234567890abcdef; other=123');

    const logContent = readFileSync(testLogFile, 'utf-8');
    expect(logContent).not.toContain('topsecretanthropictoken123');
    expect(logContent).not.toContain('abcdef1234567890abcdef');
    expect(logContent).toContain('[REDACTED]');
  });

  // 4. SSE Soak Test: 1,000 events with simulated random disconnects & Last-Event-ID resume
  it('4. survives SSE soak test of 1,000 events with disconnects without dropped or duplicate events', async () => {
    const memDb = new DatabaseStore(':memory:');
    const hub = new SSEHub(memDb);
    const sessionId = createId();

    const receivedEvents: Array<{ seq: number; data: unknown }> = [];
    let currentConnection: SSEClientConnection | null = null;

    const createClientConnection = (): SSEClientConnection => ({
      id: createId(),
      sessionId,
      send: (seq, event, data) => {
        if (event !== 'ping') {
          receivedEvents.push({ seq, data });
        }
      },
      close: () => {},
    });

    currentConnection = createClientConnection();
    hub.subscribe(sessionId, currentConnection);

    const TOTAL_EVENTS = 1000;
    const DISCONNECT_AT = [200, 450, 750];

    for (let i = 1; i <= TOTAL_EVENTS; i++) {
      hub.publish(sessionId, 'stream_chunk', { index: i, payload: `chunk_${i}` });

      if (DISCONNECT_AT.includes(i)) {
        // Simulate client disconnect
        hub.unsubscribe(sessionId, currentConnection!);
        const lastSeq = receivedEvents[receivedEvents.length - 1]?.seq;

        // Simulate client reconnect with Last-Event-ID
        currentConnection = createClientConnection();
        hub.subscribe(sessionId, currentConnection, String(lastSeq));
      }
    }

    hub.stop();

    // Verify all 1,000 events received
    expect(receivedEvents.length).toBe(TOTAL_EVENTS);

    // Verify strict sequential ordering with zero duplicates and zero missing
    for (let i = 0; i < TOTAL_EVENTS; i++) {
      expect(receivedEvents[i].seq).toBe(i + 1);
      expect((receivedEvents[i].data as any).index).toBe(i + 1);
    }
  });

  // 5. Two-Client Approval Race: first answer wins, second gets 409 already_resolved
  it('5. resolves two-client permission approval race with first-answer-wins and 409 already_resolved', async () => {
    // Create session
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspace: tmpWorkspace,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        mode: 'ask',
      }),
    });
    expect(createRes.status).toBe(201);
    const { session } = await createRes.json();

    // Pair a web client
    const pairCodeRes = await fetch(`${baseUrl}/api/pair/code`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${daemon.cliToken}` },
    });
    const { code } = await pairCodeRes.json();

    const pairRes = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(pairRes.status).toBe(200);
    const cookieHeader = pairRes.headers.get('set-cookie')?.split(';')[0] || '';

    // Create a pending permission request in PermissionRegistry directly
    const req = daemon.permissionEngine.registry.createRequest({
      sessionId: session.id,
      toolRunId: createId(),
      tool: 'bash',
      toolClass: 'exec',
      input: { command: 'npm test' },
      workspacePath: tmpWorkspace,
      normalizedPattern: 'bash:npm test',
      canAllowAlways: true,
    });

    // Client 1 (CLI) and Client 2 (Web) answer concurrently
    const [resCli, resWeb] = await Promise.all([
      fetch(`${baseUrl}/api/sessions/${session.id}/permissions/${req.id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${daemon.cliToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: 'allow_once' }),
      }),
      fetch(`${baseUrl}/api/sessions/${session.id}/permissions/${req.id}`, {
        method: 'POST',
        headers: {
          Cookie: cookieHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ decision: 'deny' }),
      }),
    ]);

    const statuses = [resCli.status, resWeb.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = resCli.status === 200 ? resCli : resWeb;
    const loser = resCli.status === 409 ? resCli : resWeb;

    const winnerBody = await winner.json();
    const loserBody = await loser.json();

    expect(winnerBody.ok).toBe(true);
    expect(loserBody.error.code).toBe('already_resolved');
  });

  // 6. Interrupted Session Recovery
  it('6. recovers interrupted session and preserves previous messages on startup', async () => {
    // Manually create a session in DB with 'running' status
    const session = daemon.db.createSession({
      workspace_path: tmpWorkspace,
      provider_id: 'anthropic',
      model: 'claude-3-5-sonnet-latest',
      mode: 'ask',
      title: 'Interrupted turn session',
    });

    daemon.db.updateSession(session.id, { status: 'running' });
    daemon.db.createMessage({
      session_id: session.id,
      role: 'assistant',
      origin: 'system',
      content_json: JSON.stringify([{ type: 'text', text: 'Partial output before unexpected kill' }]),
    });

    // Run recovery
    const recovered = recoverInterruptedSessions(daemon.db);
    expect(recovered.length).toBeGreaterThanOrEqual(1);
    expect(recovered.some((s) => s.id === session.id)).toBe(true);

    const reloaded = daemon.db.getSession(session.id);
    expect(reloaded?.status).toBe('interrupted');

    const messages = daemon.db.listMessages(session.id);
    expect(messages.length).toBe(1);
    expect(JSON.parse(messages[0].content_json)).toEqual([
      { type: 'text', text: 'Partial output before unexpected kill' },
    ]);
  });

  // 7. Workspace Deleted Mid-Session
  it('7. safely handles workspace directory deleted mid-session without crashing daemon', async () => {
    const deletedWorkspace = mkdtempSync(join(tmpdir(), 'tendril-deleted-ws-'));

    // Create session with this workspace
    const createRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspace: deletedWorkspace,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        mode: 'ask',
      }),
    });
    expect(createRes.status).toBe(201);
    const { session } = await createRes.json();

    // Now delete the workspace directory completely
    rmSync(deletedWorkspace, { recursive: true, force: true });
    expect(existsSync(deletedWorkspace)).toBe(false);

    // Attempt to start a turn on this session
    const turnRes = await fetch(`${baseUrl}/api/sessions/${session.id}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${daemon.cliToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: 'List the files in this deleted workspace' }),
    });

    // Must return clean 400 error rather than unhandled server crash
    expect(turnRes.status).toBe(400);
    const body = await turnRes.json();
    expect(body.error.code).toBe('workspace_not_found');

    // Health check still responds 200
    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
  });

  // 8. DB Corruption Refusal
  it('8. refuses to start daemon if SQLite database file header is corrupt', async () => {
    const corruptHome = mkdtempSync(join(tmpdir(), 'tendril-corrupt-home-'));
    const corruptDbPath = join(corruptHome, 'tendril.db');

    // Write corrupted non-SQLite content
    writeFileSync(corruptDbPath, 'CORRUPTED_GARBAGE_NOT_A_VALID_SQLITE_DATABASE_HEADER\n');

    let errorThrown = false;
    try {
      await startDaemon({
        port: 0,
        customHome: corruptHome,
        wakeLock: false,
        acquireLock: false,
        setupSignalHandlers: false,
      });
    } catch (err: any) {
      errorThrown = true;
      expect(err.message.toLowerCase()).toContain('database');
    }

    expect(errorThrown).toBe(true);

    try {
      rmSync(corruptHome, { recursive: true, force: true });
    } catch {}
  });
});
