#!/usr/bin/env node

/**
 * Tendril Performance & Resource Budget Checker
 *
 * Verifies TRD constraints:
 * 1. Web UI initial JS: under 400 KB gzipped
 * 2. Daemon idle memory: under 150 MB RSS
 * 3. CLI start to version/help: under budget threshold
 */

import { readdirSync, readFileSync, existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

console.log('=== Tendril TRD Performance & Resource Budget Checks ===\n');

let failed = false;

// 1. Web UI initial JS bundle size check (< 400 KB gzipped)
console.log('1. Checking Web UI bundle size budget (< 400 KB gzipped)...');
const distWebAssets = 'dist/assets/web/assets';

if (!existsSync(distWebAssets)) {
  console.error(`[FAIL] Web assets directory ${distWebAssets} not found. Run npm run build first.`);
  process.exit(1);
}

const assetFiles = readdirSync(distWebAssets);
const jsFiles = assetFiles.filter((f) => f.endsWith('.js'));

if (jsFiles.length === 0) {
  console.error(`[FAIL] No JS bundle found in ${distWebAssets}`);
  process.exit(1);
}

const MAX_GZIP_BYTES = 400 * 1024; // 400 KB

for (const jsFile of jsFiles) {
  const filePath = join(distWebAssets, jsFile);
  const content = readFileSync(filePath);
  const gzipped = gzipSync(content);
  const sizeKb = (gzipped.byteLength / 1024).toFixed(2);
  const rawKb = (content.byteLength / 1024).toFixed(2);

  if (gzipped.byteLength > MAX_GZIP_BYTES) {
    console.error(`  [FAIL] ${jsFile}: ${sizeKb} KB gzipped exceeds 400 KB budget! (raw: ${rawKb} KB)`);
    failed = true;
  } else {
    console.log(`  [PASS] ${jsFile}: ${sizeKb} KB gzipped (budget: 400 KB, raw: ${rawKb} KB)`);
  }
}

// 2. Daemon idle memory RSS check (< 150 MB)
console.log('\n2. Checking Daemon idle RSS memory budget (< 150 MB)...');
const tempHome = mkdtempSync(join(tmpdir(), 'tendril-budget-home-'));

try {
  // Spawn detached daemon via compiled CLI bundle
  const startRes = spawnSync('node', ['dist/tendril.mjs', 'serve', '--detach', '--home', tempHome], {
    encoding: 'utf-8',
  });

  if (startRes.status !== 0) {
    throw new Error(`Failed to start daemon: ${startRes.stderr || startRes.stdout}`);
  }

  const statePath = join(tempHome, 'state.json');
  if (!existsSync(statePath)) {
    throw new Error(`state.json not found at ${statePath}`);
  }

  const state = JSON.parse(readFileSync(statePath, 'utf-8'));
  const pid = state.pid;

  // Settle idle
  await new Promise((r) => setTimeout(r, 800));

  let rssKb = 0;
  // Try reading /proc/[pid]/status
  const procStatusPath = `/proc/${pid}/status`;
  if (existsSync(procStatusPath)) {
    const statusContent = readFileSync(procStatusPath, 'utf-8');
    const vmRssMatch = statusContent.match(/VmRSS:\s+(\d+)\s+kB/i);
    if (vmRssMatch) {
      rssKb = parseInt(vmRssMatch[1], 10);
    }
  }

  // Fallback to ps if /proc not present
  if (!rssKb) {
    const psRes = spawnSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf-8' });
    if (psRes.status === 0) {
      rssKb = parseInt(psRes.stdout.trim(), 10) || 0;
    }
  }

  const rssMb = (rssKb / 1024).toFixed(2);
  const MAX_RSS_MB = 150;

  if (rssKb > MAX_RSS_MB * 1024) {
    console.error(`  [FAIL] Daemon RSS ${rssMb} MB exceeds ${MAX_RSS_MB} MB budget!`);
    failed = true;
  } else {
    console.log(`  [PASS] Daemon idle RSS: ${rssMb} MB (budget: ${MAX_RSS_MB} MB, PID ${pid})`);
  }

  // Cleanly stop daemon
  spawnSync('node', ['dist/tendril.mjs', 'stop', '--home', tempHome], { encoding: 'utf-8' });
} catch (err) {
  console.error(`  [FAIL] Daemon memory check failed:`, err);
  failed = true;
} finally {
  try {
    rmSync(tempHome, { recursive: true, force: true });
  } catch {}
}

// 3. CLI startup time check
console.log('\n3. Checking CLI startup time...');
const MAX_CLI_START_MS = process.env.CI ? 1500 : 2500; // 1.5s on CI, 2.5s on mobile Termux cold start

const t0 = performance.now();
const res = spawnSync('node', ['dist/tendril.mjs', '--version'], {
  encoding: 'utf-8',
});
const elapsedMs = Math.round(performance.now() - t0);

if (res.status !== 0) {
  console.error(`  [FAIL] CLI exited with code ${res.status}: ${res.stderr}`);
  failed = true;
} else if (elapsedMs > MAX_CLI_START_MS) {
  console.error(`  [FAIL] CLI startup took ${elapsedMs} ms (budget: ${MAX_CLI_START_MS} ms)`);
  failed = true;
} else {
  console.log(`  [PASS] CLI startup: ${elapsedMs} ms (budget: ${MAX_CLI_START_MS} ms) - output: ${res.stdout.trim()}`);
}

console.log('\n======================================================');
if (failed) {
  console.error('TRD Performance Budget check FAILED!');
  process.exit(1);
} else {
  console.log('All TRD Performance & Resource Budget checks PASSED!');
  process.exit(0);
}
