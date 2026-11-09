import { z } from 'zod';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { NodeHtmlMarkdown } from 'node-html-markdown';
import { ToolDefinition } from './registry.js';
import { isCatastrophic } from './guard.js';
import { createSnapshotRecord } from './snapshots.js';

// ==========================================
// 1. write_file
// ==========================================

export const WriteFileInputSchema = z.object({
  path: z.string().describe('Path to the file to create or overwrite (relative to workspace or absolute)'),
  content: z.string().describe('Full text content to write to the file'),
});

export type WriteFileInput = z.input<typeof WriteFileInputSchema>;

export interface WriteFileOutput {
  path: string;
  bytesWritten: number;
  snapshotId?: string;
  diff?: string;
}

export const writeFileTool: ToolDefinition<WriteFileInput, WriteFileOutput> = {
  name: 'write_file',
  class: 'edit',
  description: 'Create a new file or overwrite an existing file. Existing files require a prior read with matching hash.',
  schema: WriteFileInputSchema,
  execute: async (rawInput, context) => {
    const input = WriteFileInputSchema.parse(rawInput);
    const canonical = context.workspace.resolvePath(input.path);
    const relPath = context.workspace.toRelative(canonical);

    let oldContent: Buffer | null = null;
    let oldSha: string | null = null;

    if (existsSync(canonical)) {
      const stat = statSync(canonical);
      if (stat.isDirectory()) {
        throw new Error(`Cannot write to directory as file: ${input.path}`);
      }

      oldContent = readFileSync(canonical);
      oldSha = createHash('sha256').update(oldContent).digest('hex');

      // Enforce read-before-edit for existing files
      const lastRead = context.readTracker.getRead(context.sessionId, canonical);
      if (!lastRead) {
        throw new Error(`File '${input.path}' must be read before editing. Use read_file first.`);
      }

      if (lastRead.sha256 !== oldSha) {
        throw new Error(
          `File '${input.path}' has changed on disk since it was last read. Read the file again before modifying.`,
        );
      }
    }

    // Ensure parent directory exists
    const dir = dirname(canonical);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    let snapshotId: string | undefined;
    let diff: string | undefined;

    // Create snapshot if database store and toolRunId are available
    if (context.db && context.toolRunId) {
      const snapshot = createSnapshotRecord({
        sessionId: context.sessionId,
        toolRunId: context.toolRunId,
        relPath,
        absPath: canonical,
        oldContent,
        newContentText: input.content,
        db: context.db,
      });
      snapshotId = snapshot.id;
      diff = snapshot.diff_unified;
    }

    // Write file to disk
    writeFileSync(canonical, input.content, 'utf8');

    // Update read tracker with the new content
    const newBuf = Buffer.from(input.content, 'utf8');
    const newSha = createHash('sha256').update(newBuf).digest('hex');
    const newStat = statSync(canonical);
    context.readTracker.recordRead(context.sessionId, canonical, newSha, newStat.mtimeMs);

    return {
      path: relPath,
      bytesWritten: newBuf.length,
      snapshotId,
      diff,
    };
  },
};

// ==========================================
// 2. edit_file
// ==========================================

export const EditFileInputSchema = z.object({
  path: z.string().describe('Path to the file to edit (relative to workspace or absolute)'),
  old_string: z.string().describe('Exact text to be replaced'),
  new_string: z.string().describe('Replacement text'),
  replace_all: z
    .boolean()
    .optional()
    .default(false)
    .describe('Replace all occurrences instead of requiring uniqueness (default: false)'),
});

export type EditFileInput = z.input<typeof EditFileInputSchema>;

export interface EditFileOutput {
  path: string;
  replacements: number;
  snapshotId?: string;
  diff?: string;
}

