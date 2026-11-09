import { z } from 'zod';
import { readFileSync, statSync, existsSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, relative, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { globSync } from 'tinyglobby';
import { ToolDefinition } from './registry.js';

// ==========================================
// 1. read_file
// ==========================================

export const ReadFileInputSchema = z.object({
  path: z.string().describe('Path to the file to read (relative to workspace or absolute)'),
  offset: z.number().int().min(1).optional().default(1).describe('Line offset to start reading from (1-based, default: 1)'),
  limit: z.number().int().min(1).max(5000).optional().default(2000).describe('Maximum number of lines to read (default: 2000)'),
});

export type ReadFileInput = z.input<typeof ReadFileInputSchema>;

export interface ReadFileOutput {
  path: string;
  totalLines: number;
  offset: number;
  limit: number;
  content: string;
  sha256: string;
}

export function isBinaryFile(filePath: string): boolean {
  const fd = openSync(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8192);
    const bytesRead = readSync(fd, buffer, 0, 8192, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0x00) {
        return true;
      }
    }
    return false;
  } finally {
    closeSync(fd);
  }
}

export const readFileTool: ToolDefinition<ReadFileInput, string> = {
  name: 'read_file',
  class: 'read',
  description: 'Read contents of a text file within workspace with line numbering and 2MB limit',
  schema: ReadFileInputSchema,
  execute: async (rawInput, context) => {
    const input = ReadFileInputSchema.parse(rawInput);
    const canonical = context.workspace.resolvePath(input.path);

    if (!existsSync(canonical)) {
      throw new Error(`File not found: ${input.path}`);
    }

    const stat = statSync(canonical);
    if (stat.isDirectory()) {
      throw new Error(`Cannot read directory as file: ${input.path}`);
    }

    // 2 MB file limit
    const MAX_FILE_SIZE = 2 * 1024 * 1024;
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(`File exceeds 2 MB limit (size: ${stat.size} bytes): ${input.path}`);
    }

    // Binary file refusal
    if (isBinaryFile(canonical)) {
      throw new Error(`Cannot read binary file: ${input.path}`);
    }

    const buffer = readFileSync(canonical);
    const sha256 = createHash('sha256').update(buffer).digest('hex');

    // Mark as read in readTracker
    context.readTracker.recordRead(context.sessionId, canonical, sha256, stat.mtimeMs);

    const text = buffer.toString('utf-8');
    const allLines = text.split(/\r?\n/);
    const totalLines = allLines.length;

    const startIndex = input.offset - 1;
    const selectedLines = allLines.slice(startIndex, startIndex + input.limit);

    const numbered = selectedLines
      .map((line, idx) => {
        const lineNum = startIndex + idx + 1;
        return `${String(lineNum).padStart(5, ' ')} | ${line}`;
      })
      .join('\n');

    const relPath = context.workspace.toRelative(canonical);
    const header = `[File: ${relPath} | Lines ${input.offset}-${Math.min(startIndex + input.limit, totalLines)} of ${totalLines}]\n`;

    return header + numbered;
  },
};

// ==========================================
// 2. list_dir
// ==========================================

export const ListDirInputSchema = z.object({
  path: z.string().optional().default('.').describe('Directory path relative to workspace (default: .)'),
});

export type ListDirInput = z.input<typeof ListDirInputSchema>;

