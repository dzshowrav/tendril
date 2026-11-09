import { describe, it, expect, vi } from 'vitest';
import { createCli, runCli } from '../src/index.js';
import { VERSION } from '@tendril/core';

describe('cli module', () => {
  it('registers doctor command and app name', () => {
    const cli = createCli();
    expect(cli.name).toBe('tendril');
    const doctorCmd = cli.commands.find((c) => c.name === 'doctor');
    expect(doctorCmd).toBeDefined();
  });

  it('runs doctor command via runCli', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'tendril', 'doctor']);
    expect(logSpy).toHaveBeenCalled();
    const calls = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(calls).toContain('Doctor');
    logSpy.mockRestore();
  });

  it('outputs help when no arguments are provided', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runCli(['node', 'tendril']);
    logSpy.mockRestore();
  });
});
