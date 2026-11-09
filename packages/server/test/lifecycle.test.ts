import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { getTendrilPaths, ensureTendrilLayout, VERSION as TENDRIL_VERSION } from '@tendril/core';
import {
  acquireDaemonLock,
  releaseDaemonLock,
  findAvailablePort,
  isPortAvailable,
  rotateLogs,
  writeDaemonState,
  readDaemonState,
  deleteDaemonState,
  isPidAlive,
} from '../src/daemon.js';

describe('Daemon Lifecycle & Utilities', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tendril-lifecycle-test-'));
    ensureTendrilLayout(getTendrilPaths(tmpHome));
  });

  afterEach(() => {
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('acquires and releases daemon lock', () => {
    const paths = getTendrilPaths(tmpHome);

    // Initial acquire
    acquireDaemonLock(paths, 7421);
    expect(existsSync(paths.lockPath)).toBe(true);

    const raw = readFileSync(paths.lockPath, 'utf8');
    const data = JSON.parse(raw);
    expect(data.pid).toBe(process.pid);
    expect(data.port).toBe(7421);

    // Attempting to acquire again in another process with active PID throws
    expect(() => {
      acquireDaemonLock(paths, 7421);
    }).toThrow(/Daemon is already running/);

    // Release lock
    releaseDaemonLock(paths);
    expect(existsSync(paths.lockPath)).toBe(false);
  });

  it('recovers from stale lock with dead PID', () => {
    const paths = getTendrilPaths(tmpHome);

    // Write a lock with a dead PID (e.g. 99999999)
    const deadPid = 99999999;
    expect(isPidAlive(deadPid)).toBe(false);

    writeFileSync(
      paths.lockPath,
      JSON.stringify({ pid: deadPid, port: 7421, startedAt: new Date().toISOString() }),
    );
    expect(existsSync(paths.lockPath)).toBe(true);

    // Should detect dead PID, clear stale lock, and acquire successfully
    acquireDaemonLock(paths, 7422);
    expect(existsSync(paths.lockPath)).toBe(true);

    const raw = readFileSync(paths.lockPath, 'utf8');
    const data = JSON.parse(raw);
    expect(data.pid).toBe(process.pid);
    expect(data.port).toBe(7422);

    releaseDaemonLock(paths);
  });

  it('scans and finds available port in range', async () => {
    // Occupy a port with a test net.Server
    const busyServer = net.createServer();
    const busyPort = await new Promise<number>((res) => {
      busyServer.listen(0, '127.0.0.1', () => {
        const addr = busyServer.address() as net.AddressInfo;
        res(addr.port);
      });
    });

    expect(await isPortAvailable(busyPort)).toBe(false);

    // Free a port
    const freePort = await findAvailablePort(busyPort, busyPort, busyPort + 5);
    expect(freePort).not.toBe(busyPort);
    expect(freePort).toBeGreaterThan(busyPort);

    await new Promise<void>((res) => busyServer.close(() => res()));
  });

  it('rotates logs when file exceeds 1 MB', () => {
    const paths = getTendrilPaths(tmpHome);
    const logPath = paths.logPath;

    // Create a 1 MB file (1024 * 1024 bytes)
    const buffer = Buffer.alloc(1024 * 1024, 'a');
    writeFileSync(logPath, buffer);

    // Pre-create .1 and .2 files
    writeFileSync(`${logPath}.1`, 'older 1');
    writeFileSync(`${logPath}.2`, 'older 2');

    // Trigger rotation
    rotateLogs(logPath, 5, 1024 * 1024);

    expect(existsSync(logPath)).toBe(false); // original was moved to .1
    expect(existsSync(`${logPath}.1`)).toBe(true);
    expect(existsSync(`${logPath}.2`)).toBe(true);
    expect(existsSync(`${logPath}.3`)).toBe(true);

    expect(readFileSync(`${logPath}.2`, 'utf8')).toBe('older 1');
    expect(readFileSync(`${logPath}.3`, 'utf8')).toBe('older 2');
  });

  it('writes state.json with mode 0600 and cleans up', () => {
    const paths = getTendrilPaths(tmpHome);

    const state = {
      pid: process.pid,
      port: 7421,
      cliToken: 'test-token-1234567890',
      version: '0.1.0',
      startedAt: new Date().toISOString(),
    };

    writeDaemonState(paths, state);
    expect(existsSync(paths.statePath)).toBe(true);

    const stats = statSync(paths.statePath);
    // Mode should be 0600 (0o100600 on POSIX)
    expect(stats.mode & 0o777).toBe(0o600);

    const read = readDaemonState(paths);
    expect(read).toEqual(state);

    deleteDaemonState(paths);
    expect(existsSync(paths.statePath)).toBe(false);
  });
});
