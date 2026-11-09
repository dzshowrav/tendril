import { existsSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function resolveDefaultStaticDir(): string | undefined {
  let selfDir = process.cwd();
  try {
    selfDir = dirname(fileURLToPath(import.meta.url));
  } catch {
    // ignore
  }

  let realArgvDir = process.cwd();
  try {
    if (process.argv[1]) {
      realArgvDir = dirname(realpathSync(process.argv[1]));
    }
  } catch {
    // ignore
  }

  const candidates = [
    join(selfDir, 'assets/web'),
    join(selfDir, '../assets/web'),
    join(realArgvDir, 'assets/web'),
    join(realArgvDir, '../assets/web'),
    join(selfDir, '../../packages/cli/assets/web'),
    join(selfDir, '../../packages/web/dist'),
    join(selfDir, '../../../packages/cli/assets/web'),
    join(selfDir, '../../../packages/web/dist'),
    join(process.cwd(), 'dist/assets/web'),
    join(process.cwd(), 'packages/cli/assets/web'),
    join(process.cwd(), 'packages/web/dist'),
    '/data/data/com.termux/files/home/tendrill/dist/assets/web',
    '/data/data/com.termux/files/home/tendrill/packages/cli/assets/web',
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'index.html'))) {
      return c;
    }
  }
  return undefined;
}
