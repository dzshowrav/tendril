import { ColorFormatters, ThemeSymbols } from './tokens.js';

export const safeSymbols: ThemeSymbols = {
  success: '[OK]',
  error: '[ERR]',
  waiting: '[WAIT]',
  running: '[RUN]',
  prompt: '>',
  shield: '[!]',
  boxTopLeft: '+',
  boxTopRight: '+',
  boxBottomLeft: '+',
  boxBottomRight: '+',
  boxHorizontal: '-',
  boxVertical: '|',
  boxDividerLeft: '+',
  boxDividerRight: '+',
};

// Safe theme: pure text identity functions without ANSI sequences if NO_COLOR, or basic standard ANSI
export const safeTheme: ColorFormatters = {
  textPrimary: (s) => s,
  textMuted: (s) => s,
  textError: (s) => `! ${s}`,
  textSuccess: (s) => `* ${s}`,
  textWarning: (s) => `? ${s}`,
  textAccent: (s) => s,

  surfaceDefault: (s) => s,
  surfaceRaised: (s) => s,
  borderDefault: (s) => s,
  borderFocus: (s) => s,

  promptAccent: (s) => s,
  responseAccent: (s) => s,

  statusSuccess: (s) => s,
  statusError: (s) => s,
  statusWaiting: (s) => s,
  statusRunning: (s) => s,

  diagramFunction: (s) => s,
  diagramClass: (s) => s,
  diagramFile: (s) => s,
  diagramDirectory: (s) => s,
  diagramExternal: (s) => s,
  diagramFocal: (s) => s,

  codeKeyword: (s) => s,
  codeString: (s) => s,
  codeNumber: (s) => s,
  codeComment: (s) => s,
  codePunctuation: (s) => s,

  bold: (s) => s,
  italic: (s) => s,
  dim: (s) => s,
};
