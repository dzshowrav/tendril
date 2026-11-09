import { describe, it, expect } from 'vitest';
import { parseSemver, checkNodeVersion, checkSqlite, checkTermux, runDoctor } from '../src/doctor.js';

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

  it('checks termux detection', () => {
    const res = checkTermux();
    expect(['PASS', 'WARN']).toContain(res.status);
    expect(res.message).toBeDefined();
  });

  it('runs doctor aggregate check successfully', async () => {
    const res = await runDoctor();
    expect(res.checks.length).toBe(3);
    expect(res.ok).toBe(true);
  });
});
