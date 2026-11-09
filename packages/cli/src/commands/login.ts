import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  getTendrilPaths,
  loadAuth,
  saveAuth,
  loadConfig,
  saveConfig,
  PROVIDER_PRESETS,
  ProviderType,
} from '@tendril/core';
import { theme } from '../ui/theme.js';

export interface LoginOptions {
  home?: string;
}

export async function loginCommand(options: LoginOptions = {}): Promise<void> {
  const paths = getTendrilPaths(options.home);

  p.intro(pc.bold(pc.cyan('Tendril Login Wizard')));

  const providerChoices = Object.values(PROVIDER_PRESETS).map((preset) => ({
    value: preset.id,
    label: preset.name,
    hint: preset.defaultModel,
  }));

  providerChoices.push({
    value: 'custom',
    label: 'Custom OpenAI-compatible',
    hint: 'Self-hosted or other provider',
  });

  const selectedProviderId = await p.select({
    message: 'Select a model provider:',
    options: providerChoices,
  });

  if (p.isCancel(selectedProviderId)) {
    p.cancel('Login cancelled.');
    return;
  }

  const preset = PROVIDER_PRESETS[selectedProviderId as string];
  const isCustom = selectedProviderId === 'custom';
  const providerType: ProviderType = preset ? preset.type : 'openai-compatible';

  let baseUrl = preset?.baseUrl || null;
  if (isCustom) {
    const urlInput = await p.text({
      message: 'Base URL (e.g. http://127.0.0.1:11434/v1):',
      placeholder: 'http://127.0.0.1:8000/v1',
      validate: (val) => {
        if (!val || !val.trim()) return 'Base URL cannot be empty';
        try {
          new URL(val.trim());
        } catch {
          return 'Please enter a valid URL';
        }
      },
    });

    if (p.isCancel(urlInput)) {
      p.cancel('Login cancelled.');
      return;
    }
    baseUrl = urlInput.trim();
  }

  // API Key
  let apiKey: string | null = null;
  if (!preset || preset.apiKeyRequired) {
    const keyInput = await p.password({
      message: `Enter API key for ${preset?.name || 'custom provider'}:`,
      validate: (val) => {
        if (!val || !val.trim()) return 'API key cannot be empty';
      },
    });

    if (p.isCancel(keyInput)) {
      p.cancel('Login cancelled.');
      return;
    }
    apiKey = keyInput.trim();
  }

  // Default Model
  const defaultModelName = preset?.defaultModel || 'gpt-4o';
  const modelInput = await p.text({
    message: 'Default model name:',
    defaultValue: defaultModelName,
    placeholder: defaultModelName,
  });

  if (p.isCancel(modelInput)) {
    p.cancel('Login cancelled.');
    return;
  }
  const modelName = modelInput.trim() || defaultModelName;

  // Test provider connection
  const s = p.spinner();
  s.start('Validating provider credentials...');

  try {
    // Save to auth.json
    const auth = loadAuth(paths.authPath);
    auth.providers[selectedProviderId as string] = {
      type: providerType,
      name: preset?.name || 'Custom',
      apiKey,
      baseUrl,
    };
    saveAuth(paths.authPath, auth);

    // Save default to config.json
    const config = loadConfig(paths.configPath);
    config.defaultProvider = selectedProviderId as string;
    config.defaultModel = modelName;
    saveConfig(paths.configPath, config);

    s.stop('Credentials verified and saved.');
    p.outro(theme.success(`Configured ${preset?.name || 'Custom'} with default model '${modelName}'.`));
  } catch (err: any) {
    s.stop('Failed to save credentials.');
    p.cancel(theme.fail(`Error: ${err.message}`));
    process.exitCode = 1;
  }
}
