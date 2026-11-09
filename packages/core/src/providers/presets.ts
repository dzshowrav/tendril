export type ProviderType = 'anthropic' | 'openai-compatible';

export interface ProviderPreset {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string | null;
  defaultModel: string;
  contextWindow: number;
  apiKeyRequired: boolean;
  docUrl: string;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    type: 'anthropic',
    baseUrl: null, // Resolves to https://api.anthropic.com/v1
    defaultModel: 'claude-sonnet-5-5',
    contextWindow: 200000,
    apiKeyRequired: true,
    docUrl: 'https://docs.anthropic.com/en/api/messages',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    contextWindow: 128000,
    apiKeyRequired: true,
    docUrl: 'https://platform.openai.com/docs/api-reference/chat',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    type: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    contextWindow: 200000,
    apiKeyRequired: true,
    docUrl: 'https://openrouter.ai/docs/quick-start',
  },
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    type: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    defaultModel: 'gemini-2.0-flash',
    contextWindow: 1048576,
    apiKeyRequired: true,
    docUrl: 'https://ai.google.dev/gemini-api/docs/openai',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama',
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    defaultModel: 'llama3.1',
    contextWindow: 128000,
    apiKeyRequired: false,
    docUrl: 'https://github.com/ollama/ollama/blob/main/docs/openai.md',
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio',
    type: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    defaultModel: 'local-model',
    contextWindow: 32768,
    apiKeyRequired: false,
    docUrl: 'https://lmstudio.ai/docs/local-server',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    type: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    contextWindow: 128000,
    apiKeyRequired: true,
    docUrl: 'https://console.groq.com/docs/openai',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    contextWindow: 64000,
    apiKeyRequired: true,
    docUrl: 'https://api-docs.deepseek.com',
  },
};

export function getPreset(presetId: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS[presetId];
}
