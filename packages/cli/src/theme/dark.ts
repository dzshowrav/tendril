import pc from 'picocolors';
import { ColorFormatters, ThemeSymbols } from './tokens.js';

export const darkSymbols: ThemeSymbols = {
  success: '✔',
  error: '✖',
  waiting: '⏳',
  running: '⚙',
  prompt: '›',
  shield: '🛡',
  boxTopLeft: '╭',
  boxTopRight: '╮',
  boxBottomLeft: '╰',
  boxBottomRight: '╯',
  boxHorizontal: '─',
  boxVertical: '│',
  boxDividerLeft: '├',
  boxDividerRight: '┤',
};

export const darkTheme: ColorFormatters = {
  // Text
  textPrimary: (s) => pc.white(s),
  textMuted: (s) => pc.dim(s),
  textError: (s) => pc.red(s),
  textSuccess: (s) => pc.green(s),
  textWarning: (s) => pc.yellow(s),
  textAccent: (s) => pc.cyan(s),

  // Surface & Borders
  surfaceDefault: (s) => s,
  surfaceRaised: (s) => pc.bgBlack(s),
  borderDefault: (s) => pc.dim(s),
  borderFocus: (s) => pc.cyan(s),

  // Prompt & Response
  promptAccent: (s) => pc.magenta(s),
  responseAccent: (s) => pc.white(s),

  // Status
  statusSuccess: (s) => pc.green(s),
  statusError: (s) => pc.red(s),
  statusWaiting: (s) => pc.yellow(s),
  statusRunning: (s) => pc.cyan(s),

  // Diagram classes
  diagramFunction: (s) => pc.cyan(s),
  diagramClass: (s) => pc.magenta(s),
  diagramFile: (s) => pc.blue(s),
  diagramDirectory: (s) => pc.yellow(s),
  diagramExternal: (s) => pc.dim(s),
  diagramFocal: (s) => pc.bold(pc.green(s)),

  // Code
  codeKeyword: (s) => pc.magenta(s),
  codeString: (s) => pc.green(s),
  codeNumber: (s) => pc.yellow(s),
  codeComment: (s) => pc.dim(s),
  codePunctuation: (s) => pc.dim(s),

  // Styles
  bold: (s) => pc.bold(s),
  italic: (s) => pc.italic(s),
  dim: (s) => pc.dim(s),
};
