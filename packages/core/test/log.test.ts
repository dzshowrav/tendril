import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Logger } from '../src/log.js';

describe('log module', () => {
  let tempDir: string;
  let logPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tendril-log-test-'));
    logPath = join(tempDir, 'daemon.log');
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('writes formatted logs to file with 0600 mode', () => {
    const logger = new Logger({ logFilePath: logPath, level: 'debug' });
    logger.info('System initialized');

    expect(existsSync(logPath)).toBe(true);
    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('[INFO] System initialized');

    if (process.platform !== 'win32') {
      const stat = statSync(logPath);
      expect((stat.mode & 0o777)).toBe(0o600);
    }
  });

  it('redacts sensitive tokens, keys, and cookies', () => {
    const logger = new Logger({ logFilePath: logPath, level: 'debug' });
    logger.registerSecret('my-custom-super-secret');

    logger.info('Received header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    logger.info('Received cookie: tdl_session=abcdef1234567890; Path=/');
    logger.info('Used Anthropic key: sk-ant-api03-abcdefghijklmnop');
    logger.info('Custom secret leaked: my-custom-super-secret in payload');
    logger.info('JSON payload', { apiKey: 'sensitive-api-key-value' });

    const content = readFileSync(logPath, 'utf-8');
    expect(content).toContain('Authorization: [REDACTED]');
    expect(content).toContain('tdl_session=[REDACTED]');
    expect(content).not.toContain('sk-ant-api03-abcdefghijklmnop');
    expect(content).not.toContain('my-custom-super-secret');
    expect(content).not.toContain('sensitive-api-key-value');
  });

  it('rotates log files when exceeding maximum size', () => {
    const logger = new Logger({
      logFilePath: logPath,
      maxSizeBytes: 200, // Small size to force rotation quickly
      maxFiles: 3,
    });

    for (let i = 0; i < 20; i++) {
      logger.info(`Log line number ${i} with padding text to fill the buffer beyond size`);
    }

    expect(existsSync(logPath)).toBe(true);
    expect(existsSync(`${logPath}.1`)).toBe(true);
  });
});
