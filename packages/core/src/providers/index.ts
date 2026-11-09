import { ProviderAdapter } from './types.js';
import { ProviderType } from './presets.js';
import { AnthropicAdapter, AnthropicAdapterOptions } from './anthropic.js';
import { OpenAICompatibleAdapter, OpenAICompatibleAdapterOptions } from './openai-compatible.js';
import { RetryOptions } from './retry.js';

export * from './types.js';
export * from './sse.js';
export * from './retry.js';
export * from './presets.js';
export * from './anthropic.js';
export * from './openai-compatible.js';

export interface CreateProviderOptions {
  apiKey?: string | null;
  baseUrl?: string | null;
  retryOptions?: RetryOptions;
}

export function createProviderAdapter(
  type: ProviderType,
  options: CreateProviderOptions = {},
): ProviderAdapter {
  if (type === 'anthropic') {
    return new AnthropicAdapter({
      apiKey: options.apiKey || '',
      baseUrl: options.baseUrl,
      retryOptions: options.retryOptions,
    });
  }

  if (type === 'openai-compatible') {
    return new OpenAICompatibleAdapter({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      retryOptions: options.retryOptions,
    });
  }

  throw new Error(`Unsupported provider type: ${type}`);
}
