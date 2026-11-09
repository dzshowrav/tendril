#!/usr/bin/env node
/**
 * Tendril Android Shell Security & Compliance Linter
 * Ensures strict security hardening for apps/android-shell.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SHELL_DIR = resolve('apps/android-shell');

function getAllFiles(dir, fileList = []) {
  const files = readdirSync(dir);
  for (const file of files) {
    const fullPath = join(dir, file);
    if (statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, fileList);
    } else {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

const errors = [];

console.log('Linting Android Shell (apps/android-shell)...');

// 1. Assert NO addJavascriptInterface exists in any source or config file
const allFiles = getAllFiles(SHELL_DIR);
for (const file of allFiles) {
  // Skip proguard config file or documentation files
  if (file.endsWith('proguard-rules.pro') || file.endsWith('.md')) continue;

  const content = readFileSync(file, 'utf8');
  if (content.includes('addJavascriptInterface')) {
    errors.push(`Prohibited 'addJavascriptInterface' found in: ${file}`);
  }
}

// 2. Validate AndroidManifest.xml
const manifestPath = join(SHELL_DIR, 'app/src/main/AndroidManifest.xml');
const manifestContent = readFileSync(manifestPath, 'utf8');

if (!manifestContent.includes('android.permission.INTERNET')) {
  errors.push('AndroidManifest.xml missing android.permission.INTERNET');
}
if (!manifestContent.includes('com.termux.permission.RUN_COMMAND')) {
  errors.push('AndroidManifest.xml missing com.termux.permission.RUN_COMMAND');
}
if (!manifestContent.includes('<package android:name="com.termux" />')) {
  errors.push('AndroidManifest.xml missing <queries> declaration for com.termux');
}
if (!manifestContent.includes('android:networkSecurityConfig="@xml/network_security_config"')) {
  errors.push('AndroidManifest.xml missing networkSecurityConfig declaration');
}

// 3. Validate network_security_config.xml
const netSecPath = join(SHELL_DIR, 'app/src/main/res/xml/network_security_config.xml');
const netSecContent = readFileSync(netSecPath, 'utf8');

if (!netSecContent.includes('cleartextTrafficPermitted="false"')) {
  errors.push('network_security_config.xml does not set cleartextTrafficPermitted="false" for base-config');
}
if (!netSecContent.includes('<domain includeSubdomains="false">127.0.0.1</domain>') ||
    !netSecContent.includes('<domain includeSubdomains="false">localhost</domain>')) {
  errors.push('network_security_config.xml does not restrict cleartext strictly to 127.0.0.1 and localhost');
}

// 4. Validate MainActivity.kt hardening
const mainActivityPath = join(SHELL_DIR, 'app/src/main/java/dev/tendril/shell/MainActivity.kt');
const mainActivityContent = readFileSync(mainActivityPath, 'utf8');

if (!mainActivityContent.includes('settings.allowFileAccess = false')) {
  errors.push('MainActivity.kt missing settings.allowFileAccess = false');
}
if (!mainActivityContent.includes('settings.allowContentAccess = false')) {
  errors.push('MainActivity.kt missing settings.allowContentAccess = false');
}
if (!mainActivityContent.includes('MIXED_CONTENT_NEVER_ALLOW')) {
  errors.push('MainActivity.kt missing MIXED_CONTENT_NEVER_ALLOW configuration');
}
if (!mainActivityContent.includes('ACTION_VIEW')) {
  errors.push('MainActivity.kt missing ACTION_VIEW dispatch for external links');
}

// 5. Validate Application ID / Namespace in build.gradle.kts
const gradlePath = join(SHELL_DIR, 'app/build.gradle.kts');
const gradleContent = readFileSync(gradlePath, 'utf8');

if (!gradleContent.includes('applicationId = "dev.tendril.shell"')) {
  errors.push('app/build.gradle.kts does not set applicationId to dev.tendril.shell');
}

if (errors.length > 0) {
  console.error('\nAndroid Shell Lint FAILED with the following violations:');
  for (const err of errors) {
    console.error(` ✗ ${err}`);
  }
  process.exit(1);
}

console.log('✓ Android Shell Lint PASSED (Hardening, network security, and zero addJavascriptInterface verified)\n');
