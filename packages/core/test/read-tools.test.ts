import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceGuard } from '../src/workspace.js';
import { ReadTracker } from '../src/read-tracker.js';
import { ToolRegistry } from '../src/tools/registry.js';
import {
  readFileTool,
  listDirTool,
  globTool,
  grepTool,
  todoWriteTool,
  grepWithRg,
  grepWithJs,
  isRipgrepAvailable,
  registerReadTools,
} from '../src/tools/read-tools.js';

describe('read-only tools module', () => {
  let tempDir: string;
  let workspace: WorkspaceGuard;
  let readTracker: ReadTracker;
  let context: any;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tendril-tools-test-'));
    workspace = new WorkspaceGuard(tempDir);
    readTracker = new ReadTracker();
    context = {
      sessionId: 'test_session_123',
      workspace,
      readTracker,
    };
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('read_file', () => {
    it('reads lines and formats with line numbers', async () => {
      const filePath = join(tempDir, 'sample.txt');
      const lines = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'];
      writeFileSync(filePath, lines.join('\n'));

      const result = await readFileTool.execute(
        { path: 'sample.txt', offset: 2, limit: 2 },
        context,
      );

      expect(result).toContain('File: sample.txt');
      expect(result).toContain('2 | line 2');
      expect(result).toContain('3 | line 3');
      expect(result).not.toContain('4 | line 4');

      // Verify read-tracking recorded
      expect(readTracker.hasRead('test_session_123', filePath)).toBe(true);
    });

    it('refuses binary files', async () => {
      const binaryPath = join(tempDir, 'binary.dat');
      const binBuffer = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f, 0x00, 0x77, 0x6f, 0x72, 0x6c, 0x64]);
      writeFileSync(binaryPath, binBuffer);

      await expect(
        readFileTool.execute(readFileTool.schema.parse({ path: 'binary.dat' }), context),
      ).rejects.toThrow(/Cannot read binary file/);
    });

    it('enforces the 2 MB limit', async () => {
      const bigPath = join(tempDir, 'big.txt');
      // Create a file of 2.1 MB
      const bigBuffer = Buffer.alloc(2.1 * 1024 * 1024, 0x61); // 'a'
      writeFileSync(bigPath, bigBuffer);

      await expect(
        readFileTool.execute(readFileTool.schema.parse({ path: 'big.txt' }), context),
      ).rejects.toThrow(/File exceeds 2 MB limit/);
    });
  });

  describe('list_dir', () => {
    it('lists directories first then files', async () => {
      mkdirSync(join(tempDir, 'b_dir'));
      mkdirSync(join(tempDir, 'a_dir'));
      writeFileSync(join(tempDir, 'z_file.txt'), 'content');
      writeFileSync(join(tempDir, 'a_file.txt'), 'content');

      const result = await listDirTool.execute({ path: '.' }, context);
      const lines = result.split('\n');

      expect(lines[0]).toBe('[DIR]  a_dir/');
      expect(lines[1]).toBe('[DIR]  b_dir/');
      expect(lines[2]).toContain('[FILE] a_file.txt');
      expect(lines[3]).toContain('[FILE] z_file.txt');
    });
  });

  describe('glob', () => {
    it('finds files matching glob patterns', async () => {
      mkdirSync(join(tempDir, 'src'));
      writeFileSync(join(tempDir, 'src', 'index.ts'), 'export const a = 1;');
      writeFileSync(join(tempDir, 'src', 'utils.ts'), 'export const b = 2;');
      writeFileSync(join(tempDir, 'src', 'style.css'), 'body {}');

      const result = await globTool.execute(globTool.schema.parse({ pattern: '**/*.ts' }), context);
      expect(result).toContain('src/index.ts');
      expect(result).toContain('src/utils.ts');
      expect(result).not.toContain('src/style.css');
    });
  });

  describe('grep', () => {
    it('returns the same matches with and without rg on a fixture repo', () => {
      mkdirSync(join(tempDir, 'search_dir'));
      writeFileSync(
        join(tempDir, 'search_dir', 'fileA.txt'),
        ['apple', 'banana special_term', 'cherry'].join('\n'),
      );
      writeFileSync(
        join(tempDir, 'search_dir', 'fileB.txt'),
        ['special_term here', 'date', 'elderberry'].join('\n'),
      );

      const jsMatches = grepWithJs('special_term', tempDir, workspace.workspaceReal);

      if (isRipgrepAvailable()) {
        const rgMatches = grepWithRg('special_term', tempDir, workspace.workspaceReal);
        expect(rgMatches).toEqual(jsMatches);
      }

      expect(jsMatches.length).toBe(2);
      expect(jsMatches[0].text).toContain('special_term');
      expect(jsMatches[1].text).toContain('special_term');
    });
  });

  describe('todo_write', () => {
    it('formats checklist correctly', async () => {
      const result = await todoWriteTool.execute(
        {
          todos: [
            { text: 'Task 1', completed: true },
            { text: 'Task 2', completed: false },
          ],
        },
        context,
      );

      expect(result).toContain('[x] Task 1');
      expect(result).toContain('[ ] Task 2');
    });
  });

  describe('ToolRegistry', () => {
    it('registers read tools and produces valid ToolSpecs', () => {
      const registry = new ToolRegistry();
      registerReadTools(registry);

      const tools = registry.list();
      expect(tools.length).toBe(5);

      const specs = registry.getSpecs();
      expect(specs.length).toBe(5);

      const readFileSpec = specs.find((s) => s.name === 'read_file');
      expect(readFileSpec).toBeDefined();
      expect(readFileSpec?.parameters.type).toBe('object');
      expect(readFileSpec?.parameters.properties).toHaveProperty('path');
    });
  });
});
