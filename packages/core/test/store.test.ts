import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseStore } from '../src/store.js';
import { saveAuth, DEFAULT_AUTH } from '../src/auth.js';
import { DatabaseSync } from 'node:sqlite';

describe('store module', () => {
  let tempHome: string;
  let dbPath: string;
  let authPath: string;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'tendril-store-test-'));
    dbPath = join(tempHome, 'tendril.db');
    authPath = join(tempHome, 'auth.json');
  });

  afterEach(() => {
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch {}
  });

  it('fulfills Step 2 Done When criteria', () => {
    // 1. Create a temp home and save auth.json with 0600 mode
    saveAuth(authPath, DEFAULT_AUTH);
    if (process.platform !== 'win32') {
      const authStat = statSync(authPath);
      expect((authStat.mode & 0o777)).toBe(0o600);
    }

    // 2. Run migrations and verify DB file mode is 0600
    const store = new DatabaseStore(dbPath);
    if (process.platform !== 'win32') {
      const dbStat = statSync(dbPath);
      expect((dbStat.mode & 0o777)).toBe(0o600);
    }

    // 3. Insert and read one row in every table
    // (a) sessions
    const session = store.createSession({
      title: 'Test Session',
      workspace_path: '/data/workspace/test',
      provider_id: 'anthropic',
      model: 'claude-sonnet-5-5',
      mode: 'ask',
      status: 'idle',
    });
    expect(session.id).toBeDefined();
    const readSession = store.getSession(session.id);
    expect(readSession).not.toBeNull();
    expect(readSession?.title).toBe('Test Session');
    expect(readSession?.workspace_path).toBe('/data/workspace/test');

    // (b) messages
    const message = store.createMessage({
      session_id: session.id,
      seq: 1,
      role: 'user',
      content_json: JSON.stringify([{ type: 'text', text: 'Hello Tendril' }]),
      origin: 'cli',
    });
    expect(message.id).toBeDefined();
    const readMessage = store.getMessage(message.id);
    expect(readMessage).not.toBeNull();
    expect(readMessage?.session_id).toBe(session.id);
    expect(readMessage?.role).toBe('user');

    // (c) tool_runs
    const toolRun = store.createToolRun({
      session_id: session.id,
      message_id: message.id,
      tool_use_id: 'call_12345',
      name: 'read_file',
      class: 'read',
      input_json: JSON.stringify({ path: 'test.txt' }),
      status: 'ok',
      result_preview: 'file contents',
    });
    expect(toolRun.id).toBeDefined();
    const readToolRun = store.getToolRun(toolRun.id);
    expect(readToolRun).not.toBeNull();
    expect(readToolRun?.name).toBe('read_file');
    expect(readToolRun?.class).toBe('read');

    // (d) snapshots
    const sampleBuffer = Buffer.from('console.log("hello");');
    const snapshot = store.createSnapshot({
      session_id: session.id,
      tool_run_id: toolRun.id,
      path: 'src/index.js',
      existed_before: 1,
      content_before: sampleBuffer,
      sha256_before: 'hash_before_123',
      sha256_after: 'hash_after_456',
      diff_unified: '--- a/src/index.js\n+++ b/src/index.js\n',
      added_lines: 1,
      removed_lines: 0,
    });
    expect(snapshot.id).toBeDefined();
    const readSnapshot = store.getSnapshot(snapshot.id);
    expect(readSnapshot).not.toBeNull();
    expect(readSnapshot?.path).toBe('src/index.js');
    expect(readSnapshot?.content_before).toBeDefined();
    expect(Buffer.from(readSnapshot!.content_before!).toString()).toBe('console.log("hello");');

    // (e) permission_rules
    const rule = store.createPermissionRule({
      workspace_path: '/data/workspace/test',
      tool: 'bash',
      pattern: 'npm test',
      decision: 'allow',
    });
    expect(rule.id).toBeDefined();
    const readRule = store.getPermissionRule(rule.id);
    expect(readRule).not.toBeNull();
    expect(readRule?.pattern).toBe('npm test');
    const foundRule = store.findPermissionRule('/data/workspace/test', 'bash', 'npm test');
    expect(foundRule?.id).toBe(rule.id);

    // (f) web_clients
    const client = store.createWebClient({
      token_hash: 'sha256_dummy_token_hash_value',
      label: 'Pixel Browser',
      user_agent: 'Mozilla/5.0 Android',
    });
    expect(client.id).toBeDefined();
    const readClient = store.getWebClient(client.id);
    expect(readClient).not.toBeNull();
    expect(readClient?.label).toBe('Pixel Browser');
    const clientByHash = store.getWebClientByTokenHash('sha256_dummy_token_hash_value');
    expect(clientByHash?.id).toBe(client.id);

    // 4. Test cascade delete on session
    const deleted = store.deleteSession(session.id);
    expect(deleted).toBe(true);
    expect(store.getSession(session.id)).toBeNull();
    expect(store.getMessage(message.id)).toBeNull();
    expect(store.getToolRun(toolRun.id)).toBeNull();
    expect(store.getSnapshot(snapshot.id)).toBeNull();

    // Permission rules and web clients should NOT be deleted by session cascade
    expect(store.getPermissionRule(rule.id)).not.toBeNull();
    expect(store.getWebClient(client.id)).not.toBeNull();

    store.close();

    // 5. Confirm a database with a higher schema_migrations.version is refused
    const rawDb = new DatabaseSync(dbPath);
    rawDb.exec("INSERT INTO schema_migrations (version, applied_at) VALUES (99, '2099-01-01T00:00:00.000Z');");
    rawDb.close();

    expect(() => {
      new DatabaseStore(dbPath);
    }).toThrow(/newer than application version/);
  });
});
