import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, saveConfig, DEFAULT_CONFIG, ConfigSchema } from '../src/config.js';
import { loadAuth, saveAuth, maskApiKey, getEffectiveApiKey, getEnvKeyName } from '../src/auth.js';

describe('config and auth module', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tendril-cfg-test-'));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('loads default config when file does not exist', () => {
    const configPath = join(tempDir, 'config.json');
    const cfg = loadConfig(configPath);
    expect(cfg.port).toBe(7421);
    expect(cfg.defaultMode).toBe('ask');
    expect(cfg.defaultProvider).toBe('anthropic');
  });

  it('validates config schema and rejects yolo mode', () => {
    expect(() => {
      ConfigSchema.parse({
        defaultMode: 'yolo', // Disallowed in config.json
      });
    }).toThrow();
  });

  it('saves and loads config with 0600 file permissions', () => {
    const configPath = join(tempDir, 'config.json');
    const customConfig = {
      ...DEFAULT_CONFIG,
      port: 8080,
      defaultMode: 'plan' as const,
    };

    saveConfig(configPath, customConfig);
    const loaded = loadConfig(configPath);
    expect(loaded.port).toBe(8080);
    expect(loaded.defaultMode).toBe('plan');

    if (process.platform !== 'win32') {
      const stat = statSync(configPath);
      expect((stat.mode & 0o777)).toBe(0o600);
    }
  });

  it('masks API keys safely', () => {
    expect(maskApiKey(null)).toBe('');
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('123')).toBe('••••');
    expect(maskApiKey('sk-ant-api03-1234567890abcdef')).toBe('••••cdef');
  });

  it('derives correct environment variable names', () => {
    expect(getEnvKeyName('anthropic')).toBe('TENDRIL_ANTHROPIC_API_KEY');
    expect(getEnvKeyName('open-router')).toBe('TENDRIL_OPEN_ROUTER_API_KEY');
  });

  it('handles auth file save/load with 0600 mode and env var overrides', () => {
    const authPath = join(tempDir, 'auth.json');
    const authData = {
      providers: {
        anthropic: {
          type: 'anthropic' as const,
          name: 'Anthropic',
          apiKey: 'file-key-12345',
          baseUrl: null,
        },
      },
    };

    saveAuth(authPath, authData);
    const loaded = loadAuth(authPath);
    expect(loaded.providers.anthropic.apiKey).toBe('file-key-12345');

    if (process.platform !== 'win32') {
      const stat = statSync(authPath);
      expect((stat.mode & 0o777)).toBe(0o600);
    }

    // Without env override
    expect(getEffectiveApiKey('anthropic', loaded)).toBe('file-key-12345');

    // With env override
    process.env.TENDRIL_ANTHROPIC_API_KEY = 'env-override-9999';
    expect(getEffectiveApiKey('anthropic', loaded)).toBe('env-override-9999');
    delete process.env.TENDRIL_ANTHROPIC_API_KEY;
  });
});
