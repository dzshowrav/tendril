import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { DatabaseStore } from '../src/store.js';
import { WorkspaceGuard } from '../src/workspace.js';
import { ReadTracker } from '../src/read-tracker.js';
import {
  writeFileTool,
  editFileTool,
  bashTool,
  webFetchTool,
  scrubEnvironment,
  truncateOutput,
} from '../src/tools/mutate-tools.js';
import { isCatastrophic } from '../src/tools/guard.js';
import { undoSnapshot, MAX_SNAPSHOT_FILE_SIZE } from '../src/tools/snapshots.js';
import { readFileTool } from '../src/tools/read-tools.js';

describe('Mutating Tools & Step 5 Contracts', () => {
  let tempDir: string;
  let workspace: WorkspaceGuard;
  let readTracker: ReadTracker;
  let store: DatabaseStore;
  let messageId: string;
  const sessionId = 'test-session-001';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tendril-mutate-test-'));
    workspace = new WorkspaceGuard(tempDir);
    readTracker = new ReadTracker();
    store = new DatabaseStore(':memory:');

    // Create session in db
    store.createSession({
      id: sessionId,
      title: 'Test Session',
      workspace_path: tempDir,
      provider_id: 'anthropic',
      model: 'claude-3-7-sonnet',
    });

    const msg = store.createMessage({
      session_id: sessionId,
      role: 'assistant',
      content_json: JSON.stringify([{ type: 'text', text: 'thinking' }]),
    });
    messageId = msg.id;
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ==========================================
  // 1. Table of >= 20 commands for isCatastrophic
  // ==========================================
  describe('Safety Guard (isCatastrophic)', () => {
    const testCases: Array<{ command: string; shouldBlock: boolean; reason: string }> = [
      // Blocked commands
      { command: 'rm -rf /', shouldBlock: true, reason: 'Root recursive delete' },
      { command: 'rm -rf /*', shouldBlock: true, reason: 'Root wildcard recursive delete' },
      { command: 'rm -fr /', shouldBlock: true, reason: 'Reversed flags root delete' },
      { command: 'rm -r -f /', shouldBlock: true, reason: 'Separated flags root delete' },
      { command: 'rm --recursive --force /', shouldBlock: true, reason: 'Long flags root delete' },
      { command: 'rm -rf ~', shouldBlock: true, reason: 'Home directory delete' },
      { command: 'rm -rf ~/', shouldBlock: true, reason: 'Home directory slash delete' },
      { command: 'rm -rf $HOME', shouldBlock: true, reason: '$HOME variable delete' },
      { command: 'rm -rf $PREFIX', shouldBlock: true, reason: '$PREFIX variable delete' },
      { command: 'rm -rf .', shouldBlock: true, reason: 'Current directory delete' },
      { command: ':(){ :|:& };:', shouldBlock: true, reason: 'Classic bash fork bomb' },
      { command: 'bomb(){ bomb|bomb& };bomb', shouldBlock: true, reason: 'Named fork bomb' },
      { command: 'dd if=/dev/zero of=/dev/sda', shouldBlock: true, reason: 'Raw disk overwrite' },
      { command: 'dd of=/dev/nvme0n1 if=/dev/urandom', shouldBlock: true, reason: 'NVMe overwrite' },
      { command: '> /dev/sda', shouldBlock: true, reason: 'Redirection to block device' },
      { command: 'mkfs.ext4 /dev/sda1', shouldBlock: true, reason: 'Filesystem format' },
      { command: 'mkswap /dev/sdb', shouldBlock: true, reason: 'Swap creation on disk' },
      { command: 'reboot', shouldBlock: true, reason: 'System reboot' },
      { command: 'shutdown -h now', shouldBlock: true, reason: 'System shutdown' },
      { command: 'poweroff', shouldBlock: true, reason: 'System poweroff' },
      { command: 'init 0', shouldBlock: true, reason: 'Init shutdown' },
      { command: 'init 6', shouldBlock: true, reason: 'Init reboot' },
      { command: 'chmod -R 777 /', shouldBlock: true, reason: 'Root recursive chmod' },
      { command: 'chown -R root:root $HOME', shouldBlock: true, reason: 'Home recursive chown' },
      { command: 'wipefs -a /dev/sda', shouldBlock: true, reason: 'Disk wipe' },
      { command: 'shred /dev/sda', shouldBlock: true, reason: 'Disk shred' },
      { command: 'echo ok && rm -rf /', shouldBlock: true, reason: 'Compound catastrophic command' },

      // Allowed commands
      { command: 'npm test', shouldBlock: false, reason: 'Normal npm test' },
      { command: 'git status', shouldBlock: false, reason: 'Git status' },
      { command: 'ls -la', shouldBlock: false, reason: 'List files' },
      { command: 'mkdir -p src/components', shouldBlock: false, reason: 'Make directory' },
      { command: 'rm -rf dist', shouldBlock: false, reason: 'Scoped build folder delete' },
      { command: 'rm -rf node_modules', shouldBlock: false, reason: 'Scoped package delete' },
      { command: 'rm -f test.tmp', shouldBlock: false, reason: 'Single file delete' },
      { command: 'cat package.json', shouldBlock: false, reason: 'Read package.json' },
      { command: 'echo "hello world" > output.txt', shouldBlock: false, reason: 'File redirect' },
      { command: 'find . -name "*.ts"', shouldBlock: false, reason: 'Find source files' },
      { command: 'grep -rn "TODO" .', shouldBlock: false, reason: 'Grep search' },
      { command: 'node scripts/build.mjs', shouldBlock: false, reason: 'Run build script' },
      { command: 'chmod +x test.sh', shouldBlock: false, reason: 'Scoped chmod +x' },
      { command: 'dd if=input.txt of=output.txt', shouldBlock: false, reason: 'File-to-file dd' },
      { command: 'python3 -m unittest', shouldBlock: false, reason: 'Run python tests' },
    ];

    it('classifies at least 20 command strings properly (both blocked and allowed)', () => {
      expect(testCases.length).toBeGreaterThanOrEqual(20);

      for (const tc of testCases) {
        const result = isCatastrophic(tc.command);
        expect(
          result,
          `Failed on "${tc.command}" (${tc.reason}): expected blocked=${tc.shouldBlock}, got=${result}`,
        ).toBe(tc.shouldBlock);
      }
    });
  });

  // ==========================================
  // 2. Stale-file refusal & Read-before-edit
  // ==========================================
  describe('Stale-file refusal and read-before-edit', () => {
    it('refuses edit_file if file was never read', async () => {
      const filePath = join(tempDir, 'sample.txt');
      writeFileSync(filePath, 'Initial content\n', 'utf8');

      await expect(
        editFileTool.execute(
          {
            path: 'sample.txt',
            old_string: 'Initial',
            new_string: 'Updated',
          },
          {
            sessionId,
            workspace,
            readTracker,
          },
        ),
      ).rejects.toThrow(/must be read before editing/i);
    });

    it('refuses write_file for existing file if not read first', async () => {
      const filePath = join(tempDir, 'existing.txt');
      writeFileSync(filePath, 'Old content\n', 'utf8');

      await expect(
        writeFileTool.execute(
          {
            path: 'existing.txt',
            content: 'Brand new content\n',
          },
          {
            sessionId,
            workspace,
            readTracker,
          },
        ),
      ).rejects.toThrow(/must be read before editing/i);
    });

    it('allows write_file if file is new (does not exist yet)', async () => {
      const res = await writeFileTool.execute(
        {
          path: 'brand-new.txt',
          content: 'Hello World\n',
        },
        {
          sessionId,
          workspace,
          readTracker,
        },
      );

      expect(res.path).toBe('brand-new.txt');
      expect(readFileSync(join(tempDir, 'brand-new.txt'), 'utf8')).toBe('Hello World\n');
      expect(readTracker.hasRead(sessionId, join(tempDir, 'brand-new.txt'))).toBe(true);
    });

    it('refuses edit_file if file changed on disk after reading (stale hash)', async () => {
      const filePath = join(tempDir, 'stale.txt');
      writeFileSync(filePath, 'Line 1\nLine 2\n', 'utf8');

      // Read file through readFileTool
      await readFileTool.execute({ path: 'stale.txt' }, { sessionId, workspace, readTracker });

      // Simulate outside edit
      writeFileSync(filePath, 'Line 1 modified outside\nLine 2\n', 'utf8');

      await expect(
        editFileTool.execute(
          {
            path: 'stale.txt',
            old_string: 'Line 2',
            new_string: 'Line 2 modified',
          },
          {
            sessionId,
            workspace,
            readTracker,
          },
        ),
      ).rejects.toThrow(/changed on disk since it was last read/i);
    });
  });

  // ==========================================
  // 3. edit_file uniqueness rule & replace_all
  // ==========================================
  describe('edit_file match uniqueness', () => {
    it('throws error when target string has 0 matches', async () => {
      const filePath = join(tempDir, 'code.ts');
      writeFileSync(filePath, 'const a = 1;\nconst b = 2;\n', 'utf8');

      await readFileTool.execute({ path: 'code.ts' }, { sessionId, workspace, readTracker });

      await expect(
        editFileTool.execute(
          {
            path: 'code.ts',
            old_string: 'const c = 3;',
            new_string: 'const c = 4;',
          },
          {
            sessionId,
            workspace,
            readTracker,
          },
        ),
      ).rejects.toThrow(/Target string not found/i);
    });

    it('throws error when target string has 2 matches without replace_all', async () => {
      const filePath = join(tempDir, 'duplicate.txt');
      writeFileSync(filePath, 'item: apple\nitem: apple\n', 'utf8');

      await readFileTool.execute({ path: 'duplicate.txt' }, { sessionId, workspace, readTracker });

      await expect(
        editFileTool.execute(
          {
            path: 'duplicate.txt',
            old_string: 'item: apple',
            new_string: 'item: orange',
          },
          {
            sessionId,
            workspace,
            readTracker,
          },
        ),
      ).rejects.toThrow(/found 2 times/i);
    });

    it('successfully replaces all matches when replace_all is true', async () => {
      const filePath = join(tempDir, 'duplicate2.txt');
      writeFileSync(filePath, 'item: apple\nitem: apple\n', 'utf8');

      await readFileTool.execute({ path: 'duplicate2.txt' }, { sessionId, workspace, readTracker });

      const res = await editFileTool.execute(
        {
          path: 'duplicate2.txt',
          old_string: 'item: apple',
          new_string: 'item: orange',
          replace_all: true,
        },
        {
          sessionId,
          workspace,
          readTracker,
        },
      );

      expect(res.replacements).toBe(2);
      expect(readFileSync(filePath, 'utf8')).toBe('item: orange\nitem: orange\n');
    });
  });

  // ==========================================
  // 4. Snapshot & Undo restore
  // ==========================================
  describe('Snapshot creation and Undo restoration', () => {
    it('creates snapshot on edit and restores exact content on undo', async () => {
      const filePath = join(tempDir, 'restore.txt');
      const originalText = 'First line\nSecond line\nThird line\n';
      writeFileSync(filePath, originalText, 'utf8');

      await readFileTool.execute({ path: 'restore.txt' }, { sessionId, workspace, readTracker });

      const toolRun = store.createToolRun({
        session_id: sessionId,
        message_id: messageId,
        tool_use_id: 'tool_use_restore_001',
        name: 'edit_file',
        class: 'edit',
        input_json: JSON.stringify({ path: 'restore.txt' }),
      });

      const editRes = await editFileTool.execute(
        {
          path: 'restore.txt',
          old_string: 'Second line',
          new_string: 'Modified second line',
        },
        {
          sessionId,
          workspace,
          readTracker,
          db: store,
          toolRunId: toolRun.id,
        },
      );

      expect(editRes.snapshotId).toBeDefined();
      expect(readFileSync(filePath, 'utf8')).toBe('First line\nModified second line\nThird line\n');

      // Now undo
      const undoRes = undoSnapshot({
        sessionId,
        workspace,
        db: store,
        readTracker,
      });

      expect(undoRes.action).toBe('restored');
      expect(readFileSync(filePath, 'utf8')).toBe(originalText);

      // Verify DB snapshot row is marked undone
      const snapshot = store.getSnapshot(undoRes.snapshotId);
      expect(snapshot?.undone_at).not.toBeNull();
    });

    it('deletes created file on undo for write_file', async () => {
      const toolRun = store.createToolRun({
        session_id: sessionId,
        message_id: messageId,
        tool_use_id: 'tool_use_write_002',
        name: 'write_file',
        class: 'edit',
        input_json: JSON.stringify({ path: 'new-file.txt' }),
      });

      const writeRes = await writeFileTool.execute(
        {
          path: 'new-file.txt',
          content: 'I will be deleted\n',
        },
        {
          sessionId,
          workspace,
          readTracker,
          db: store,
          toolRunId: toolRun.id,
        },
      );

      expect(existsSync(join(tempDir, 'new-file.txt'))).toBe(true);

      const undoRes = undoSnapshot({
        sessionId,
        snapshotId: writeRes.snapshotId,
        workspace,
        db: store,
        readTracker,
      });

      expect(undoRes.action).toBe('deleted');
      expect(existsSync(join(tempDir, 'new-file.txt'))).toBe(false);
    });

    it('refuses undo after outside modification unless --force is provided', async () => {
      const filePath = join(tempDir, 'conflict.txt');
      writeFileSync(filePath, 'Original\n', 'utf8');

      await readFileTool.execute({ path: 'conflict.txt' }, { sessionId, workspace, readTracker });

      const toolRun = store.createToolRun({
        session_id: sessionId,
        message_id: messageId,
        tool_use_id: 'tool_use_edit_003',
        name: 'edit_file',
        class: 'edit',
        input_json: JSON.stringify({ path: 'conflict.txt' }),
      });

      await editFileTool.execute(
        {
          path: 'conflict.txt',
          old_string: 'Original',
          new_string: 'Agent Edit',
        },
        {
          sessionId,
          workspace,
          readTracker,
          db: store,
          toolRunId: toolRun.id,
        },
      );

      // Outside edit modifies the file after agent edit
      writeFileSync(filePath, 'Agent Edit modified by user\n', 'utf8');

      // Attempt undo without force -> must throw conflict error
      expect(() =>
        undoSnapshot({
          sessionId,
          workspace,
          db: store,
          readTracker,
          force: false,
        }),
      ).toThrow(/modified since snapshot was created.*--force/i);

      // With force = true -> successfully overwrites and restores
      const forceUndoRes = undoSnapshot({
        sessionId,
        workspace,
        db: store,
        readTracker,
        force: true,
      });

      expect(forceUndoRes.action).toBe('restored');
      expect(readFileSync(filePath, 'utf8')).toBe('Original\n');
    });
  });

  // ==========================================
  // 5. Bash tool: environment scrubbing, timeouts, abort, process trees
  // ==========================================
  describe('Bash execution engine', () => {
    it('blocks catastrophic command execution', async () => {
      await expect(
        bashTool.execute(
          {
            command: 'rm -rf /',
          },
          {
            sessionId,
            workspace,
            readTracker,
          },
        ),
      ).rejects.toThrow(/blocked by safety guard/i);
    });

    it('scrubs API keys, secrets, tokens, and TENDRIL_* from child environment', async () => {
      // Set test environment variables
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-secret';
      process.env.OPENAI_API_KEY = 'sk-openai-secret';
      process.env.TENDRIL_TEST_KEY = 'secret-tendril';
      process.env.MY_APP_PASSWORD = 'password123';
      process.env.NORMAL_TEST_VAR = 'tendril-safe-var';

      try {
        const res = await bashTool.execute(
          {
            command: 'node -e "console.log(JSON.stringify(process.env))"',
          },
          {
            sessionId,
            workspace,
            readTracker,
          },
        );

        const childEnv = JSON.parse(res.stdout);
        expect(childEnv.ANTHROPIC_API_KEY).toBeUndefined();
        expect(childEnv.OPENAI_API_KEY).toBeUndefined();
        expect(childEnv.TENDRIL_TEST_KEY).toBeUndefined();
        expect(childEnv.MY_APP_PASSWORD).toBeUndefined();
        expect(childEnv.NORMAL_TEST_VAR).toBe('tendril-safe-var');
        expect(childEnv.TERM).toBe('dumb');
        expect(childEnv.NO_COLOR).toBe('1');
      } finally {
        delete process.env.ANTHROPIC_API_KEY;
        delete process.env.OPENAI_API_KEY;
        delete process.env.TENDRIL_TEST_KEY;
        delete process.env.MY_APP_PASSWORD;
        delete process.env.NORMAL_TEST_VAR;
      }
    });

    it('kills a child and its grandchild processes when timeout expires', async () => {
      const marker = 'tendril_grandchild_test';

      const res = await bashTool.execute(
        {
          command: `sh -c "sleep 30 & wait"`,
          timeout: 1, // 1 second timeout
        },
        {
          sessionId,
          workspace,
          readTracker,
        },
      );

      expect(res.timed_out).toBe(true);
      expect(res.exit_code).toBe(124);

      // Verify grandchild is not running
      const psOutput = execSync('ps -ef || ps').toString('utf8');
      expect(psOutput.includes('sleep 30')).toBe(false);
    });

    it('kills the process tree when AbortSignal triggers', async () => {
      const controller = new AbortController();

      const execPromise = bashTool.execute(
        {
          command: 'sh -c "sleep 30 & wait"',
        },
        {
          sessionId,
          workspace,
          readTracker,
          signal: controller.signal,
        },
      );

      // Abort after 200ms
      setTimeout(() => controller.abort(), 200);

      await expect(execPromise).rejects.toThrow(/aborted/i);

      // Wait a moment for process exit and verify no leaked process
      await new Promise((r) => setTimeout(r, 200));
      const psOutput = execSync('ps -ef || ps').toString('utf8');
      expect(psOutput.includes('sleep 30')).toBe(false);
    });

    it('truncates output to 12k head + 12k tail when exceeding 30,000 characters', () => {
      const hugeOutput = 'A'.repeat(15000) + 'MIDDLE' + 'B'.repeat(15000);
      const { output, truncated } = truncateOutput(hugeOutput, 30000, 12000, 12000);

      expect(truncated).toBe(true);
      expect(output.startsWith('A'.repeat(12000))).toBe(true);
      expect(output.endsWith('B'.repeat(12000))).toBe(true);
      expect(output).toContain('output truncated:');
    });
  });

  // ==========================================
  // 6. web_fetch tool
  // ==========================================
  describe('web_fetch tool', () => {
    it('refuses non-http(s) protocols', async () => {
      await expect(
        webFetchTool.execute(
          {
            url: 'file:///etc/passwd',
          },
          {
            sessionId,
            workspace,
            readTracker,
          },
        ),
      ).rejects.toThrow(/Only http: and https: protocols are supported/i);
    });

    it('converts HTML content to Markdown properly', async () => {
      // Mock global fetch for testing HTML -> Markdown conversion
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () =>
          new Response('<h1>Title</h1><p>This is a paragraph with <a href="https://example.com">link</a>.</p>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          });

        const res = await webFetchTool.execute(
          {
            url: 'https://example.com/test',
          },
          {
            sessionId,
            workspace,
            readTracker,
          },
        );

        expect(res.status).toBe(200);
        expect(res.content).toContain('# Title');
        expect(res.content).toContain('[link](https://example.com)');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('refuses responses exceeding 1 MB limit', async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = async () =>
          new Response('huge content', {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'Content-Length': String(2 * 1024 * 1024), // 2 MB
            },
          });

        await expect(
          webFetchTool.execute(
            {
              url: 'https://example.com/huge',
            },
            {
              sessionId,
              workspace,
              readTracker,
            },
          ),
        ).rejects.toThrow(/Response body exceeds 1 MB limit/i);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
