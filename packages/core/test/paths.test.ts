import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getTendrilHome, getTendrilPaths, ensureTendrilLayout } from '../src/paths.js';

describe('paths module', () => {
  let tempDir: string;
  const originalEnv = process.env.TENDRIL_HOME;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tendril-paths-test-'));
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TENDRIL_HOME = originalEnv;
    } else {
      delete process.env.TENDRIL_HOME;
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('respects custom home parameter', () => {
    const home = getTendrilHome(tempDir);
    expect(home).toBe(tempDir);
  });

  it('respects TENDRIL_HOME environment variable', () => {
    process.env.TENDRIL_HOME = tempDir;
    const home = getTendrilHome();
    expect(home).toBe(tempDir);
  });

  it('generates all expected paths', () => {
    const paths = getTendrilPaths(tempDir);
    expect(paths.homeDir).toBe(tempDir);
    expect(paths.dbPath).toBe(join(tempDir, 'tendril.db'));
    expect(paths.configPath).toBe(join(tempDir, 'config.json'));
    expect(paths.authPath).toBe(join(tempDir, 'auth.json'));
    expect(paths.statePath).toBe(join(tempDir, 'state.json'));
    expect(paths.lockPath).toBe(join(tempDir, 'daemon.lock'));
    expect(paths.logsDir).toBe(join(tempDir, 'logs'));
    expect(paths.logPath).toBe(join(tempDir, 'logs', 'daemon.log'));
  });

  it('ensures directory layout with 0700 permissions', () => {
    const customHome = join(tempDir, 'sub-tendril');
    const paths = getTendrilPaths(customHome);
    ensureTendrilLayout(paths);

    const homeStat = statSync(paths.homeDir);
    const logsStat = statSync(paths.logsDir);

    expect(homeStat.isDirectory()).toBe(true);
    expect(logsStat.isDirectory()).toBe(true);

    if (process.platform !== 'win32') {
      expect((homeStat.mode & 0o777)).toBe(0o700);
      expect((logsStat.mode & 0o777)).toBe(0o700);
    }
  });
});
