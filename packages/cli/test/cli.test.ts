import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProviderAdapter, getTendrilPaths, ensureTendrilLayout } from '@tendril/core';
import { startDaemon, DaemonInstance } from '@tendril/server';
import { createCli, runCli } from '../src/index.js';
import { TendrilClient } from '../src/client.js';
import { getSymbols, isAsciiMode, theme } from '../src/ui/theme.js';

describe('CLI Commands & Features', () => {
  let tmpHome: string;
  let tmpWorkspace: string;
  let daemon: DaemonInstance | null = null;

  const fakeProvider: ProviderAdapter = {
    stream: async function* () {
      yield { type: 'text_delta', text: 'Hello from CLI agent!' };
      yield { type: 'stop', reason: 'end_turn' };
    },
  };

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tendril-cli-test-home-'));
    tmpWorkspace = mkdtempSync(join(tmpdir(), 'tendril-cli-test-ws-'));
    ensureTendrilLayout(getTendrilPaths(tmpHome));
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
      daemon = null;
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

  it('registers all required CLI commands', () => {
    const cli = createCli();
    const commandNames = cli.commands.map((c) => c.name);

    expect(commandNames).toContain('doctor');
    expect(commandNames).toContain('ask');
    expect(commandNames).toContain('login');
    expect(commandNames).toContain('sessions');
    expect(commandNames).toContain('resume');
    expect(commandNames).toContain('pair');
    expect(commandNames).toContain('ui');
    expect(commandNames).toContain('serve');
    expect(commandNames).toContain('stop');
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('logs');
  });

  it('runs doctor with --json flag and produces valid JSON', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'tendril', 'doctor', '--json']);

    expect(logSpy).toHaveBeenCalled();
    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const parsed = JSON.parse(output);

    expect(parsed.ok).toBe(true);
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(parsed.checks.some((c: any) => c.id === 'node_version')).toBe(true);
    expect(parsed.checks.some((c: any) => c.id === 'sqlite')).toBe(true);

    logSpy.mockRestore();
  });

  it('reports STOPPED when daemon is not running', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'tendril', 'status', '--home', tmpHome]);

    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('STOPPED');
    logSpy.mockRestore();
  });

  it('generates pairing code with pair --json against running daemon', async () => {
    daemon = await startDaemon({
      port: 0,
      customHome: tmpHome,
      wakeLock: false,
      acquireLock: false,
      setupSignalHandlers: false,
      providerAdapter: fakeProvider,
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'tendril', 'pair', '--json', '--home', tmpHome]);

    const output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const parsed = JSON.parse(output);

    expect(parsed.code).toMatch(/^\d{6}$/);
    expect(parsed.url).toContain(`/pair#code=${parsed.code}`);
    expect(parsed.port).toBe(daemon.port);

    logSpy.mockRestore();
  });

  it('lists, renames, and deletes sessions via CLI client', async () => {
    daemon = await startDaemon({
      port: 0,
      customHome: tmpHome,
      wakeLock: false,
      acquireLock: false,
      setupSignalHandlers: false,
      providerAdapter: fakeProvider,
    });

    const client = new TendrilClient({ customHome: tmpHome });
    const { session } = await client.createSession({
      workspace: tmpWorkspace,
      title: 'Initial Title',
      mode: 'ask',
    });

    // 1. List sessions
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'tendril', 'sessions', '--home', tmpHome]);
    let output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain(session.id.slice(0, 16));
    expect(output).toContain('Initial Title');
    logSpy.mockClear();

    // 2. Rename session
    await runCli(['node', 'tendril', 'sessions', 'rename', session.id, 'Renamed Title', '--home', tmpHome]);
    output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Renamed');

    const updated = await client.getSession(session.id);
    expect(updated.session.title).toBe('Renamed Title');
    logSpy.mockClear();

    // 3. Delete session
    await runCli(['node', 'tendril', 'sessions', 'rm', session.id, '--home', tmpHome]);
    output = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(output).toContain('Deleted');

    const list = await client.listSessions();
    expect(list.sessions.length).toBe(0);
    logSpy.mockRestore();
  });

  it('runs `tendril ask` one-shot turn with exit code 0', async () => {
    daemon = await startDaemon({
      port: 0,
      customHome: tmpHome,
      wakeLock: false,
      acquireLock: false,
      setupSignalHandlers: false,
      providerAdapter: fakeProvider,
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    process.exitCode = undefined;
    await runCli(['node', 'tendril', 'ask', 'Hello from test', '--dir', tmpWorkspace, '--home', tmpHome]);

    expect(process.exitCode || 0).toBe(0);

    const streamed = writeSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(streamed).toContain('Hello from CLI agent!');

    logSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it('runs `tendril ask` with --mode plan and --json stream', async () => {
    daemon = await startDaemon({
      port: 0,
      customHome: tmpHome,
      wakeLock: false,
      acquireLock: false,
      setupSignalHandlers: false,
      providerAdapter: fakeProvider,
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;

    await runCli([
      'node',
      'tendril',
      'ask',
      'Plan architecture',
      '--mode',
      'plan',
      '--json',
      '--dir',
      tmpWorkspace,
      '--home',
      tmpHome,
    ]);

    expect(process.exitCode || 0).toBe(0);

    const lines = logSpy.mock.calls.map((c) => c.join(' '));
    const events = lines
      .filter((l) => l.startsWith('{'))
      .map((l) => JSON.parse(l));

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'text.delta')).toBe(true);

    logSpy.mockRestore();
  });

  it('returns exit code 3 when daemon is completely unreachable in ask command', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;

    const fakeNonExistentHome = join(tmpdir(), 'non-existent-tendril-home-' + Date.now());
    await runCli(['node', 'tendril', 'ask', 'Hello unreachable', '--home', fakeNonExistentHome]);

    // Exit code 3 represents daemon / provider failure
    expect(process.exitCode).toBe(3);

    errorSpy.mockRestore();
  }, 10000);

  it('restores file via undoChange', async () => {
    daemon = await startDaemon({
      port: 0,
      customHome: tmpHome,
      wakeLock: false,
      acquireLock: false,
      setupSignalHandlers: false,
    });

    const client = new TendrilClient({ customHome: tmpHome });
    const { session } = await client.createSession({ workspace: tmpWorkspace });

    // Create a file in workspace
    const targetFile = join(tmpWorkspace, 'hello.txt');
    writeFileSync(targetFile, 'original content\n');

    // Record an edit snapshot manually in DB store
    const db = daemon.db;
    const msg = db.createMessage({
      session_id: session.id,
      role: 'assistant',
      content_json: JSON.stringify([{ type: 'text', text: 'editing' }]),
    });
    const tr = db.createToolRun({
      session_id: session.id,
      message_id: msg.id,
      tool_use_id: 'tool_use_test_123',
      name: 'edit_file',
      class: 'edit',
      input_json: JSON.stringify({ path: 'hello.txt' }),
    });

    // Write modified content
    const modifiedContent = 'modified content\n';
    writeFileSync(targetFile, modifiedContent);
    const sha256After = createHash('sha256').update(modifiedContent).digest('hex');

    // Create snapshot
    db.createSnapshot({
      session_id: session.id,
      tool_run_id: tr.id,
      path: 'hello.txt',
      existed_before: 1,
      content_before: Buffer.from('original content\n'),
      sha256_before: 'beforehash',
      sha256_after: sha256After,
      diff_unified: '--- hello.txt\n+++ hello.txt\n-original\n+modified\n',
      added_lines: 1,
      removed_lines: 1,
    });

    expect(readFileSync(targetFile, 'utf8')).toBe('modified content\n');

    // Perform undo
    const res = await client.undoChange(session.id, tr.id);
    expect(res.ok).toBe(true);

    // Verify content restored
    expect(readFileSync(targetFile, 'utf8')).toBe('original content\n');
  });

  it('respects TENDRIL_ASCII and theme settings', () => {
    const originalEnv = process.env.TENDRIL_ASCII;

    process.env.TENDRIL_ASCII = '1';
    expect(isAsciiMode()).toBe(true);
    const asciiSymbols = getSymbols();
    expect(asciiSymbols.prompt).toBe('>');
    expect(asciiSymbols.check).toBe('[OK]');

    process.env.TENDRIL_ASCII = '0';
    delete process.env.TENDRIL_ASCII;
    const unicodeSymbols = getSymbols();
    expect(unicodeSymbols.prompt).toBe('›');
    expect(unicodeSymbols.check).toBe('✔');

    if (originalEnv !== undefined) {
      process.env.TENDRIL_ASCII = originalEnv;
    }
  });
});
