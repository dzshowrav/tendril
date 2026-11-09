import http from 'node:http';
import net from 'node:net';
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { serve } from '@hono/node-server';
import {
  DatabaseStore,
  TendrilPaths,
  getTendrilPaths,
  ensureTendrilLayout,
  atomicWriteJson,
  VERSION as TENDRIL_VERSION,
  recoverInterruptedSessions,
  ProviderAdapter,
  ToolRegistry,
} from '@tendril/core';
import { createServerApp } from './app.js';
import { SSEHub } from './sse-hub.js';
import { PairingManager } from './pairing.js';
import { PermissionEngine } from '@tendril/core';
import { Hono } from 'hono';
import { TendrilEnv } from './types.js';

export interface DaemonState {
  pid: number;
  port: number;
  cliToken: string;
  version: string;
  startedAt: string;
}

export interface DaemonLock {
  pid: number;
  port: number;
  startedAt: string;
}

export interface StartDaemonOptions {
  port?: number;
  customHome?: string;
  cliToken?: string;
  db?: DatabaseStore;
  configPath?: string;
  authPath?: string;
  staticDir?: string;
  providerAdapter?: ProviderAdapter;
  toolRegistry?: ToolRegistry;
  acquireLock?: boolean;
  wakeLock?: boolean;
  setupSignalHandlers?: boolean;
}

export interface DaemonInstance {
  server: ReturnType<typeof serve>;
  app: Hono<TendrilEnv>;
  sseHub: SSEHub;
  pairingManager: PairingManager;
  permissionEngine: PermissionEngine;
  db: DatabaseStore;
  port: number;
  cliToken: string;
  state: DaemonState;
  paths: TendrilPaths;
  stop: () => Promise<void>;
}

/**
 * Checks if a process with the given PID is currently alive.
 */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code !== 'ESRCH';
  }
}

/**
 * Acquires the daemon lock file. If another alive process holds the lock, throws an error.
 * If a stale lock file is found with a dead PID, it is cleared.
 */
export function acquireDaemonLock(paths: TendrilPaths, port: number): void {
  if (existsSync(paths.lockPath)) {
    try {
      const raw = readFileSync(paths.lockPath, 'utf8');
      const data = JSON.parse(raw) as DaemonLock;
      if (data.pid && isPidAlive(data.pid)) {
        throw new Error(`Daemon is already running on PID ${data.pid} (port ${data.port})`);
      }
    } catch (err: any) {
      if (err.message.includes('Daemon is already running')) {
        throw err;
      }
      // Malformed lock or dead process -> proceed to overwrite
    }

    // Clean up stale lock and state
    try {
      unlinkSync(paths.lockPath);
    } catch {
      // ignore
    }
    try {
      if (existsSync(paths.statePath)) {
        unlinkSync(paths.statePath);
      }
    } catch {
      // ignore
    }
  }

  const lockData: DaemonLock = {
    pid: process.pid,
    port,
    startedAt: new Date().toISOString(),
  };

  writeFileSync(paths.lockPath, JSON.stringify(lockData, null, 2), {
    flag: 'w',
    mode: 0o600,
  });
}

/**
 * Releases the daemon lock file if owned by the current process.
 */
export function releaseDaemonLock(paths: TendrilPaths): void {
  if (!existsSync(paths.lockPath)) return;
  try {
    const raw = readFileSync(paths.lockPath, 'utf8');
    const data = JSON.parse(raw) as DaemonLock;
    if (data.pid === process.pid) {
      unlinkSync(paths.lockPath);
    }
  } catch {
    // If malformed or unreadable, remove it
    try {
      unlinkSync(paths.lockPath);
    } catch {
      // ignore
    }
  }
}

/**
 * Checks if a TCP port is currently available on the specified host.
 */
export function isPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

/**
 * Searches for an available port starting from preferredPort, scanning minPort..maxPort.
 */
export async function findAvailablePort(
  preferredPort = 7421,
  minPort = 7421,
  maxPort = 7430,
  host = '127.0.0.1',
): Promise<number> {
  if (await isPortAvailable(preferredPort, host)) {
    return preferredPort;
  }

  for (let p = minPort; p <= maxPort; p++) {
    if (p === preferredPort) continue;
    if (await isPortAvailable(p, host)) {
      return p;
    }
  }

  throw new Error(`No available port found in range ${minPort}-${maxPort}`);
}

/**
 * Acquires Termux wake lock if available.
 */
