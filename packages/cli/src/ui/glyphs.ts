/**
 * Glyph Vocabulary & ASCII Fallback System.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 1).
 *
 * Single source of truth for all glyphs.
 * Every component obtains glyphs from this module.
 */

import { detectTerminalCapabilities } from '../capabilities/detector.js';
import { ENV_VARS } from '../config/constants.js';

export interface GlyphSet {
  // Bullets & Connectors
  bullet: string; // '●' vs '*'
  connector: string; // '⎿' vs '\_'
  prompt: string; // '>' vs '>'
  shellPrompt: string; // '!' vs '!'

  // Spinners & Status
  spinnerFrames: string[]; // ['⠋', '⠙', ...] vs ['-', '\\', '|', '/']
  success: string; // '✓' vs '[ok]'
  error: string; // '✗' vs '[x]'
  waiting: string; // '…' vs '...'
  thinking: string; // '✻' vs '~'
  ellipsis: string; // '…' vs '...'

  // Tasks & Navigation
  taskOpen: string; // '☐' vs '[ ]'
  taskDone: string; // '☒' vs '[x]'
  focusCaret: string; // '▸' vs '>'
  scrollUp: string; // '▲' vs '^'
  scrollDown: string; // '▼' vs 'v'
  scrollbarThumb: string; // '┃' vs '|'
  scrollbarTrack: string; // '│' vs '|'
  commentMarker: string; // '▌' vs '|'

  // Progress Bar
  progressFill: string; // '█' vs '#'
  progressEmpty: string; // '░' vs '.'

  // Box Drawing & Dividers
  boxTopLeft: string; // '╭' vs '+'
  boxTopRight: string; // '╮' vs '+'
  boxBottomLeft: string; // '╰' vs '+'
  boxBottomRight: string; // '╯' vs '+'
  boxHorizontal: string; // '─' vs '-'
  boxVertical: string; // '│' vs '|'
  boxTeeLeft: string; // '├' vs '+'
  boxTeeRight: string; // '┤' vs '+'
  boxTeeTop: string; // '┬' vs '+'
  boxTeeBottom: string; // '┴' vs '+'
  boxCross: string; // '┼' vs '+'
  dashedDivider: string; // '┄' vs '-'
  hunkDivider: string; // '···' vs '...'

  // Double Box
  doubleTopLeft: string; // '╔' vs '+'
  doubleTopRight: string; // '╗' vs '+'
  doubleBottomLeft: string; // '╚' vs '+'
  doubleBottomRight: string; // '╝' vs '+'
  doubleHorizontal: string; // '═' vs '='
  doubleVertical: string; // '║' vs '|'

  // Notice Markers
  noticeInfo: string; // 'i'
  noticeWarn: string; // '!'
  noticeError: string; // 'x'

  // Adjust Arrows
  adjustLeft: string; // '‹' vs '<'
  adjustRight: string; // '›' vs '>'
  arrowRight: string; // '──▶' vs '-->'
  arrowDown: string; // '▼' vs 'v'

  isAscii: boolean;
}

export const UNICODE_GLYPHS: GlyphSet = {
  bullet: '●',
  connector: '⎿',
  prompt: '>',
  shellPrompt: '!',

  spinnerFrames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  success: '✓',
  error: '✗',
  waiting: '…',
  thinking: '✻',
  ellipsis: '…',

  taskOpen: '☐',
  taskDone: '☒',
  focusCaret: '▸',
  scrollUp: '▲',
  scrollDown: '▼',
  scrollbarThumb: '┃',
  scrollbarTrack: '│',
  commentMarker: '▌',

  progressFill: '█',
  progressEmpty: '░',

  boxTopLeft: '╭',
  boxTopRight: '╮',
  boxBottomLeft: '╰',
  boxBottomRight: '╯',
  boxHorizontal: '─',
  boxVertical: '│',
  boxTeeLeft: '├',
  boxTeeRight: '┤',
  boxTeeTop: '┬',
  boxTeeBottom: '┴',
  boxCross: '┼',
  dashedDivider: '┄',
  hunkDivider: '···',

  doubleTopLeft: '╔',
  doubleTopRight: '╗',
  doubleBottomLeft: '╚',
  doubleBottomRight: '╝',
  doubleHorizontal: '═',
  doubleVertical: '║',

  noticeInfo: 'i',
  noticeWarn: '!',
  noticeError: 'x',

  adjustLeft: '‹',
  adjustRight: '›',
  arrowRight: '──▶',
  arrowDown: '▼',

  isAscii: false,
};

export const ASCII_GLYPHS: GlyphSet = {
  bullet: '*',
  connector: '\\_',
  prompt: '>',
  shellPrompt: '!',

  spinnerFrames: ['-', '\\', '|', '/'],
  success: '[ok]',
  error: '[x]',
  waiting: '...',
  thinking: '~',
  ellipsis: '...',

  taskOpen: '[ ]',
  taskDone: '[x]',
  focusCaret: '>',
  scrollUp: '^',
  scrollDown: 'v',
  scrollbarThumb: '|',
  scrollbarTrack: '|',
  commentMarker: '|',

  progressFill: '#',
  progressEmpty: '.',

  boxTopLeft: '+',
  boxTopRight: '+',
  boxBottomLeft: '+',
  boxBottomRight: '+',
  boxHorizontal: '-',
  boxVertical: '|',
  boxTeeLeft: '+',
  boxTeeRight: '+',
  boxTeeTop: '+',
  boxTeeBottom: '+',
  boxCross: '+',
  dashedDivider: '-',
  hunkDivider: '...',

  doubleTopLeft: '+',
  doubleTopRight: '+',
  doubleBottomLeft: '+',
  doubleBottomRight: '+',
  doubleHorizontal: '=',
  doubleVertical: '|',

  noticeInfo: 'i',
  noticeWarn: '!',
  noticeError: 'x',

  adjustLeft: '<',
  adjustRight: '>',
  arrowRight: '-->',
  arrowDown: 'v',

  isAscii: true,
};

export function getGlyphs(options?: { forceAscii?: boolean }): GlyphSet {
  if (options?.forceAscii) {
    return ASCII_GLYPHS;
  }

  // Check environment variables
  if (process.env[ENV_VARS.TENDRIL_ASCII_MODE] !== undefined && process.env[ENV_VARS.TENDRIL_ASCII_MODE] !== '0') {
    return ASCII_GLYPHS;
  }

  const caps = detectTerminalCapabilities();
  if (caps.asciiOnly) {
    return ASCII_GLYPHS;
  }

  return UNICODE_GLYPHS;
}
