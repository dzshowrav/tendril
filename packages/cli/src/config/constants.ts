/**
 * Configuration constants and environment variable mappings for Tendril CLI.
 * Follows Kiro-style Terminal UI specification (new-ins.md).
 */

export const ENV_VARS = {
  NO_COLOR: 'NO_COLOR',
  TENDRIL_THEME: 'TENDRIL_THEME',
  TENDRIL_UI_MODE: 'TENDRIL_UI_MODE',
  TENDRIL_NO_HYPERLINKS: 'TENDRIL_NO_HYPERLINKS',
  TENDRIL_NO_PROGRESS: 'TENDRIL_NO_PROGRESS',
  TENDRIL_NO_SYNCHRONIZED: 'TENDRIL_NO_SYNCHRONIZED',
  TENDRIL_NO_PROGRAM_STATUS: 'TENDRIL_NO_PROGRAM_STATUS',
  TENDRIL_ASCII_MODE: 'TENDRIL_ASCII_MODE',
} as const;

export type UIMode = 'tui' | 'repl' | 'headless';

export type ThemeName = 'dark' | 'light' | 'safe';

export const DEFAULTS = {
  uiMode: 'repl' as UIMode,
  theme: 'dark' as ThemeName,
  historyMode: 'session' as 'session' | 'global',
  showThinking: true,
  maxHistoryEntries: 1000,
} as const;

export const RETIRED_MODES = new Set(['legacy-cli', 'classic', 'raw-repl']);
