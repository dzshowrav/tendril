import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceGuard, WorkspacePathError } from '../src/workspace.js';

describe('workspace guard module', () => {
  let rootDir: string;
  let workspaceDir: string;
  let outsideDir: string;
  let additionalDir: string;

  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'tendril-ws-root-'));
    workspaceDir = join(rootDir, 'workspace');
    outsideDir = join(rootDir, 'outside');
    additionalDir = join(rootDir, 'additional');

    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    mkdirSync(additionalDir, { recursive: true });

    writeFileSync(join(workspaceDir, 'file.txt'), 'hello inside');
    writeFileSync(join(outsideDir, 'secret.txt'), 'hello outside');
    writeFileSync(join(additionalDir, 'shared.txt'), 'hello shared');
  });

  afterEach(() => {
    try {
      rmSync(rootDir, { recursive: true, force: true });
    } catch {}
  });

  it('resolves valid relative and absolute paths inside workspace', () => {
    const guard = new WorkspaceGuard(workspaceDir);

    const rel = guard.resolvePath('file.txt');
    expect(rel).toBe(join(workspaceDir, 'file.txt'));

    const abs = guard.resolvePath(join(workspaceDir, 'file.txt'));
    expect(abs).toBe(join(workspaceDir, 'file.txt'));

    expect(guard.toRelative(rel)).toBe('file.txt');
  });

  it('rejects path traversal attempting to escape workspace (../)', () => {
    const guard = new WorkspaceGuard(workspaceDir);

    expect(() => {
      guard.resolvePath('../outside/secret.txt');
    }).toThrow(WorkspacePathError);

    expect(() => {
      guard.resolvePath('../../etc/passwd');
    }).toThrow(WorkspacePathError);
  });

  it('rejects absolute paths outside workspace', () => {
    const guard = new WorkspaceGuard(workspaceDir);

    expect(() => {
      guard.resolvePath(join(outsideDir, 'secret.txt'));
    }).toThrow(WorkspacePathError);

    expect(() => {
      guard.resolvePath('/etc/passwd');
    }).toThrow(WorkspacePathError);
  });

  it('rejects symlinks pointing outside workspace', () => {
    const symlinkPath = join(workspaceDir, 'link_to_outside');
    try {
      symlinkSync(join(outsideDir, 'secret.txt'), symlinkPath);
    } catch {
      // If symlink creation fails on unsupported environment, skip
      return;
    }

    const guard = new WorkspaceGuard(workspaceDir);

    expect(() => {
      guard.resolvePath('link_to_outside');
    }).toThrow(WorkspacePathError);
  });

  it('allows paths within configured additionalDirs', () => {
    const guard = new WorkspaceGuard(workspaceDir, [additionalDir]);

    const resolved = guard.resolvePath(join(additionalDir, 'shared.txt'));
    expect(resolved).toBe(join(additionalDir, 'shared.txt'));
  });
});
