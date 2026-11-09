import { spawnSync } from 'node:child_process';
import { TendrilClient } from '../client.js';
import { theme } from '../ui/theme.js';

export interface PairOptions {
  json?: boolean;
  home?: string;
}

export async function pairCommand(options: PairOptions = {}): Promise<void> {
  const client = new TendrilClient({ customHome: options.home });
  await client.ensureDaemon(true);

  const { code, expiresAt, url } = await client.createPairCode();

  if (options.json) {
    let port = 7421;
    try {
      port = parseInt(new URL(url).port, 10) || 7421;
    } catch {
      // ignore
    }
    console.log(JSON.stringify({ url, code, port, expiresAt }));
    return;
  }

  console.log(theme.bold('\nTendril Pairing:'));
  console.log(`One-time code: ${theme.warning(code)} ${theme.muted('(valid for 5 minutes)')}`);
  console.log(`URL: ${theme.primary(url)}\n`);
  console.log(theme.muted('Open this URL in your browser or paste into the Tendril Android shell.\n'));
}

export async function uiCommand(options: { home?: string } = {}): Promise<void> {
  const client = new TendrilClient({ customHome: options.home });
  await client.ensureDaemon(true);

  const { url, code } = await client.createPairCode();

  // Try termux-open-url first
  try {
    const res = spawnSync('termux-open-url', [url], { stdio: 'ignore' });
    if (res.status === 0) {
      console.log(theme.success(`Opening Web UI in browser: ${url}`));
      return;
    }
  } catch {
    // Termux:API not installed or on standard Linux
  }

  // Fallback: print URL clearly
  console.log(theme.bold('\nTendril Web UI:'));
  console.log(`Open in browser: ${theme.primary(url)}`);
  console.log(`Pairing code: ${theme.warning(code)}\n`);
}
