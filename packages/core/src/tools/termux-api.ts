import { z } from 'zod';
import { spawnSync } from 'node:child_process';
import { ToolDefinition } from './registry.js';

export const TERMUX_API_ALLOWLIST = [
  'battery-status',
  'camera-info',
  'clipboard-get',
  'clipboard-set',
  'notification',
  'toast',
  'vibrate',
  'open-url',
] as const;

export type TermuxApiCommand = (typeof TERMUX_API_ALLOWLIST)[number];

export function isTermuxApiAvailable(): boolean {
  if (process.env.TENDRIL_MOCK_TERMUX_API === 'true') {
    return true;
  }
  if (process.env.TENDRIL_MOCK_TERMUX_API === 'false') {
    return false;
  }

  try {
    const res = spawnSync('which', ['termux-battery-status'], { stdio: 'ignore' });
    return res.status === 0;
  } catch {
    return false;
  }
}

export const TermuxApiInputSchema = z.object({
  command: z
    .enum([
      'battery-status',
      'camera-info',
      'clipboard-get',
      'clipboard-set',
      'notification',
      'toast',
      'vibrate',
      'open-url',
    ])
    .describe('The Termux:API command to execute'),
  args: z.array(z.string()).optional().describe('Optional argument flags to pass to the binary'),
  text: z.string().optional().describe('Text body for toast, notification, or clipboard-set'),
  title: z.string().optional().describe('Title for notification'),
  url: z.string().optional().describe('URL for open-url'),
});

export type TermuxApiInput = z.infer<typeof TermuxApiInputSchema>;

export const termuxApiTool: ToolDefinition<TermuxApiInput> = {
  name: 'termux_api',
  class: 'system',
  description:
    'Invokes an allow-listed Termux:API command on Android (battery-status, camera-info, clipboard-get, clipboard-set, notification, toast, vibrate, open-url). Requires explicit user permission.',
  schema: TermuxApiInputSchema,
  execute: async (input) => {
    const { command, args = [], text, title, url } = input;

    if (!TERMUX_API_ALLOWLIST.includes(command)) {
      throw new Error(
        `Command '${command}' is not in the Termux:API allow-list. Allowed: ${TERMUX_API_ALLOWLIST.join(', ')}`,
      );
    }

    // Mock response mode for tests or non-android environments
    if (process.env.TENDRIL_MOCK_TERMUX_API === 'true') {
      if (command === 'battery-status') {
        return {
          command,
          result: {
            health: 'GOOD',
            percentage: 88,
            plugged: 'UNPLUGGED',
            status: 'DISCHARGING',
            temperature: 29.5,
          },
        };
      }
      return { command, result: { success: true, text, title, url } };
    }

    const binaryName = `termux-${command}`;
    const cmdArgs: string[] = [...args];
    let stdinInput: string | undefined = undefined;

    if (command === 'toast' && text) {
      cmdArgs.push(text);
    } else if (command === 'clipboard-set') {
      stdinInput = text || '';
    } else if (command === 'notification') {
      if (title) cmdArgs.push('--title', title);
      if (text) cmdArgs.push('--content', text);
    } else if (command === 'open-url' && url) {
      cmdArgs.push(url);
    }

    try {
      const res = spawnSync(binaryName, cmdArgs, {
        input: stdinInput,
        encoding: 'utf8',
        timeout: 10000,
      });

      if (res.error) {
        throw res.error;
      }

      if (res.status !== 0) {
        throw new Error(`Command '${binaryName}' failed with exit code ${res.status}: ${res.stderr || ''}`);
      }

      const stdout = (res.stdout || '').trim();
      let parsed: unknown = stdout;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        // keep string
      }

      return {
        command,
        result: parsed,
      };
    } catch (err: any) {
      throw new Error(`Termux:API '${command}' execution error: ${err?.message || String(err)}`);
    }
  },
};
