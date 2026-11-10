import { spawn } from 'node:child_process';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';

export interface ShellEscapeResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Direct Shell Escape (!cmd).
 * Bypasses agent loop and executes shell command directly with real-time stream.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 9).
 */
export async function executeShellEscape(
  rawCommand: string,
  cwd: string = process.cwd(),
  theme: ActiveTheme = resolveActiveTheme(),
): Promise<ShellEscapeResult> {
  const { colors } = theme;
  const cmd = rawCommand.replace(/^!\s*/, '').trim();

  if (!cmd) {
    return { exitCode: 0, stdout: '', stderr: '' };
  }

  process.stdout.write(colors.textMuted(`\n$ ${cmd}\n`));

  return new Promise((resolve) => {
    let stdoutAcc = '';
    let stderrAcc = '';

    const child = spawn('sh', ['-c', cmd], {
      cwd,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (chunk) => {
      const str = chunk.toString();
      stdoutAcc += str;
      process.stdout.write(str);
    });

    child.stderr?.on('data', (chunk) => {
      const str = chunk.toString();
      stderrAcc += str;
      process.stderr.write(colors.textError(str));
    });

    child.on('close', (code) => {
      const exitCode = code ?? 0;
      if (exitCode !== 0) {
        process.stdout.write(colors.textError(`\n[Process exited with code ${exitCode}]\n`));
      }
      resolve({ exitCode, stdout: stdoutAcc, stderr: stderrAcc });
    });

    child.on('error', (err) => {
      process.stderr.write(colors.textError(`\nFailed to start process: ${err.message}\n`));
      resolve({ exitCode: 1, stdout: stdoutAcc, stderr: err.message });
    });
  });
}
