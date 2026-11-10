import { ENV_VARS } from '../config/constants.js';

export interface TerminalCapabilities {
  synchronizedOutput: boolean;
  hyperlinks: boolean;
  progressIndicator: boolean;
  colorDepth: 'truecolor' | '256' | '16' | 'none';
  hasColor: boolean;
  supportsStatus: boolean;
  asciiOnly: boolean;
  isTTY: boolean;
  columns: number;
  rows: number;
}

export function detectTerminalCapabilities(): TerminalCapabilities {
  const isTTY = Boolean(process.stdout.isTTY);
  const term = (process.env.TERM || '').toLowerCase();
  const colorTerm = (process.env.COLORTERM || '').toLowerCase();

  // NO_COLOR standard: https://no-color.org/
  const noColorEnv = process.env[ENV_VARS.NO_COLOR] !== undefined && process.env[ENV_VARS.NO_COLOR] !== '';

  // Determine color depth
  let colorDepth: 'truecolor' | '256' | '16' | 'none' = '16';
  if (!isTTY || noColorEnv || term === 'dumb') {
    colorDepth = 'none';
  } else if (colorTerm === 'truecolor' || colorTerm === '24bit') {
    colorDepth = 'truecolor';
  } else if (term.includes('256') || term.includes('alacritty') || term.includes('kitty') || term.includes('xterm')) {
    colorDepth = '256';
  }

  // Hyperlinks: OSC 8 support
  const hyperlinksOptOut = Boolean(process.env[ENV_VARS.TENDRIL_NO_HYPERLINKS]);
  const supportsHyperlinks =
    isTTY &&
    !hyperlinksOptOut &&
    (Boolean(process.env.WT_SESSION) || // Windows Terminal
      Boolean(process.env.GHOSTTY_RESOURCES_DIR) || // Ghostty
      Boolean(process.env.KITTY_PID) || // Kitty
      Boolean(process.env.WEZTERM_PANE) || // WezTerm
      term.includes('kitty') ||
      term.includes('alacritty') ||
      term.includes('xterm'));

  // Synchronized Output: Mode 2026 support
  const syncOptOut = Boolean(process.env[ENV_VARS.TENDRIL_NO_SYNCHRONIZED]);
  const supportsSync =
    isTTY &&
    !syncOptOut &&
    (term.includes('kitty') ||
      term.includes('alacritty') ||
      term.includes('foot') ||
      Boolean(process.env.GHOSTTY_RESOURCES_DIR) ||
      Boolean(process.env.WEZTERM_PANE));

  // Progress / Title bar indicator
  const progressOptOut = Boolean(process.env[ENV_VARS.TENDRIL_NO_PROGRESS]);
  const supportsProgress = isTTY && !progressOptOut && term !== 'dumb';

  // Program status escape sequence (OSC / mode)
  const statusOptOut = Boolean(process.env[ENV_VARS.TENDRIL_NO_PROGRAM_STATUS]);
  const supportsStatus = isTTY && !statusOptOut && term !== 'dumb';

  // ASCII mode
  const asciiOnly = Boolean(process.env[ENV_VARS.TENDRIL_ASCII_MODE]);

  return {
    synchronizedOutput: supportsSync,
    hyperlinks: supportsHyperlinks,
    progressIndicator: supportsProgress,
    colorDepth,
    hasColor: colorDepth !== 'none',
    supportsStatus,
    asciiOnly,
    isTTY,
    columns: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

/**
 * Sends program status escape sequence to terminal if supported.
 * Status: 'idle' | 'working' | 'waiting' | 'done' | 'error'
 */
export function setProgramStatus(status: 'idle' | 'working' | 'waiting' | 'done' | 'error', caps = detectTerminalCapabilities()): void {
  if (!caps.supportsStatus) return;

  // Set terminal window title to reflect status
  const titleMap = {
    idle: 'Tendril (Idle)',
    working: 'Tendril (Working...)',
    waiting: 'Tendril (Awaiting Input)',
    done: 'Tendril (Done)',
    error: 'Tendril (Error)',
  };

  process.stdout.write(`\x1b]0;${titleMap[status]}\x07`);
}
