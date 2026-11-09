import { describe, it, expect } from 'vitest';
import {
  parseSemver,
  checkNodeVersion,
  checkSqlite,
  checkGit,
  checkRipgrep,
  checkTermux,
  checkStoragePermission,
  checkTermuxApiSupport,
  checkAllowExternalApps,
  checkWakeLock,
  checkBatteryOptimization,
  runDoctor,
} from '../src/doctor.js';

describe('doctor module', () => {
  it('parses semver versions correctly', () => {
    expect(parseSemver('v24.15.0')).toEqual({ major: 24, minor: 15, patch: 0 });
    expect(parseSemver('26.13.0')).toEqual({ major: 26, minor: 13, patch: 0 });
    expect(parseSemver('invalid')).toBeNull();
  });

  it('validates node versions properly', () => {
    expect(checkNodeVersion('24.15.0').status).toBe('PASS');
    expect(checkNodeVersion('24.16.2').status).toBe('PASS');
    expect(checkNodeVersion('26.0.0').status).toBe('PASS');
    expect(checkNodeVersion('24.14.9').status).toBe('FAIL');
    expect(checkNodeVersion('22.12.0').status).toBe('FAIL');
    expect(checkNodeVersion('not-a-version').status).toBe('FAIL');
  });

  it('checks sqlite support in node runtime', async () => {
    const res = await checkSqlite();
    expect(res.status).toBe('PASS');
    expect(res.message).toContain('DatabaseSync');
  });

  it('checks git and ripgrep tools', () => {
    const gitRes = checkGit();
    expect(['PASS', 'FAIL']).toContain(gitRes.status);
    const rgRes = checkRipgrep();
    expect(['PASS', 'WARN']).toContain(rgRes.status);
  });

  it('checks termux detection and non-termux desktop mode', () => {
    const res = checkTermux();
    expect(res.status).toBe('PASS');
    expect(typeof res.isTermux).toBe('boolean');
    expect(res.message).toBeDefined();

    // In desktop mode (isTermux: false), device checks return PASS
    expect(checkStoragePermission(false).status).toBe('PASS');
    expect(checkTermuxApiSupport(false).status).toBe('PASS');
    expect(checkAllowExternalApps(false).status).toBe('PASS');
    expect(checkWakeLock(false).status).toBe('PASS');
    expect(checkBatteryOptimization(false).status).toBe('PASS');
  });

  it('warns (does not fail) when Termux:API is missing in Termux', () => {
    const originalEnv = process.env.TENDRIL_MOCK_TERMUX_API;
    try {
      process.env.TENDRIL_MOCK_TERMUX_API = 'false';
      const check = checkTermuxApiSupport(true);
      expect(check.status).toBe('WARN');
      expect(check.fix).toBeDefined();
    } finally {
      process.env.TENDRIL_MOCK_TERMUX_API = originalEnv;
    }
  });

  it('passes when Termux:API is available in Termux', () => {
    const originalEnv = process.env.TENDRIL_MOCK_TERMUX_API;
    try {
      process.env.TENDRIL_MOCK_TERMUX_API = 'true';
      const check = checkTermuxApiSupport(true);
      expect(check.status).toBe('PASS');
    } finally {
      process.env.TENDRIL_MOCK_TERMUX_API = originalEnv;
    }
  });

  it('runs doctor aggregate check successfully with 10 checks', async () => {
    const res = await runDoctor();
    expect(res.checks.length).toBe(10);
    expect(typeof res.ok).toBe('boolean');
    const ids = res.checks.map((c) => c.id);
    expect(ids).toEqual([
      'node_version',
      'sqlite',
      'git',
      'ripgrep',
      'termux',
      'storage_permission',
      'termux_api',
      'allow_external_apps',
      'wake_lock',
      'battery_optimization',
    ]);
  });
});
