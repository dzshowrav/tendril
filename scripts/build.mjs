import * as esbuild from 'esbuild';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const outfile = 'dist/tendril.mjs';

mkdirSync(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: ['packages/cli/src/index.ts'],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    'node:sqlite',
    'node:*',
  ],
  sourcemap: true,
});

chmodSync(outfile, 0o755);
console.log(`Successfully built ${outfile}`);
