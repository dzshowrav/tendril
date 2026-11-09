import pc from 'picocolors';

export interface ThemeSymbols {
  prompt: string;
  continuation: string;
  bullet: string;
  tool: string;
  arrow: string;
  check: string;
  cross: string;
  warning: string;
  gutter: string;
  dot: string;
  question: string;
}

const UTF8_SYMBOLS: ThemeSymbols = {
  prompt: '›',
  continuation: '…',
  bullet: '•',
  tool: '▸',
  arrow: '↳',
  check: '✔',
  cross: '✖',
  warning: '!',
  gutter: '│',
  dot: '·',
  question: '?',
};

const ASCII_SYMBOLS: ThemeSymbols = {
  prompt: '>',
  continuation: '...',
  bullet: '*',
  tool: '>',
  arrow: '->',
  check: '[OK]',
  cross: '[X]',
  warning: '[!]',
  gutter: '|',
  dot: '-',
  question: '?',
};

export function isAsciiMode(): boolean {
  return (
    process.env.TENDRIL_ASCII === '1' ||
    Boolean(process.env.NO_UNICODE) ||
    Boolean(process.env.LANG && !process.env.LANG.toLowerCase().includes('utf'))
  );
}

export function isNoColor(): boolean {
  return Boolean(process.env.NO_COLOR) || !process.stdout.isTTY;
}

export function getSymbols(): ThemeSymbols {
  return isAsciiMode() ? ASCII_SYMBOLS : UTF8_SYMBOLS;
}

export const theme = {
  // Brand colors per Design Brief
  primary: (text: string) => (isNoColor() ? text : pc.green(text)),
  secondary: (text: string) => (isNoColor() ? text : pc.blue(text)),
  warning: (text: string) => (isNoColor() ? text : pc.yellow(text)),
  error: (text: string) => (isNoColor() ? text : pc.red(text)),
  muted: (text: string) => (isNoColor() ? text : pc.dim(text)),
  bold: (text: string) => (isNoColor() ? text : pc.bold(text)),
  cyan: (text: string) => (isNoColor() ? text : pc.cyan(text)),

  // Mode badge colors
  mode: (mode: string) => {
    if (isNoColor()) return mode;
    switch (mode) {
      case 'plan':
        return pc.blue(mode);
      case 'ask':
        return pc.white(mode);
      case 'auto-edit':
        return pc.yellow(mode);
      case 'yolo':
        return pc.red(pc.bold(mode));
      default:
        return mode;
    }
  },

  // CLI component formatters
  header: (workspaceTail: string, mode: string, model: string) => {
    const s = getSymbols();
    const dots = theme.muted(` ${s.dot} `);
    const prefix = theme.muted('tendril');
    const ws = theme.muted(workspaceTail);
    const m = theme.mode(mode);
    const mdl = theme.muted(model);
    return `${prefix}${dots}${ws}${dots}${m}${dots}${mdl}`;
  },

  success: (msg: string) => {
    const s = getSymbols();
    return `${theme.primary(s.check)} ${msg}`;
  },

  fail: (msg: string) => {
    const s = getSymbols();
    return `${theme.error(s.cross)} ${msg}`;
  },

  warn: (msg: string) => {
    const s = getSymbols();
    return `${theme.warning(s.warning)} ${msg}`;
  },
};