export const editFileTool: ToolDefinition<EditFileInput, EditFileOutput> = {
  name: 'edit_file',
  class: 'edit',
  description: 'Edit a file by exact text replacement. Requires prior read with matching hash and unique target match unless replace_all is true.',
  schema: EditFileInputSchema,
  execute: async (rawInput, context) => {
    const input = EditFileInputSchema.parse(rawInput);
    const canonical = context.workspace.resolvePath(input.path);
    const relPath = context.workspace.toRelative(canonical);

    if (!existsSync(canonical)) {
      throw new Error(`File not found: ${input.path}`);
    }

    const stat = statSync(canonical);
    if (stat.isDirectory()) {
      throw new Error(`Cannot edit directory as file: ${input.path}`);
    }

    if (!input.old_string) {
      throw new Error('old_string cannot be empty');
    }

    const oldContent = readFileSync(canonical);
    const oldSha = createHash('sha256').update(oldContent).digest('hex');

    // Enforce read-before-edit
    const lastRead = context.readTracker.getRead(context.sessionId, canonical);
    if (!lastRead) {
      throw new Error(`File '${input.path}' must be read before editing. Use read_file first.`);
    }

    if (lastRead.sha256 !== oldSha) {
      throw new Error(
        `File '${input.path}' has changed on disk since it was last read. Read the file again before modifying.`,
      );
    }

    const currentText = oldContent.toString('utf8');

    // Count occurrences of old_string
    let occurrences = 0;
    let pos = 0;
    while ((pos = currentText.indexOf(input.old_string, pos)) !== -1) {
      occurrences++;
      pos += input.old_string.length;
    }

    if (occurrences === 0) {
      throw new Error(
        `Target string not found in '${input.path}'. Ensure exact matching including whitespace and indentation.`,
      );
    }

    if (occurrences > 1 && !input.replace_all) {
      throw new Error(
        `Target string found ${occurrences} times in '${input.path}'. Provide more surrounding context lines to make it unique, or set replace_all: true.`,
      );
    }

    // Perform replacement
    const newText = input.replace_all
      ? currentText.replaceAll(input.old_string, input.new_string)
      : currentText.replace(input.old_string, input.new_string);

    let snapshotId: string | undefined;
    let diff: string | undefined;

    // Create snapshot
    if (context.db && context.toolRunId) {
      const snapshot = createSnapshotRecord({
        sessionId: context.sessionId,
        toolRunId: context.toolRunId,
        relPath,
        absPath: canonical,
        oldContent,
        newContentText: newText,
        db: context.db,
      });
      snapshotId = snapshot.id;
      diff = snapshot.diff_unified;
    }

    // Write file to disk
    writeFileSync(canonical, newText, 'utf8');

    // Update read tracker
    const newBuf = Buffer.from(newText, 'utf8');
    const newSha = createHash('sha256').update(newBuf).digest('hex');
    const newStat = statSync(canonical);
    context.readTracker.recordRead(context.sessionId, canonical, newSha, newStat.mtimeMs);

    return {
      path: relPath,
      replacements: occurrences,
      snapshotId,
      diff,
    };
  },
};

// ==========================================
// 3. bash
// ==========================================

export const BashInputSchema = z.object({
  command: z.string().describe('Shell command to execute in workspace root'),
  timeout: z
    .number()
    .int()
    .min(1)
    .max(600)
    .optional()
    .default(120)
    .describe('Timeout in seconds (default 120, max 600)'),
  description: z.string().optional().describe('Short explanation of what this command does'),
});

export type BashInput = z.input<typeof BashInputSchema>;

export interface BashOutput {
  command: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  output: string;
  duration_ms: number;
  truncated: boolean;
  timed_out?: boolean;
}

/**
 * Scrubs secret tokens, API keys, passwords, and TENDRIL_* variables from environment.
 */
export function scrubEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    const upper = key.toUpperCase();

    // Remove any TENDRIL_ prefixed variable
    if (upper.startsWith('TENDRIL_')) continue;

    // Remove API keys, secrets, tokens, passwords, credentials
    if (
      upper.includes('KEY') ||
      upper.includes('SECRET') ||
      upper.includes('TOKEN') ||
      upper.includes('AUTH') ||
      upper.includes('PASSWORD') ||
      upper.includes('CREDENTIAL')
    ) {
      continue;
    }

    clean[key] = value;
  }

  clean.TERM = 'dumb';
  clean.NO_COLOR = '1';
  return clean;
}

/**
 * Truncates output to 30,000 chars (12,000 head + 12,000 tail) if it exceeds the limit.
 */
export function truncateOutput(
  output: string,
  maxChars = 30000,
  headChars = 12000,
  tailChars = 12000,
): { output: string; truncated: boolean } {
  if (output.length <= maxChars) {
    return { output, truncated: false };
  }

  const head = output.slice(0, headChars);
  const tail = output.slice(output.length - tailChars);
  const omitted = output.length - headChars - tailChars;
  const message = `\n\n... [output truncated: ${omitted} characters omitted] ...\n\n`;

  return {
    output: `${head}${message}${tail}`,
    truncated: true,
  };
}

/**
 * Kills a process group using SIGTERM, escalating to SIGKILL after 3 seconds if still alive.
 */
function killProcessGroup(pid: number, signal: NodeJS.Signals = 'SIGTERM'): void {
  try {
    process.kill(-pid, signal);
  } catch (err: any) {
    if (err.code !== 'ESRCH') {
      try {
        process.kill(pid, signal);
      } catch {
        // Process already gone
      }
    }
  }
}

