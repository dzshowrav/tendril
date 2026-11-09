import * as esbuild from 'esbuild';
import { chmodSync, mkdirSync, cpSync, readdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { execSync } from 'node:child_process';

console.log('Building @tendril/web with Vite...');
execSync('npm run build --workspace=@tendril/web', { stdio: 'inherit' });

const webDist = 'packages/web/dist';
const cliWebAssets = 'packages/cli/assets/web';
const distWebAssets = 'dist/assets/web';

if (!existsSync(webDist)) {
  throw new Error(`Web build output not found at ${webDist}`);
}

// Ensure target directories exist and are clean
rmSync(cliWebAssets, { recursive: true, force: true });
rmSync(distWebAssets, { recursive: true, force: true });
mkdirSync(cliWebAssets, { recursive: true });
mkdirSync(distWebAssets, { recursive: true });

// Copy web build output to packages/cli/assets/web and dist/assets/web
cpSync(webDist, cliWebAssets, { recursive: true });
cpSync(webDist, distWebAssets, { recursive: true });
console.log(`Copied web build assets to ${cliWebAssets} and ${distWebAssets}`);

// Assert initial JS bundle is under 400 KB gzipped
const assetsDir = join(distWebAssets, 'assets');
const assetFiles = readdirSync(assetsDir);
const jsFiles = assetFiles.filter((f) => f.endsWith('.js'));

if (jsFiles.length === 0) {
  throw new Error(`No JS assets found in ${assetsDir}`);
}

for (const jsFile of jsFiles) {
  const filePath = join(assetsDir, jsFile);
  const content = readFileSync(filePath);
  const gzipped = gzipSync(content);
  const sizeKb = (gzipped.byteLength / 1024).toFixed(2);
  console.log(`Web JS asset: ${jsFile} - ${sizeKb} KB gzipped (raw: ${(content.byteLength / 1024).toFixed(2)} KB)`);

  const MAX_GZIP_BYTES = 400 * 1024;
  if (gzipped.byteLength > MAX_GZIP_BYTES) {
    throw new Error(
      `Initial JS asset ${jsFile} (${sizeKb} KB gzipped) exceeds the 400 KB budget limit!`,
    );
  }
}

// Build CLI bundle with esbuild
const outfile = 'dist/tendril.mjs';
mkdirSync(dirname(outfile), { recursive: true });

console.log(`Building CLI bundle ${outfile}...`);
await esbuild.build({
  entryPoints: ['packages/cli/src/index.ts'],
  outfile,
  bundle: true,
  minify: true,
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

// Write dist/package.json for zero-runtime-dependency npm distribution
const distPkg = {
  name: 'tendril',
  version: '0.1.0',
  description: 'The open-source AI coding harness for Termux on Android',
  license: 'MIT',
  author: 'Tendril Contributors',
  repository: {
    type: 'git',
    url: 'https://github.com/dzshowrav/tendril.git',
  },
  type: 'module',
  bin: {
    tendril: './tendril.mjs',
  },
  files: [
    'tendril.mjs',
    'tendril.mjs.map',
    'assets',
    'README.md',
    'LICENSE',
  ],
  engines: {
    node: '>=24.15.0',
  },
  dependencies: {},
};

writeFileSync('dist/package.json', JSON.stringify(distPkg, null, 2) + '\n');
console.log('Wrote dist/package.json');

// Copy README.md and LICENSE into dist/
if (existsSync('README.md')) {
  cpSync('README.md', 'dist/README.md');
}
if (existsSync('LICENSE')) {
  cpSync('LICENSE', 'dist/LICENSE');
}
console.log('Copied README.md and LICENSE to dist/');

