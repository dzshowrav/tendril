import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

describe('Android Shell Security Contract (F12)', () => {
  const rootDir = resolve('.');
  const shellDir = join(rootDir, 'apps/android-shell');

  it('runs lint-shell.mjs without violations', () => {
    const output = execFileSync('node', ['scripts/lint-shell.mjs'], {
      cwd: rootDir,
      encoding: 'utf8',
    });
    expect(output).toContain('Android Shell Lint PASSED');
  });

  it('manifest specifies dev.tendril.shell package, permissions, and Termux query', () => {
    const manifestPath = join(shellDir, 'app/src/main/AndroidManifest.xml');
    expect(existsSync(manifestPath)).toBe(true);

    const content = readFileSync(manifestPath, 'utf8');
    expect(content).toContain('android.permission.INTERNET');
    expect(content).toContain('com.termux.permission.RUN_COMMAND');
    expect(content).toContain('<package android:name="com.termux" />');
    expect(content).toContain('android:networkSecurityConfig="@xml/network_security_config"');
  });

  it('restricts cleartext traffic strictly to loopback (127.0.0.1 and localhost)', () => {
    const netSecPath = join(shellDir, 'app/src/main/res/xml/network_security_config.xml');
    expect(existsSync(netSecPath)).toBe(true);

    const content = readFileSync(netSecPath, 'utf8');
    expect(content).toContain('cleartextTrafficPermitted="false"');
    expect(content).toContain('<domain includeSubdomains="false">127.0.0.1</domain>');
    expect(content).toContain('<domain includeSubdomains="false">localhost</domain>');
  });

  it('hardens WebView and strictly prohibits addJavascriptInterface', () => {
    const activityPath = join(shellDir, 'app/src/main/java/dev/tendril/shell/MainActivity.kt');
    expect(existsSync(activityPath)).toBe(true);

    const content = readFileSync(activityPath, 'utf8');
    expect(content).toContain('settings.allowFileAccess = false');
    expect(content).toContain('settings.allowContentAccess = false');
    expect(content).toContain('MIXED_CONTENT_NEVER_ALLOW');
    expect(content).toContain('ACTION_VIEW');
    expect(content).not.toContain('addJavascriptInterface');
  });

  it('configures Gradle build with applicationId dev.tendril.shell and minSdk 26', () => {
    const gradlePath = join(shellDir, 'app/build.gradle.kts');
    expect(existsSync(gradlePath)).toBe(true);

    const content = readFileSync(gradlePath, 'utf8');
    expect(content).toContain('applicationId = "dev.tendril.shell"');
    expect(content).toContain('minSdk = 26');
    expect(content).toContain('targetSdk = 34');
  });
});
