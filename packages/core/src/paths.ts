import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, existsSync, chmodSync } from 'node:fs';

export interface TendrilPaths {
  homeDir: string;
  dbPath: string;
  configPath: string;
  authPath: string;
  statePath: string;
  lockPath: string;
  logsDir: string;
  logPath: string;
}

export function getTendrilHome(customHome?: string): string {
  if (customHome) return customHome;
  if (process.env.TENDRIL_HOME) return process.env.TENDRIL_HOME;
  return join(homedir(), '.tendril');
}

export function getTendrilPaths(customHome?: string): TendrilPaths {
  const homeDir = getTendrilHome(customHome);
  const logsDir = join(homeDir, 'logs');
  return {
    homeDir,
    dbPath: join(homeDir, 'tendril.db'),
    configPath: join(homeDir, 'config.json'),
    authPath: join(homeDir, 'auth.json'),
    statePath: join(homeDir, 'state.json'),
    lockPath: join(homeDir, 'daemon.lock'),
    logsDir,
    logPath: join(logsDir, 'daemon.log'),
  };
}

export function ensureTendrilLayout(paths: TendrilPaths = getTendrilPaths()): void {
  if (!existsSync(paths.homeDir)) {
    mkdirSync(paths.homeDir, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(paths.homeDir, 0o700);
  } catch {
    // Ignore permissions errors on systems that don't support chmod
  }

  if (!existsSync(paths.logsDir)) {
    mkdirSync(paths.logsDir, { recursive: true, mode: 0o700 });
  }
  try {
    chmodSync(paths.logsDir, 0o700);
  } catch {
    // Ignore permissions errors
  }
}
