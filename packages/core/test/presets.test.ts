import { describe, it, expect } from 'vitest';
import { PROVIDER_PRESETS, getPreset } from '../src/providers/presets.js';

describe('presets module', () => {
  it('contains all required provider presets', () => {
    const required = [
      'anthropic',
      'openai',
      'openrouter',
      'gemini',
      'ollama',
      'lmstudio',
      'groq',
      'deepseek',
    ];

    for (const id of required) {
      const preset = getPreset(id);
      expect(preset).toBeDefined();
      expect(preset?.id).toBe(id);
      expect(preset?.name).toBeDefined();
      expect(preset?.defaultModel).toBeDefined();
      expect(preset?.contextWindow).toBeGreaterThan(0);
      expect(preset?.docUrl).toMatch(/^https?:\/\//);
    }
  });

  it('configures Gemini official OpenAI-compatible endpoint correctly', () => {
    const gemini = getPreset('gemini');
    expect(gemini?.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai/');
    expect(gemini?.type).toBe('openai-compatible');
  });

  it('configures local models without requiring API key', () => {
    const ollama = getPreset('ollama');
    const lmstudio = getPreset('lmstudio');
    expect(ollama?.apiKeyRequired).toBe(false);
    expect(lmstudio?.apiKeyRequired).toBe(false);
  });
});
