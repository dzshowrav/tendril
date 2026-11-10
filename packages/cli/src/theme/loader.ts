import { detectTerminalCapabilities } from '../capabilities/detector.js';
import { ENV_VARS, ThemeName } from '../config/constants.js';
import { loadStoredConfigFile } from '../config/settings.js';
import { darkSymbols, darkTheme } from './dark.js';
import { lightSymbols, lightTheme } from './light.js';
import { safeSymbols, safeTheme } from './safe.js';
import { ColorFormatters, ThemeSymbols } from './tokens.js';

export interface SemanticTokens {
  text: {
    primary: (str: string) => string;
    muted: (str: string) => string;
    error: (str: string) => string;
    success: (str: string) => string;
    warning: (str: string) => string;
  };
  status: {
    info: (str: string) => string;
    success: (str: string) => string;
    error: (str: string) => string;
    waiting: (str: string) => string;
    running: (str: string) => string;
  };
  border: {
    active: (str: string) => string;
    focus: (str: string) => string;
    muted: (str: string) => string;
  };
  prompt: {
    default: (str: string) => string;
    accent: (str: string) => string;
  };
  diff: {
    addition: (str: string) => string;
    removal: (str: string) => string;
  };
}

export function buildSemanticTokens(c: ColorFormatters): SemanticTokens {
  return {
    text: {
      primary: c.textPrimary,
      muted: c.textMuted,
      error: c.textError,
      success: c.textSuccess,
      warning: c.textWarning,
    },
    status: {
      info: c.textAccent || c.textPrimary,
      success: c.statusSuccess,
      error: c.statusError,
      waiting: c.statusWaiting,
      running: c.statusRunning,
    },
    border: {
      active: c.borderFocus,
      focus: c.borderFocus,
      muted: c.borderDefault,
    },
    prompt: {
      default: c.textPrimary,
      accent: c.promptAccent,
    },
    diff: {
      addition: c.textSuccess,
      removal: c.textError,
    },
  };
}

export interface ActiveTheme {
  name: ThemeName;
  colors: ColorFormatters;
  tokens: SemanticTokens;
  symbols: ThemeSymbols;
  isNoColor: boolean;
}

export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Creates a NO_COLOR wrapper around any color formatter to ensure
 * zero ANSI codes are emitted when NO_COLOR is active.
 */
export function createNoColorTheme(baseTheme: ColorFormatters): ColorFormatters {
  const result: any = {};
  for (const [key, fn] of Object.entries(baseTheme)) {
    if (typeof fn === 'function') {
      result[key] = (s: string) => stripAnsi(fn(s));
    } else {
      result[key] = fn;
    }
  }
  return result as ColorFormatters;
}

export function resolveActiveTheme(options?: {
  themeName?: string;
  forceNoColor?: boolean;
}): ActiveTheme {
  const caps = detectTerminalCapabilities();
  const config = loadStoredConfigFile();

  const isNoColor =
    options?.forceNoColor ||
    !caps.hasColor ||
    process.env[ENV_VARS.NO_COLOR] !== undefined;

  let requestedName =
    options?.themeName ||
    process.env[ENV_VARS.TENDRIL_THEME] ||
    config.theme;

  if (!options?.themeName && (caps.asciiOnly || caps.colorDepth === 'none')) {
    requestedName = 'safe';
  }

  let name: ThemeName = 'dark';
  let colors: ColorFormatters = darkTheme;
  let symbols: ThemeSymbols = darkSymbols;

  if (requestedName === 'light') {
    name = 'light';
    colors = lightTheme;
    symbols = lightSymbols;
  } else if (requestedName === 'safe') {
    name = 'safe';
    colors = safeTheme;
    symbols = safeSymbols;
  } else {
    name = 'dark';
    colors = darkTheme;
    symbols = darkSymbols;
  }

  if (caps.asciiOnly) {
    symbols = safeSymbols;
  }

  if (isNoColor) {
    colors = createNoColorTheme(colors);
  }

  const tokens = buildSemanticTokens(colors);

  return {
    name,
    colors,
    tokens,
    symbols,
    isNoColor,
  };
}