export const bashTool: ToolDefinition<BashInput, BashOutput> = {
  name: 'bash',
  class: 'exec',
  description: 'Execute shell commands in the workspace root with timeout, safety guard, and scrubbed environment.',
  schema: BashInputSchema,
  execute: async (rawInput, context) => {
    const input = BashInputSchema.parse(rawInput);
    // 1. Catastrophic command check
    if (isCatastrophic(input.command)) {
      throw new Error(`Command blocked by safety guard: matches catastrophic pattern (${input.command})`);
    }

    const timeoutSec = Math.min(Math.max(1, input.timeout ?? 120), 600);
    const timeoutMs = timeoutSec * 1000;
    const startTime = Date.now();

    return new Promise<BashOutput>((resolve, reject) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn('bash', ['-c', input.command], {
          cwd: context.workspace.workspaceRoot,
          env: scrubEnvironment(process.env),
          detached: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
      } catch (err) {
        return reject(err);
      }

      let stdoutChunks: Buffer[] = [];
      let stderrChunks: Buffer[] = [];
      let timedOut = false;
      let aborted = false;
      let killTimer: NodeJS.Timeout | null = null;
      let timeoutTimer: NodeJS.Timeout | null = null;

      const cleanupTimers = () => {
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        if (killTimer) {
          clearTimeout(killTimer);
          killTimer = null;
        }
      };

      const terminateChild = () => {
        if (!child.pid) return;
        killProcessGroup(child.pid, 'SIGTERM');
        killTimer = setTimeout(() => {
          if (child.pid) {
            killProcessGroup(child.pid, 'SIGKILL');
          }
        }, 3000);
      };

      // Set execution timeout
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        terminateChild();
      }, timeoutMs);

      // Handle AbortSignal
      if (context.signal) {
        if (context.signal.aborted) {
          aborted = true;
          terminateChild();
        } else {
          context.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              terminateChild();
            },
            { once: true },
          );
        }
      }

      if (child.stdout) {
        child.stdout.on('data', (chunk: Buffer) => {
          stdoutChunks.push(chunk);
          if (context.onOutput) {
            context.onOutput(chunk.toString('utf8'));
          }
        });
      }

      if (child.stderr) {
        child.stderr.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk);
          if (context.onOutput) {
            context.onOutput(chunk.toString('utf8'));
          }
        });
      }

      child.on('error', (err) => {
        cleanupTimers();
        reject(err);
      });

      child.on('close', (code, signal) => {
        cleanupTimers();
        const duration_ms = Date.now() - startTime;

        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        const rawOutput = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');

        const { output, truncated } = truncateOutput(rawOutput);

        const exit_code = timedOut ? 124 : code !== null ? code : signal ? 128 + 15 : 1;

        if (aborted) {
          return reject(new Error('Command aborted by signal'));
        }

        resolve({
          command: input.command,
          exit_code,
          stdout,
          stderr,
          output,
          duration_ms,
          truncated,
          timed_out: timedOut,
        });
      });
    });
  },
};

// ==========================================
// 4. web_fetch
// ==========================================

export const WebFetchInputSchema = z.object({
  url: z.string().url().describe('HTTP or HTTPS URL to fetch'),
  maxChars: z
    .number()
    .int()
    .min(100)
    .max(200000)
    .optional()
    .default(50000)
    .describe('Maximum characters of markdown to return (default: 50000)'),
});

export type WebFetchInput = z.input<typeof WebFetchInputSchema>;

export interface WebFetchOutput {
  url: string;
  status: number;
  contentType: string;
  content: string;
  truncated: boolean;
}

export const webFetchTool: ToolDefinition<WebFetchInput, WebFetchOutput> = {
  name: 'web_fetch',
  class: 'net',
  description: 'Fetch web content over HTTP/HTTPS and convert HTML into Markdown (20s timeout, 1MB limit).',
  schema: WebFetchInputSchema,
  execute: async (rawInput, context) => {
    const input = WebFetchInputSchema.parse(rawInput);
    const parsed = new URL(input.url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Only http: and https: protocols are supported (received: ${parsed.protocol})`);
    }

    const timeoutSignal = AbortSignal.timeout(20000);
    const combinedSignal = context.signal ? AbortSignal.any([timeoutSignal, context.signal]) : timeoutSignal;

    const res = await fetch(input.url, {
      signal: combinedSignal,
      headers: {
        'User-Agent': 'Tendril/0.1.0 (Android; Termux)',
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json,*/*',
      },
    });

    const contentType = res.headers.get('content-type') || 'text/plain';
    const MAX_BYTES = 1024 * 1024; // 1 MB limit

    const clHeader = res.headers.get('content-length');
    if (clHeader) {
      const length = parseInt(clHeader, 10);
      if (!isNaN(length) && length > MAX_BYTES) {
        throw new Error(`Response body exceeds 1 MB limit (${length} bytes)`);
      }
    }

    if (!res.body) {
      return {
        url: input.url,
        status: res.status,
        contentType,
        content: '',
        truncated: false,
      };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          totalBytes += value.length;
          if (totalBytes > MAX_BYTES) {
            await reader.cancel();
            throw new Error(`Response body exceeds 1 MB limit`);
          }
          chunks.push(value);
        }
      }
    } catch (err) {
      throw err;
    }

    const bodyBuffer = Buffer.concat(chunks);
    const bodyText = bodyBuffer.toString('utf8');

    let markdown: string;
    if (contentType.includes('html')) {
      markdown = NodeHtmlMarkdown.translate(bodyText);
    } else if (contentType.includes('json')) {
      try {
        const parsedJson = JSON.parse(bodyText);
        markdown = '```json\n' + JSON.stringify(parsedJson, null, 2) + '\n```';
      } catch {
        markdown = bodyText;
      }
    } else {
      markdown = bodyText;
    }

    const maxChars = input.maxChars ?? 50000;
    const truncated = markdown.length > maxChars;
    const content = truncated ? markdown.slice(0, maxChars) : markdown;

    return {
      url: input.url,
      status: res.status,
      contentType,
      content,
      truncated,
    };
  },
};