export const listDirTool: ToolDefinition<ListDirInput, string> = {
  name: 'list_dir',
  class: 'read',
  description: 'List contents of a directory (non-recursive, dirs first, max 500 entries)',
  schema: ListDirInputSchema,
  execute: async (rawInput, context) => {
    const input = ListDirInputSchema.parse(rawInput);
    const canonical = context.workspace.resolvePath(input.path);

    if (!existsSync(canonical)) {
      throw new Error(`Directory not found: ${input.path}`);
    }

    const stat = statSync(canonical);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${input.path}`);
    }

    const entries = readdirSync(canonical, { withFileTypes: true });

    const dirs: string[] = [];
    const files: string[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        dirs.push(entry.name);
      } else {
        files.push(entry.name);
      }
    }

    dirs.sort((a, b) => a.localeCompare(b));
    files.sort((a, b) => a.localeCompare(b));

    const total = dirs.length + files.length;
    const MAX_ENTRIES = 500;

    const formatted: string[] = [];
    for (const d of dirs) {
      if (formatted.length >= MAX_ENTRIES) break;
      formatted.push(`[DIR]  ${d}/`);
    }
    for (const f of files) {
      if (formatted.length >= MAX_ENTRIES) break;
      try {
        const s = statSync(join(canonical, f));
        const sizeFormatted = formatFileSize(s.size);
        formatted.push(`[FILE] ${f} (${sizeFormatted})`);
      } catch {
        formatted.push(`[FILE] ${f}`);
      }
    }

    let result = formatted.join('\n');
    if (total > MAX_ENTRIES) {
      result += `\n[Showing 500 of ${total} entries]`;
    }

    return result || '(empty directory)';
  },
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ==========================================
// 3. glob
// ==========================================

export const GlobInputSchema = z.object({
  pattern: z.string().describe('Glob pattern, e.g. **/*.ts, src/**/*.json'),
  path: z.string().optional().default('.').describe('Base directory to search in (default: .)'),
});

export type GlobInput = z.input<typeof GlobInputSchema>;

export const globTool: ToolDefinition<GlobInput, string> = {
  name: 'glob',
  class: 'read',
  description: 'Search files matching a glob pattern (respects gitignore, max 500 results)',
  schema: GlobInputSchema,
  execute: async (rawInput, context) => {
    const input = GlobInputSchema.parse(rawInput);
    const canonical = context.workspace.resolvePath(input.path);

    if (!existsSync(canonical) || !statSync(canonical).isDirectory()) {
      throw new Error(`Base directory not found: ${input.path}`);
    }

    const matches = globSync(input.pattern, {
      cwd: canonical,
      dot: true,
      ignore: ['**/.git/**', '**/node_modules/**'],
    });

    matches.sort((a, b) => a.localeCompare(b));

    const total = matches.length;
    const MAX_RESULTS = 500;
    const sliced = matches.slice(0, MAX_RESULTS);

    let output = sliced.join('\n');
    if (total > MAX_RESULTS) {
      output += `\n[Showing 500 of ${total} matches]`;
    }

    return output || '(no matches found)';
  },
};

// ==========================================
// 4. grep
// ==========================================

export const GrepInputSchema = z.object({
  pattern: z.string().describe('Regex or literal pattern to search'),
  path: z.string().optional().default('.').describe('Path to file or directory to search in (default: .)'),
  glob: z.string().optional().describe('Filter files by glob pattern'),
  context: z.number().int().min(0).max(5).optional().default(0).describe('Lines of context before and after (default: 0)'),
  ignoreCase: z.boolean().optional().default(false).describe('Case-insensitive search (default: false)'),
});

export type GrepInput = z.input<typeof GrepInputSchema>;

export interface GrepMatchItem {
  file: string; // relative to workspace
  line: number; // 1-based
  text: string;
  contextBefore?: string[];
  contextAfter?: string[];
}

export function isRipgrepAvailable(): boolean {
  try {
    execFileSync('rg', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export function grepWithRg(
  pattern: string,
  searchPath: string,
  workspaceReal: string,
  options: { glob?: string; context?: number; ignoreCase?: boolean } = {},
): GrepMatchItem[] {
  const args = ['--json'];

  if (options.ignoreCase) {
    args.push('-i');
  }
  if (options.context && options.context > 0) {
    args.push('-C', String(options.context));
  }
  if (options.glob) {
    args.push('-g', options.glob);
  }

  args.push('-e', pattern, searchPath);

  let output = '';
  try {
    output = execFileSync('rg', args, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });
  } catch (err: any) {
    // rg exits with 1 if no matches found
    if (err.status === 1) {
      return [];
    }
    throw err;
  }

  const results: GrepMatchItem[] = [];
  const lines = output.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'match') {
        const filePath = obj.data.path.text;
        const lineNum = obj.data.line_number;
        const text = (obj.data.lines.text || '').replace(/\r?\n$/, '');
        const relPath = relative(workspaceReal, resolve(filePath));

        results.push({
          file: relPath,
          line: lineNum,
          text,
        });
      }
    } catch {}
  }

  results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return results.slice(0, 200);
}

export function grepWithJs(
  pattern: string,
  searchPath: string,
  workspaceReal: string,
  options: { glob?: string; context?: number; ignoreCase?: boolean } = {},
): GrepMatchItem[] {
  const regex = new RegExp(pattern, options.ignoreCase ? 'i' : '');
  const results: GrepMatchItem[] = [];

  function walk(current: string) {
    if (results.length >= 200) return;

    if (!existsSync(current)) return;
    const stat = statSync(current);

    if (stat.isDirectory()) {
      const base = current.split(/[\\/]/).pop();
      if (base === '.git' || base === 'node_modules') return;

      const entries = readdirSync(current);
      entries.sort((a, b) => a.localeCompare(b));
      for (const entry of entries) {
        walk(join(current, entry));
        if (results.length >= 200) return;
      }
    } else if (stat.isFile()) {
      if (stat.size > 2 * 1024 * 1024) return; // skip large files
      if (isBinaryFile(current)) return;

      const relPath = relative(workspaceReal, current);
      if (options.glob) {
        // Simple glob check if needed or match
        const globRegex = new RegExp(
          '^' +
            options.glob
              .replace(/\./g, '\\.')
              .replace(/\*\*/g, '.*')
              .replace(/(?<!\.)\*/g, '[^/]*') +
            '$',
        );
        if (!globRegex.test(relPath) && !globRegex.test(current.split(/[\\/]/).pop() || '')) {
          return;
        }
      }

      try {
        const content = readFileSync(current, 'utf-8');
        const lines = content.split(/\r?\n/);

        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            const contextBefore: string[] = [];
            const contextAfter: string[] = [];

            if (options.context && options.context > 0) {
              const start = Math.max(0, i - options.context);
              for (let c = start; c < i; c++) {
                contextBefore.push(lines[c]);
              }
              const end = Math.min(lines.length - 1, i + options.context);
              for (let c = i + 1; c <= end; c++) {
                contextAfter.push(lines[c]);
              }
            }

            results.push({
              file: relPath,
              line: i + 1,
              text: lines[i],
              contextBefore: contextBefore.length > 0 ? contextBefore : undefined,
              contextAfter: contextAfter.length > 0 ? contextAfter : undefined,
            });

            if (results.length >= 200) return;
          }
        }
      } catch {}
    }
  }

  walk(searchPath);
  results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return results.slice(0, 200);
}

export const grepTool: ToolDefinition<GrepInput, string> = {
  name: 'grep',
  class: 'read',
  description: 'Search pattern across files (uses rg when available with JS fallback, max 200 matches)',
  schema: GrepInputSchema,
  execute: async (rawInput, context) => {
    const input = GrepInputSchema.parse(rawInput);
    const canonical = context.workspace.resolvePath(input.path);

    let matches: GrepMatchItem[] = [];
    if (isRipgrepAvailable()) {
      try {
        matches = grepWithRg(input.pattern, canonical, context.workspace.workspaceReal, {
          glob: input.glob,
          context: input.context,
          ignoreCase: input.ignoreCase,
        });
      } catch {
        // Fallback to JS if rg throws
        matches = grepWithJs(input.pattern, canonical, context.workspace.workspaceReal, {
          glob: input.glob,
          context: input.context,
          ignoreCase: input.ignoreCase,
        });
      }
    } else {
      matches = grepWithJs(input.pattern, canonical, context.workspace.workspaceReal, {
        glob: input.glob,
        context: input.context,
        ignoreCase: input.ignoreCase,
      });
    }

    if (matches.length === 0) {
      return '(no matches found)';
    }

    const lines = matches.map((m) => `${m.file}:${m.line}: ${m.text}`);
    let output = lines.join('\n');
    if (matches.length >= 200) {
      output += '\n[Showing maximum 200 matches]';
    }

    return output;
  },
};

// ==========================================
// 5. todo_write
// ==========================================

export const TodoItemSchema = z.object({
  id: z.string().optional(),
  text: z.string().describe('Task description'),
  completed: z.boolean().describe('Whether the task is completed'),
});

export const TodoWriteInputSchema = z.object({
  todos: z.array(TodoItemSchema).describe('Updated list of todos for the session'),
});

export type TodoWriteInput = z.infer<typeof TodoWriteInputSchema>;

export const todoWriteTool: ToolDefinition<TodoWriteInput, string> = {
  name: 'todo_write',
  class: 'read',
  description: 'Update the session task checklist',
  schema: TodoWriteInputSchema,
  execute: async (input) => {
    if (input.todos.length === 0) {
      return 'Checklist cleared (0 items).';
    }

    const formatted = input.todos
      .map((t) => `${t.completed ? '[x]' : '[ ]'} ${t.text}`)
      .join('\n');

    return `Updated checklist (${input.todos.length} items):\n${formatted}`;
  },
};

/**
 * Registers all standard read-only tools into a registry.
 */
export function registerReadTools(registry: { register: (tool: ToolDefinition) => void }): void {
  registry.register(readFileTool);
  registry.register(listDirTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(todoWriteTool);
}
