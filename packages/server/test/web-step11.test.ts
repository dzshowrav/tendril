import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ProviderAdapter, createId, WorkspaceGuard } from '@tendril/core';
import { startDaemon, DaemonInstance } from '../src/daemon.js';

describe('Step 11: Web UI Part 2 Integration Tests (Changes, Diff, Undo, Files, Settings, Doctor)', () => {
  let tmpHome: string;
  let tmpWorkspace: string;
  let daemon: DaemonInstance;
  let baseUrl: string;

  const fakeProvider: ProviderAdapter = {
    stream: async function* () {
      yield { type: 'text_delta', text: 'Step 11 response' };
      yield { type: 'stop', reason: 'end_turn' };
    },
  };

  beforeEach(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tendril-web11-test-home-'));
    tmpWorkspace = mkdtempSync(join(tmpdir(), 'tendril-web11-test-ws-'));

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

  // Helper to pair web client and return cookie header and client ID
  async function pairWebClient(): Promise<{ cookie: string; clientId: string }> {
    const { code } = daemon.pairingManager.createPairingCode();
    const res = await fetch(`${baseUrl}/api/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, label: 'Test Web Client' }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    const setCookie = res.headers.get('set-cookie')!;
    const cookie = setCookie.split(';')[0];
    return { cookie, clientId: data.client.id };
  }

  // Helper to create session
  async function createSession(cookie: string): Promise<string> {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspace: tmpWorkspace,
        title: 'Step 11 Session',
      }),
    });
    expect(res.status).toBe(201);
    const { session } = await res.json();
    return session.id;
  }

  // 1. Changes list, Diff rendering, Undo restoring file on disk, row shows Undone
  it('shows edits in Changes, renders diff with add/remove lines, undo restores disk file and marks Undone', async () => {
    const { cookie } = await pairWebClient();
    const sessionId = await createSession(cookie);

    // Initial file on disk
    const targetFile = 'hello.txt';
    const filePath = join(tmpWorkspace, targetFile);
    const initialContent = 'Hello World\nLine 2\n';
    writeFileSync(filePath, initialContent, 'utf8');

    // Simulate agent edit: create message, tool run, snapshot, and apply edit
    const msg = daemon.db.createMessage({
      session_id: sessionId,
      role: 'assistant',
      content_json: '[]',
      origin: 'cli',
    });

    const toolRun = daemon.db.createToolRun({
      session_id: sessionId,
      message_id: msg.id,
      tool_use_id: 'tool_edit_1',
      name: 'edit_file',
      class: 'edit',
      input_json: JSON.stringify({ path: targetFile }),
      status: 'ok',
      decision: 'allow_once',
    });

    const modifiedContent = 'Hello World\nLine 2 Modified\nLine 3 Added\n';
    const beforeHash = createHash('sha256').update(initialContent).digest('hex');
    const afterHash = createHash('sha256').update(modifiedContent).digest('hex');

    daemon.db.createSnapshot({
      session_id: sessionId,
      tool_run_id: toolRun.id,
      path: targetFile,
      existed_before: 1,
      content_before: Buffer.from(initialContent, 'utf8'),
      sha256_before: beforeHash,
      sha256_after: afterHash,
      diff_unified: '--- hello.txt\n+++ hello.txt\n@@ -1,2 +1,3 @@\n Hello World\n-Line 2\n+Line 2 Modified\n+Line 3 Added\n',
      added_lines: 2,
      removed_lines: 1,
      skipped_reason: null,
    });

    // Write modified content to disk
    writeFileSync(filePath, modifiedContent, 'utf8');

    // 1a. Changes list via web API
    const changesRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/changes`, {
      headers: { Cookie: cookie },
    });
    expect(changesRes.status).toBe(200);
    const { changes } = await changesRes.json();
    expect(changes.length).toBe(1);

    const change = changes[0];
    expect(change.path).toBe(targetFile);
    expect(change.tool_run_id).toBe(toolRun.id);
    expect(change.added_lines).toBe(2);
    expect(change.removed_lines).toBe(1);
    expect(change.diff_unified).toContain('+Line 2 Modified');
    expect(change.diff_unified).toContain('-Line 2');
    expect(change.undone_at).toBeNull();

    // 1b. Call Undo endpoint
    const undoRes = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/changes/${toolRun.id}/undo`,
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ force: false }),
      },
    );
    expect(undoRes.status).toBe(200);
    const undoData = await undoRes.json();
    expect(undoData.ok).toBe(true);

    // 1c. Verify file on disk is restored to original content
    const diskContent = readFileSync(filePath, 'utf8');
    expect(diskContent).toBe(initialContent);

    // 1d. Changes list now shows undone_at is set
    const refreshedChangesRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/changes`, {
      headers: { Cookie: cookie },
    });
    const refreshedChanges = await refreshedChangesRes.json();
    expect(refreshedChanges.changes[0].undone_at).not.toBeNull();
  });

  // 2. Conflict dialog on manual external edits and Force Undo
  it('returns 409 conflict when file was modified on disk since edit, and force:true restores it', async () => {
    const { cookie } = await pairWebClient();
    const sessionId = await createSession(cookie);

    const targetFile = 'conflict.txt';
    const filePath = join(tmpWorkspace, targetFile);
    const v0 = 'Version 0 original\n';
    const v1 = 'Version 1 by agent\n';
    writeFileSync(filePath, v0, 'utf8');

    const msg = daemon.db.createMessage({
      session_id: sessionId,
      role: 'assistant',
      content_json: '[]',
      origin: 'cli',
    });

    const toolRun = daemon.db.createToolRun({
      session_id: sessionId,
      message_id: msg.id,
      tool_use_id: 'tool_edit_conflict',
      name: 'edit_file',
      class: 'edit',
      input_json: JSON.stringify({ path: targetFile }),
      status: 'ok',
      decision: 'allow_once',
    });

    const hash0 = createHash('sha256').update(v0).digest('hex');
    const hash1 = createHash('sha256').update(v1).digest('hex');

    daemon.db.createSnapshot({
      session_id: sessionId,
      tool_run_id: toolRun.id,
      path: targetFile,
      existed_before: 1,
      content_before: Buffer.from(v0, 'utf8'),
      sha256_before: hash0,
      sha256_after: hash1,
      diff_unified: '--- conflict.txt\n+++ conflict.txt\n-Version 0 original\n+Version 1 by agent\n',
      added_lines: 1,
      removed_lines: 1,
      skipped_reason: null,
    });

    // Write manual edit to disk
    const manualEdit = 'Manual human edit on disk outside Tendril\n';
    writeFileSync(filePath, manualEdit, 'utf8');

    // Attempt Undo without force -> 409 conflict
    const conflictRes = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/changes/${toolRun.id}/undo`,
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ force: false }),
      },
    );
    expect(conflictRes.status).toBe(409);
    const conflictData = await conflictRes.json();
    expect(conflictData.error.code).toBe('conflict');
    expect(conflictData.error.needsForce).toBe(true);

    // File on disk remains untouched
    expect(readFileSync(filePath, 'utf8')).toBe(manualEdit);

    // Force Undo -> 200 ok
    const forceRes = await fetch(
      `${baseUrl}/api/sessions/${sessionId}/changes/${toolRun.id}/undo`,
      {
        method: 'POST',
        headers: {
          Cookie: cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ force: true }),
      },
    );
    expect(forceRes.status).toBe(200);

    // File on disk is now restored to original v0
    expect(readFileSync(filePath, 'utf8')).toBe(v0);
  });

  // 3. Adding a provider in Settings makes it selectable in New session
  it('allows adding and configuring providers in Settings and selecting them in sessions', async () => {
    const { cookie } = await pairWebClient();

    // Add new provider
    const putRes = await fetch(`${baseUrl}/api/providers/custom-deepseek`, {
      method: 'PUT',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Custom DeepSeek',
        type: 'openai-compatible',
        baseUrl: 'https://api.deepseek.com/v1',
        apiKey: 'sk-deepseek-12345678',
      }),
    });
    expect(putRes.status).toBe(200);

    // Verify it appears in providers list with masked key
    const listRes = await fetch(`${baseUrl}/api/providers`, {
      headers: { Cookie: cookie },
    });
    expect(listRes.status).toBe(200);
    const { providers } = await listRes.json();
    const added = providers.find((p: any) => p.id === 'custom-deepseek');
    expect(added).toBeDefined();
    expect(added.name).toBe('Custom DeepSeek');
    expect(added.maskedKey).toContain('••••5678');

    // Test connection
    const testRes = await fetch(`${baseUrl}/api/providers/custom-deepseek/test`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(testRes.status).toBe(200);
    const testData = await testRes.json();
    expect(testData.ok).toBe(true);

    // Create new session specifying the newly added provider
    const newSessionRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: {
        Cookie: cookie,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        workspace: tmpWorkspace,
        provider: 'custom-deepseek',
        model: 'deepseek-chat',
        title: 'DeepSeek Session',
      }),
    });
    expect(newSessionRes.status).toBe(201);
    const { session } = await newSessionRes.json();
    expect(session.provider_id).toBe('custom-deepseek');
    expect(session.model).toBe('deepseek-chat');
  });

  // 4. Revoking current device lands on Pair (subsequent requests rejected with 401)
  it('revokes paired client and invalidates its session cookie', async () => {
    const { cookie, clientId } = await pairWebClient();

    // Verify authenticated request works
    const check1 = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Cookie: cookie },
    });
    expect(check1.status).toBe(200);

    // Revoke the client
    const revokeRes = await fetch(`${baseUrl}/api/clients/${clientId}`, {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(revokeRes.status).toBe(200);

    // Subsequent request with the same cookie is now rejected with 401
    const check2 = await fetch(`${baseUrl}/api/sessions`, {
      headers: { Cookie: cookie },
    });
    expect(check2.status).toBe(401);
  });

  // 5. Doctor button lists every check with a fix line
  it('returns all system health diagnostic checks with status and fix recommendations', async () => {
    const { cookie } = await pairWebClient();

    const docRes = await fetch(`${baseUrl}/api/doctor`, {
      headers: { Cookie: cookie },
    });
    expect(docRes.status).toBe(200);
    const data = await docRes.json();
    const checks = data.results?.checks || data.results;

    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThanOrEqual(3);

    for (const check of checks) {
      expect(check.id).toBeDefined();
      expect(['pass', 'warn', 'fail']).toContain(check.status.toLowerCase());
      expect(check.message).toBeDefined();
      if (check.status.toLowerCase() !== 'pass') {
        expect(typeof check.fix).toBe('string');
        expect(check.fix.length).toBeGreaterThan(0);
      }
    }
  });

  // 6. Files browser and 1 MB cap viewer
  it('lists directory files, allows reading file contents, and enforces 1 MB cap', async () => {
    const { cookie } = await pairWebClient();
    const sessionId = await createSession(cookie);

    // Create sample files
    writeFileSync(join(tmpWorkspace, 'small.txt'), 'Hello Small File\n', 'utf8');

    // Create file exceeding 1 MB (1.1 MB)
    const largeBuffer = Buffer.alloc(1100 * 1024, 'a');
    writeFileSync(join(tmpWorkspace, 'large.bin'), largeBuffer);

    // List files
    const listRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/files`, {
      headers: { Cookie: cookie },
    });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    expect(listData.files.some((f: any) => f.name === 'small.txt')).toBe(true);
    expect(listData.files.some((f: any) => f.name === 'large.bin')).toBe(true);

    // Read small file -> 200 ok
    const smallRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/file?path=small.txt`, {
      headers: { Cookie: cookie },
    });
    expect(smallRes.status).toBe(200);
    const smallData = await smallRes.json();
    expect(smallData.content).toBe('Hello Small File\n');

    // Read large file -> 413 Too Large
    const largeRes = await fetch(`${baseUrl}/api/sessions/${sessionId}/file?path=large.bin`, {
      headers: { Cookie: cookie },
    });
    expect(largeRes.status).toBe(413);
    const largeData = await largeRes.json();
    expect(largeData.error.code).toBe('too_large');
  });
});
