import { z } from 'zod';
import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const ModelConfigSchema = z.object({
  contextWindow: z.number().int().positive(),
});

export const ConfigSchema = z.object({
  port: z.number().int().min(1024).max(65535).default(7421),
  defaultProvider: z.string().default('anthropic'),
  defaultModel: z.string().default('claude-sonnet-5-5'),
  defaultMode: z.enum(['plan', 'ask', 'auto-edit']).default('ask'),
  maxStepsPerTurn: z.number().int().positive().default(50),
  maxConcurrentTurns: z.number().int().positive().default(3),
  wakeLock: z.boolean().default(true),
  additionalDirs: z.array(z.string()).default([]),
  models: z.record(z.string(), ModelConfigSchema).default({}),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export const DEFAULT_CONFIG: Config = {
  port: 7421,
  defaultProvider: 'anthropic',
  defaultModel: 'claude-sonnet-5-5',
  defaultMode: 'ask',
  maxStepsPerTurn: 50,
  maxConcurrentTurns: 3,
  wakeLock: true,
  additionalDirs: [],
  models: {
    'anthropic/claude-sonnet-5-5': { contextWindow: 200000 },
  },
};

/**
 * Atomically writes data as formatted JSON using a temporary file and rename.
 * Guarantees atomic replacement and specifies POSIX file mode (default 0600).
 */
export function atomicWriteJson(filePath: string, data: unknown, mode = 0o600): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  const json = JSON.stringify(data, null, 2) + '\n';

  writeFileSync(tmpPath, json, { mode, encoding: 'utf-8' });
  try {
    chmodSync(tmpPath, mode);
  } catch {
    // Ignore chmod errors on systems without permissions support
  }

  renameSync(tmpPath, filePath);
  try {
    chmodSync(filePath, mode);
  } catch {
    // Ignore chmod errors
  }
}

/**
 * Loads and validates config from JSON file, returning DEFAULT_CONFIG if file does not exist.
 */
export function loadConfig(configPath: string): Config {
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return ConfigSchema.parse(parsed);
  } catch (err) {
    throw new Error(`Failed to load config at ${configPath}: ${(err as Error).message}`);
  }
}

/**
 * Validates and atomically writes config to JSON file with mode 0600.
 */
export function saveConfig(configPath: string, config: Config): void {
  const validated = ConfigSchema.parse(config);
  atomicWriteJson(configPath, validated, 0o600);
}