export function acquireWakeLock(): boolean {
  try {
    const res = spawnSync('termux-wake-lock', [], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Releases Termux wake lock if available.
 */
export function releaseWakeLock(): boolean {
  try {
    const res = spawnSync('termux-wake-unlock', [], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Rotates daemon logs (5 files x 1 MB).
 */
export function rotateLogs(logPath: string, maxFiles = 5, maxSize = 1024 * 1024): void {
  try {
    if (!existsSync(logPath)) return;
    const stats = statSync(logPath);
    if (stats.size < maxSize) return;

    for (let i = maxFiles - 1; i >= 1; i--) {
      const oldFile = `${logPath}.${i}`;
      if (existsSync(oldFile)) {
        if (i === maxFiles - 1) {
          unlinkSync(oldFile);
        } else {
          renameSync(oldFile, `${logPath}.${i + 1}`);
        }
      }
    }

    renameSync(logPath, `${logPath}.1`);
  } catch {
    // Non-fatal logging rotation error
  }
}

/**
 * Writes the daemon state to state.json with 0600 permissions.
 */
export function writeDaemonState(paths: TendrilPaths, state: DaemonState): void {
  atomicWriteJson(paths.statePath, state, 0o600);
}

/**
 * Reads the daemon state from state.json if process is still alive.
 */
export function readDaemonState(paths: TendrilPaths): DaemonState | null {
  if (!existsSync(paths.statePath)) return null;
  try {
    const raw = readFileSync(paths.statePath, 'utf8');
    const state = JSON.parse(raw) as DaemonState;
    if (state.pid && isPidAlive(state.pid)) {
      return state;
    }
    // Stale state
    try {
      unlinkSync(paths.statePath);
    } catch {
      // ignore
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Deletes state.json.
 */
export function deleteDaemonState(paths: TendrilPaths): void {
  if (existsSync(paths.statePath)) {
    try {
      unlinkSync(paths.statePath);
    } catch {
      // ignore
    }
  }
}

/**
 * Starts the Tendril daemon server.
 */
/**
 * Resolves default static web directory if not explicitly provided.
 */
export function resolveDefaultStaticDir(): string | undefined {
  const candidates = [
    join(process.cwd(), 'dist/assets/web'),
    join(process.cwd(), 'packages/cli/assets/web'),
    join(process.cwd(), 'packages/web/dist'),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) {
      return c;
    }
  }
  return undefined;
}

export async function startDaemon(options: StartDaemonOptions = {}): Promise<DaemonInstance> {
  const paths = getTendrilPaths(options.customHome);
  ensureTendrilLayout(paths);

  // 1. Determine Port
  let targetPort: number;
  if (options.port === 0) {
    targetPort = 0; // Ephemeral for tests
  } else if (options.port !== undefined) {
    targetPort = options.port;
  } else {
    targetPort = await findAvailablePort(7421, 7421, 7430);
  }

  // 2. Lock file check
  if (options.acquireLock !== false && targetPort !== 0) {
    acquireDaemonLock(paths, targetPort);
  }

  // 3. Database & interrupted session recovery
  const db = options.db || new DatabaseStore(paths.dbPath);
  try {
    recoverInterruptedSessions(db);
  } catch {
    // ignore
  }

  // 4. Token generation
  const cliToken = options.cliToken || randomBytes(32).toString('hex');

  // 5. Wake lock
  if (options.wakeLock !== false) {
    acquireWakeLock();
  }

  // 6. Rotate logs
  rotateLogs(paths.logPath);

  // 7. Create Server App
  const { app, sseHub, pairingManager, permissionEngine } = createServerApp({
    db,
    cliToken,
    port: targetPort,
    configPath: options.configPath || paths.configPath,
    authPath: options.authPath || paths.authPath,
    staticDir: options.staticDir || resolveDefaultStaticDir(),
    providerAdapter: options.providerAdapter,
    toolRegistry: options.toolRegistry,
  });

  // 8. Listen with @hono/node-server
  const server = await new Promise<ReturnType<typeof serve>>((resolve, reject) => {
    try {
      const s = serve(
        {
          fetch: app.fetch,
          port: targetPort,
          hostname: '127.0.0.1',
        },
        (info) => {
          resolve(s);
        },
      );
      s.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });

  const address = server.address();
  const actualPort =
    typeof address === 'object' && address !== null ? address.port : targetPort;

  const state: DaemonState = {
    pid: process.pid,
    port: actualPort,
    cliToken,
    version: TENDRIL_VERSION,
    startedAt: new Date().toISOString(),
  };

  writeDaemonState(paths, state);

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;

    // Remove signal handlers if registered
    if (sigHandler) {
      process.off('SIGINT', sigHandler);
      process.off('SIGTERM', sigHandler);
    }

    // Stop SSE hub timers
    sseHub.stop();

    // Close HTTP server
    await new Promise<void>((res) => {
      server.close(() => res());
    });

    // Close DB if created internally
    if (!options.db) {
      try {
        db.close();
      } catch {
        // ignore
      }
    }

    // Delete state.json
    deleteDaemonState(paths);

    // Release daemon lock
    if (options.acquireLock !== false && targetPort !== 0) {
      releaseDaemonLock(paths);
    }

    // Release wake lock
    if (options.wakeLock !== false) {
      releaseWakeLock();
    }
  };

  let sigHandler: (() => void) | null = null;
  if (options.setupSignalHandlers !== false) {
    sigHandler = () => {
      stop().finally(() => {
        process.exit(0);
      });
    };
    process.on('SIGINT', sigHandler);
    process.on('SIGTERM', sigHandler);
  }

  return {
    server,
    app,
    sseHub,
    pairingManager,
    permissionEngine,
    db,
    port: actualPort,
    cliToken,
    state,
    paths,
    stop,
  };
}
