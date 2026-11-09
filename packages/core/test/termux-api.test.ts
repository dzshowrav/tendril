import { describe, it, expect } from 'vitest';
import {
  termuxApiTool,
  TERMUX_API_ALLOWLIST,
  isTermuxApiAvailable,
} from '../src/tools/termux-api.js';
import { normalizeToolPattern, matchesPermissionRule } from '../src/permissions/patterns.js';
import { MODE_MATRIX } from '../src/permissions/matrix.js';

describe('termux_api tool and permissions', () => {
  it('defines the termux_api tool with system class and zod schema', () => {
    expect(termuxApiTool.name).toBe('termux_api');
    expect(termuxApiTool.class).toBe('system');
    expect(termuxApiTool.schema).toBeDefined();
  });

  it('prompts user in ask, auto-edit, and yolo modes and is not offered in plan mode', () => {
    expect(MODE_MATRIX.plan.system).toBe('not_offered');
    expect(MODE_MATRIX.ask.system).toBe('prompt');
    expect(MODE_MATRIX['auto-edit'].system).toBe('prompt');
    expect(MODE_MATRIX.yolo.system).toBe('prompt');
  });

  it('detects Termux:API availability with mock flag', () => {
    const originalEnv = process.env.TENDRIL_MOCK_TERMUX_API;
    try {
      process.env.TENDRIL_MOCK_TERMUX_API = 'true';
      expect(isTermuxApiAvailable()).toBe(true);
      process.env.TENDRIL_MOCK_TERMUX_API = 'false';
      expect(isTermuxApiAvailable()).toBe(false);
    } finally {
      process.env.TENDRIL_MOCK_TERMUX_API = originalEnv;
    }
  });

  const mockContext = {} as any;

  it('rejects commands not on the allow-list', async () => {
    const invalidInput = { command: 'unauthorized-cmd' as any };
    await expect(termuxApiTool.execute(invalidInput, mockContext)).rejects.toThrow(
      /is not in the Termux:API allow-list/,
    );
  });

  it('executes battery-status with mock response returning valid JSON', async () => {
    const originalEnv = process.env.TENDRIL_MOCK_TERMUX_API;
    try {
      process.env.TENDRIL_MOCK_TERMUX_API = 'true';
      const output = await termuxApiTool.execute({ command: 'battery-status' }, mockContext);
      expect(output.command).toBe('battery-status');
      expect(output.result).toEqual({
        health: 'GOOD',
        percentage: 88,
        plugged: 'UNPLUGGED',
        status: 'DISCHARGING',
        temperature: 29.5,
      });
    } finally {
      process.env.TENDRIL_MOCK_TERMUX_API = originalEnv;
    }
  });

  it('executes notification, toast, clipboard-set, open-url in mock mode', async () => {
    const originalEnv = process.env.TENDRIL_MOCK_TERMUX_API;
    try {
      process.env.TENDRIL_MOCK_TERMUX_API = 'true';

      const toastRes = await termuxApiTool.execute({ command: 'toast', text: 'Hello Termux' }, mockContext);
      expect(toastRes.command).toBe('toast');
      expect(toastRes.result).toHaveProperty('success', true);

      const notifRes = await termuxApiTool.execute(
        {
          command: 'notification',
          title: 'Tendril Alert',
          text: 'Step 12 completed',
        },
        mockContext,
      );
      expect(notifRes.command).toBe('notification');

      const urlRes = await termuxApiTool.execute(
        {
          command: 'open-url',
          url: 'https://github.com',
        },
        mockContext,
      );
      expect(urlRes.command).toBe('open-url');
    } finally {
      process.env.TENDRIL_MOCK_TERMUX_API = originalEnv;
    }
  });

  it('correctly extracts sub-command as permission pattern', () => {
    const pattern = normalizeToolPattern('termux_api', { command: 'battery-status' });
    expect(pattern.tool).toBe('termux_api');
    expect(pattern.pattern).toBe('battery-status');
    expect(pattern.canAllowAlways).toBe(true);

    const emptyPattern = normalizeToolPattern('termux_api', {});
    expect(emptyPattern.canAllowAlways).toBe(false);
  });

  it('evaluates rule matching for termux_api sub-commands', () => {
    expect(
      matchesPermissionRule('termux_api', 'battery-status', 'termux_api', {
        command: 'battery-status',
      }),
    ).toBe(true);

    expect(
      matchesPermissionRule('termux_api', 'battery-status', 'termux_api', {
        command: 'vibrate',
      }),
    ).toBe(false);
  });
});
