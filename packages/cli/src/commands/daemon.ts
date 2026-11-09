import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, openSync } from 'node:fs';
import { getTendrilPaths, ensureTendrilLayout } from '@tendril/core';
import {
  startDaemon,
  readDaemonState,
  isPidAlive,
} from '@tendril/server';
import { theme } from '../ui/theme.js';
import { TendrilClient } from '../client.js';

export interface ServeOptions {
  detach?: boolean;
  port?: number;
  home?: string;
}

export async function serveCommand(options: ServeOptions = {}): Promise<void> {
  const paths = getTendrilPaths(options.home);
  ensureTendrilLayout(paths);

  // If detached flag is passed
  if (options.detach) {
    const existing = readDaemonState(paths);
    if (existing && isPidAlive(existing.pid)) {
      console.log(theme.success(`Daemon is already running on port ${existing.port} (PID ${existing.pid}).`));
      return;
    }

    // Prepare log file
    const logFd = openSync(paths.logPath, 'a');
    const child = spawn(process.execPath, [process.argv[1], 'serve'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: { ...process.env, TENDRIL_HOME: paths.homeDir },
    });
    child.unref();

    // Wait briefly for state.json to be written
    const timeout = Date.now() + 5000;
    while (Date.now() < timeout) {
      await new Promise((r) => setTimeout(r, 200));
      const state = readDaemonState(paths);
      if (state && isPidAlive(state.pid)) {
        console.log(
          theme.success(
            `Daemon started in background on 127.0.0.1:${state.port} (PID ${state.pid}).`,
          ),
        );
        return;
      }
    }

    console.log(theme.warn('Daemon process spawned, but state.json was not ready yet. Check `tendril logs`.'));
    return;
  }

  // Foreground server
  try {
    const daemon = await startDaemon({
      port: options.port,
      customHome: options.home,
      wakeLock: true,
      setupSignalHandlers: true,
    });

    console.log(
      theme.success(
        `Tendril daemon v${daemon.state.version} listening on 127.0.0.1:${daemon.port} (PID: ${daemon.state.pid})`,
      ),
    );
    console.log(theme.muted('Press Ctrl-C to stop.\n'));
  } catch (err: any) {
    console.error(theme.fail(`Failed to start daemon: ${err.message}`));
    process.exitCode = 1;
  }
}

export async function stopCommand(options: { home?: string } = {}): Promise<void> {
  const paths = getTendrilPaths(options.home);
  const state = readDaemonState(paths);

  if (!state || !isPidAlive(state.pid)) {
    console.log(theme.muted('Tendril daemon is not running.'));
    return;
  }

  console.log(theme.muted(`Stopping daemon (PID ${state.pid})...`));
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (err: any) {
    console.error(theme.fail(`Failed to send kill signal: ${err.message}`));
    return;
  }

  // Poll until PID is dead (up to 5s)
  const timeout = Date.now() + 5000;
  while (Date.now() < timeout) {
    await new Promise((r) => setTimeout(r, 200));
    if (!isPidAlive(state.pid)) {
      console.log(theme.success('Tendril daemon stopped.'));
      return;
    }
  }

  // Force kill if still alive
  try {
    process.kill(state.pid, 'SIGKILL');
    console.log(theme.warn('Daemon did not terminate gracefully; sent SIGKILL.'));
  } catch {
    console.log(theme.success('Tendril daemon stopped.'));
  }
}

export async function statusCommand(options: { home?: string } = {}): Promise<void> {
  const paths = getTendrilPaths(options.home);
  const state = readDaemonState(paths);

  if (!state || !isPidAlive(state.pid)) {
    console.log(`Status:  ${theme.fail('STOPPED')}`);
    return;
  }

  // Check health via API
  const client = new TendrilClient({ customHome: options.home });
  let healthOk = false;
  try {
    const health = await client.getHealth();
    healthOk = Boolean(health.ok || health.status === 'ok');
  } catch {
    healthOk = false;
  }

  console.log(theme.bold('\nTendril Daemon Status:'));
  console.log(`Status:    ${healthOk ? theme.primary('RUNNING (healthy)') : theme.warn('RUNNING (unresponsive)')}`);
  console.log(`PID:       ${state.pid}`);
  console.log(`Port:      ${state.port}`);
  console.log(`Version:   ${state.version}`);
  console.log(`Started:   ${state.startedAt}\n`);
}

export async function logsCommand(options: { follow?: boolean; lines?: number; home?: string } = {}): Promise<void> {
  const paths = getTendrilPaths(options.home);

  if (!existsSync(paths.logPath)) {
    console.log(theme.muted(`No log file found at ${paths.logPath}`));
    return;
  }

  const linesCount = options.lines || 50;

  if (options.follow) {
    // Tail follow using spawn
    const tail = spawn('tail', ['-n', String(linesCount), '-f', paths.logPath], {
      stdio: 'inherit',
    });
    process.on('SIGINT', () => {
      tail.kill();
      process.exit(0);
    });
    return;
  }

  // Print last N lines
  try {
    const content = readFileSync(paths.logPath, 'utf8');
    const lines = content.trim().split('\n');
    const tailLines = lines.slice(-linesCount);
    console.log(tailLines.join('\n'));
  } catch (err: any) {
    console.error(theme.fail(`Failed to read log file: ${err.message}`));
  }
}
