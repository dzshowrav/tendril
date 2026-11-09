import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import { atomicWriteJson } from './config.js';

export const ProviderAuthSchema = z.object({
  type: z.enum(['anthropic', 'openai-compatible']),
  name: z.string(),
  apiKey: z.string().nullable().optional(),
  baseUrl: z.string().nullable().optional().default(null),
});

export const AuthFileSchema = z.object({
  providers: z.record(z.string(), ProviderAuthSchema).default({}),
});

export type ProviderAuth = z.infer<typeof ProviderAuthSchema>;
export type AuthFile = z.infer<typeof AuthFileSchema>;

export const DEFAULT_AUTH: AuthFile = {
  providers: {},
};

/**
 * Returns a masked representation of an API key ("••••" + last 4 characters).
 */
export function maskApiKey(key: string | null | undefined): string {
  if (!key) return '';
  if (key.length <= 4) return '••••';
  return '••••' + key.slice(-4);
}

/**
 * Derives the environment variable name for a provider key override.
 * E.g., "anthropic" -> "TENDRIL_ANTHROPIC_API_KEY"
 * E.g., "lm-studio" -> "TENDRIL_LM_STUDIO_API_KEY"
 */
export function getEnvKeyName(providerId: string): string {
  const normalized = providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `TENDRIL_${normalized}_API_KEY`;
}

/**
 * Resolves the effective API key for a provider.
 * Environment variables override the stored file value.
 */
export function getEffectiveApiKey(providerId: string, auth: AuthFile): string | null {
  // 1. Primary override: TENDRIL_<PROVIDERID>_API_KEY
  const envKey = getEnvKeyName(providerId);
  if (process.env[envKey]) {
    return process.env[envKey]!;
  }

  // 2. Standard provider fallbacks
  if (providerId === 'anthropic' && process.env.ANTHROPIC_API_KEY) {
    return process.env.ANTHROPIC_API_KEY;
  }
  if (providerId === 'openai' && process.env.OPENAI_API_KEY) {
    return process.env.OPENAI_API_KEY;
  }
  if (providerId === 'openrouter' && process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }
  if (providerId === 'groq' && process.env.GROQ_API_KEY) {
    return process.env.GROQ_API_KEY;
  }
  if (providerId === 'deepseek' && process.env.DEEPSEEK_API_KEY) {
    return process.env.DEEPSEEK_API_KEY;
  }

  // 3. Stored in auth.json
  const provider = auth.providers[providerId];
  return provider?.apiKey || null;
}

/**
 * Loads auth.json and validates its schema.
 */
export function loadAuth(authPath: string): AuthFile {
  if (!existsSync(authPath)) {
    return { ...DEFAULT_AUTH };
  }

  try {
    const raw = readFileSync(authPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return AuthFileSchema.parse(parsed);
  } catch (err) {
    throw new Error(`Failed to load auth credentials at ${authPath}: ${(err as Error).message}`);
  }
}

/**
 * Saves auth.json atomically with mode 0600.
 */
export function saveAuth(authPath: string, auth: AuthFile): void {
  const validated = AuthFileSchema.parse(auth);
  atomicWriteJson(authPath, validated, 0o600);
}
