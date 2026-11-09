import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { SessionMode } from '../store.js';
import { getTendrilPaths } from '../paths.js';

export const MAX_INSTRUCTION_FILE_BYTES = 32 * 1024; // 32 KB cap

/**
 * Generates the base system prompt containing Termux environment rules.
 */
export function getBasePrompt(): string {
  return `You are Tendril, a fast, capable autonomous AI coding assistant running directly inside Termux on Android.

Termux Environment Guidelines:
- You operate in a standard non-root Android environment. Root access ('sudo' or 'su') is NOT available.
- Install packages using 'pkg install <package>' or 'apt install <package>', never sudo.
- There is no standard '/tmp' directory on Android. Temporary files live in '$TMPDIR' (usually '$PREFIX/tmp').
- System binaries, shebangs, and libraries live under '$PREFIX' (usually '/data/data/com.termux/files/usr').
- Use shebangs such as '#!/data/data/com.termux/files/usr/bin/bash' or '#!/usr/bin/env bash'.
- Device shared storage is mounted under '~/storage' (e.g. '~/storage/shared').
- Never spawn long-running background servers or endless loops in bash commands; all bash calls must terminate cleanly.
- Be concise, direct, and effective. Use tools to inspect, edit, and verify code.`;
}

/**
 * Dynamically builds the environment block for the current turn.
 */
export function buildEnvironmentBlock(workspacePath: string, availableTools: string[]): string {
  const lines: string[] = ['Environment:'];

  lines.push(`- Platform: Linux (Android)`);
  lines.push(`- Arch: ${process.arch}`);
  lines.push(`- Termux Version: ${process.env.TERMUX_VERSION || '0.118.0'}`);
  lines.push(`- Node.js Version: ${process.version}`);
  lines.push(`- $PREFIX: ${process.env.PREFIX || '/data/data/com.termux/files/usr'}`);
  lines.push(`- $HOME: ${process.env.HOME || '/data/data/com.termux/files/home'}`);
  lines.push(`- Workspace: ${workspacePath}`);
  lines.push(`- Date: ${new Date().toISOString()}`);

  // Git status if in a git repository
  try {
    const isGit = existsSync(join(workspacePath, '.git'));
    if (isGit) {
      const branch = execSync('git branch --show-current', {
        cwd: workspacePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();

      const statusOutput = execSync('git status --short', {
        cwd: workspacePath,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });

      const statusLines = statusOutput.trim().split('\n').filter(Boolean);
      const top20 = statusLines.slice(0, 20);

      lines.push(`- Git Branch: ${branch || 'HEAD'}`);
      if (top20.length > 0) {
        lines.push(`- Git Status (first 20 lines):\n  ${top20.join('\n  ')}`);
      } else {
        lines.push(`- Git Status: clean`);
      }
    }
  } catch {
    // Git check is best-effort, omit on failure without throwing
  }

  lines.push(`- Available Tools: ${availableTools.join(', ')}`);

  return lines.join('\n');
}

/**
 * Reads an instruction file (AGENTS.md or CLAUDE.md) up to 32 KB.
 */
export function readInstructionFile(filePath: string, label: string): string | null {
  if (!existsSync(filePath)) return null;

  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return null;

    const buffer = readFileSync(filePath);
    if (buffer.length > MAX_INSTRUCTION_FILE_BYTES) {
      const truncatedText = buffer.subarray(0, MAX_INSTRUCTION_FILE_BYTES).toString('utf8');
      return `### ${label} (truncated to 32 KB):\n${truncatedText}\n\n[Note: ${label} was truncated to 32 KB]`;
    }

    return `### ${label}:\n${buffer.toString('utf8')}`;
  } catch {
    return null;
  }
}

/**
 * Returns instructions specific to the current session mode.
 */
export function getModeBlock(mode: SessionMode): string {
  switch (mode) {
    case 'plan':
      return `Active Mode: PLAN
You are in planning and analysis mode.
- You have access ONLY to read-only tools (read_file, list_dir, glob, grep, todo_write).
- Mutating tools (write_file, edit_file, bash, web_fetch, termux_api) are not offered.
- Formulate clear, step-by-step implementation plans and inspect the codebase.`;

    case 'ask':
      return `Active Mode: ASK (Default)
- Read-only tools are pre-approved.
- All file mutations, shell commands, and network requests require explicit user confirmation before running.
- Explain your intent clearly when calling mutating tools.`;

    case 'auto-edit':
      return `Active Mode: AUTO-EDIT
- Read-only tools and file edits (write_file, edit_file) inside the workspace are automatically approved.
- Shell commands (bash), network requests, and system actions still require user permission.`;

    case 'yolo':
      return `Active Mode: YOLO
- Autonomous mode: file edits, bash commands, and network requests are pre-approved.
- Note: The safety hard guard remains active at all times and blocks catastrophic commands. System actions still require confirmation.`;

    default:
      return `Active Mode: ${mode}`;
  }
}

/**
 * Builds the complete multi-part system prompt in the exact TRD order:
 * Base prompt -> Environment block -> Global AGENTS.md -> Workspace AGENTS.md -> Mode block
 */
export function buildSystemPrompt(options: {
  workspacePath: string;
  mode: SessionMode;
  availableTools: string[];
}): string {
  const sections: string[] = [];

  // 1. Base Prompt
  sections.push(getBasePrompt());

  // 2. Environment Block
  sections.push(buildEnvironmentBlock(options.workspacePath, options.availableTools));

  // 3. Global AGENTS.md (~/.tendril/AGENTS.md)
  try {
    const paths = getTendrilPaths();
    const globalAgentsPath = join(paths.homeDir, 'AGENTS.md');
    const globalContent = readInstructionFile(globalAgentsPath, 'Global AGENTS.md (~/.tendril/AGENTS.md)');
    if (globalContent) {
      sections.push(globalContent);
    }
  } catch {
    // Non-fatal
  }

  // 4. Workspace AGENTS.md (or fallback CLAUDE.md)
  const workspaceAgents = join(options.workspacePath, 'AGENTS.md');
  const workspaceClaude = join(options.workspacePath, 'CLAUDE.md');

  if (existsSync(workspaceAgents)) {
    const content = readInstructionFile(workspaceAgents, 'Project AGENTS.md');
    if (content) sections.push(content);
  } else if (existsSync(workspaceClaude)) {
    const content = readInstructionFile(workspaceClaude, 'Project CLAUDE.md');
    if (content) sections.push(content);
  }

  // 5. Active Mode Block
  sections.push(getModeBlock(options.mode));

  return sections.join('\n\n---\n\n');
}
