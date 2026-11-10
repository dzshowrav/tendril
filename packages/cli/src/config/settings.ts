import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULTS, ENV_VARS, RETIRED_MODES, ThemeName, UIMode } from './constants.js';

export type SettingSource = 'flag' | 'env' | 'settings' | 'default';

export interface ResolvedSetting<T> {
  value: T;
  source: SettingSource;
  notice?: string;
}

export interface CliSettings {
  uiMode: UIMode;
  theme: ThemeName;
  historyMode: 'session' | 'global';
  showThinking: boolean;
}

export function loadStoredConfigFile(): Record<string, any> {
  const customHome = process.env.TENDRIL_HOME || join(homedir(), '.tendril');
  const configPath = join(customHome, 'config.json');
  if (existsSync(configPath)) {
    try {
      return JSON.parse(readFileSync(configPath, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Resolves a setting using strict precedence:
 * 1. CLI flag
 * 2. Environment variable
 * 3. Settings file (~/.tendril/config.json)
 * 4. Default value
 */
export function resolveSetting<T>(
  key: string,
  flagVal: T | undefined,
  envVar: string | undefined,
  settingsVal: T | undefined,
  defaultVal: T,
  validator?: (val: any) => boolean,
): ResolvedSetting<T> {
  // 1. CLI Flag
  if (flagVal !== undefined && flagVal !== null && flagVal !== '') {
    if (!validator || validator(flagVal)) {
      return { value: flagVal, source: 'flag' };
    }
  }

  // 2. Environment Variable
  if (envVar && process.env[envVar] !== undefined && process.env[envVar] !== '') {
    const rawEnv = process.env[envVar] as any;
    if (!validator || validator(rawEnv)) {
      return { value: rawEnv, source: 'env' };
    }
  }

  // 3. Settings File
  if (settingsVal !== undefined && settingsVal !== null && settingsVal !== '') {
    if (!validator || validator(settingsVal)) {
      return { value: settingsVal, source: 'settings' };
    }
  }

  // 4. Default Value
  return { value: defaultVal, source: 'default' };
}

/**
 * Resolves UI mode with retired mode detection and validation.
 */
export function resolveUIMode(options: {
  flag?: string;
  config?: Record<string, any>;
}): ResolvedSetting<UIMode> {
  const { flag, config = loadStoredConfigFile() } = options;

  let chosenRaw: string | undefined;
  let source: SettingSource = 'default';

  if (flag) {
    chosenRaw = flag;
    source = 'flag';
  } else if (process.env[ENV_VARS.TENDRIL_UI_MODE]) {
    chosenRaw = process.env[ENV_VARS.TENDRIL_UI_MODE];
    source = 'env';
  } else if (config.uiMode) {
    chosenRaw = config.uiMode;
    source = 'settings';
  }

  if (chosenRaw) {
    if (RETIRED_MODES.has(chosenRaw)) {
      return {
        value: DEFAULTS.uiMode,
        source: 'default',
        notice: `Mode '${chosenRaw}' (selected via ${source}) is retired. Continuing with modern '${DEFAULTS.uiMode}' interface.`,
      };
    }

    if (chosenRaw === 'tui' || chosenRaw === 'repl' || chosenRaw === 'headless') {
      return { value: chosenRaw as UIMode, source };
    }

    return {
      value: DEFAULTS.uiMode,
      source: 'default',
      notice: `Invalid UI mode '${chosenRaw}' specified in ${source}. Falling back to '${DEFAULTS.uiMode}'.`,
    };
  }

  return { value: DEFAULTS.uiMode, source: 'default' };
}
