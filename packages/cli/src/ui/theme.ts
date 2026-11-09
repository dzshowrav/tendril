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
  boxTopLeft: string;
  boxTopRight: string;
  boxBottomLeft: string;
  boxBottomRight: string;
  boxHorizontal: string;
  boxVertical: string;
  boxDividerLeft: string;
  boxDividerRight: string;
  sparkle: string;
  gear: string;
  shield: string;
  folder: string;
  zap: string;
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
  boxTopLeft: '╭',
  boxTopRight: '╮',
  boxBottomLeft: '╰',
  boxBottomRight: '╯',
  boxHorizontal: '─',
  boxVertical: '│',
  boxDividerLeft: '├',
  boxDividerRight: '┤',
  sparkle: '✨',
  gear: '⚙',
  shield: '🛡️',
  folder: '📂',
  zap: '⚡',
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
  boxTopLeft: '+',
  boxTopRight: '+',
  boxBottomLeft: '+',
  boxBottomRight: '+',
  boxHorizontal: '-',
  boxVertical: '|',
  boxDividerLeft: '+',
  boxDividerRight: '+',
  sparkle: '*',
  gear: '*',
  shield: '[SEC]',
  folder: '[DIR]',
  zap: '>',
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

export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
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

  banner: (opts: {
    version: string;
    workspace: string;
    gitBranch?: string;
    model: string;
    mode: string;
    port: number;
  }) => {
    const s = getSymbols();
    const width = Math.max(48, Math.min(process.stdout.columns || 80, 68));
    const innerW = width - 4;

    const title = ` Tendril v${opts.version} `;
    const topFill = Math.max(2, innerW - title.length - 1);
    const topBar = s.boxHorizontal.repeat(topFill);
    const botBar = s.boxHorizontal.repeat(innerW);

    const pad = (content: string) => {
      const vLen = stripAnsi(content).length;
      return content + ' '.repeat(Math.max(0, innerW - vLen));
    };

    const branch = opts.gitBranch ? ` ${theme.muted(`(${opts.gitBranch})`)}` : '';
    const line1 = `  ${s.folder}  ${theme.bold('Workspace')}:  ${opts.workspace}${branch}`;
    const line2 = `  ${s.sparkle}  ${theme.bold('Model')}:      ${opts.model}`;
    const line3 = `  ${s.shield}  ${theme.bold('Mode')}:       ${theme.mode(opts.mode)}`;
    const line4 = `  🌐  ${theme.bold('Web UI')}:     ${theme.cyan(`http://127.0.0.1:${opts.port}`)}`;

    const border = (str: string) => theme.primary(str);

    return [
      border(`${s.boxTopLeft}─${title}${topBar}${s.boxTopRight}`),
      `${border(s.boxVertical)} ${pad(line1)} ${border(s.boxVertical)}`,
      `${border(s.boxVertical)} ${pad(line2)} ${border(s.boxVertical)}`,
      `${border(s.boxVertical)} ${pad(line3)} ${border(s.boxVertical)}`,
      `${border(s.boxVertical)} ${pad(line4)} ${border(s.boxVertical)}`,
      border(`${s.boxBottomLeft}${botBar}${s.boxBottomRight}`),
      theme.muted('Type /help for commands · Ctrl+C to abort · Ctrl+D to exit\n'),
    ].join('\n');
  },

  permissionCard: (opts: { tool: string; target: string; reason?: string }) => {
    const s = getSymbols();
    const width = Math.max(48, Math.min(process.stdout.columns || 80, 66));
    const innerW = width - 4;

    const title = ` ${s.shield} Permission Required `;
    const topFill = Math.max(2, innerW - title.length - 1);
    const topBar = s.boxHorizontal.repeat(topFill);
    const divBar = s.boxHorizontal.repeat(innerW);
    const botBar = s.boxHorizontal.repeat(innerW);

    const pad = (content: string) => {
      const vLen = stripAnsi(content).length;
      return content + ' '.repeat(Math.max(0, innerW - vLen));
    };

    const line1 = `  Tool:   ${theme.secondary(opts.tool)}`;
    const line2 = `  Target: ${theme.bold(opts.target)}`;
    const line3 = opts.reason ? `  Reason: ${theme.muted(opts.reason)}` : '';
    const actions = `  ${theme.primary('[y]')} Once  ${theme.secondary('[a]')} Always  ${theme.error('[n]')} Deny  ${theme.warning('[d]')} Diff`;

    const border = (str: string) => theme.warning(str);

    const out = [
      border(`\n${s.boxTopLeft}─${title}${topBar}${s.boxTopRight}`),
      `${border(s.boxVertical)} ${pad(line1)} ${border(s.boxVertical)}`,
      `${border(s.boxVertical)} ${pad(line2)} ${border(s.boxVertical)}`,
    ];
    if (line3) {
      out.push(`${border(s.boxVertical)} ${pad(line3)} ${border(s.boxVertical)}`);
    }
    out.push(border(`${s.boxDividerLeft}${divBar}${s.boxDividerRight}`));
    out.push(`${border(s.boxVertical)} ${pad(actions)} ${border(s.boxVertical)}`);
    out.push(border(`${s.boxBottomLeft}${botBar}${s.boxBottomRight}`));
    out.push(theme.warning(`Decision ${s.prompt} `));

    return out.join('\n');
  },

  helpMenu: () => {
    const out: string[] = [];
    out.push(theme.bold('\nAvailable Slash Commands:'));

    out.push(theme.cyan('\n  Session & Navigation:'));
    out.push(`    /new                    ${theme.muted('Start a fresh session in the same folder')}`);
    out.push(`    /sessions               ${theme.muted('List all active and past sessions')}`);
    out.push(`    /resume <id>            ${theme.muted('Switch to an existing session by ID')}`);
    out.push(`    /clear                  ${theme.muted('Clear screen and re-render header')}`);
    out.push(`    /exit                   ${theme.muted('Exit REPL (session is saved on daemon)')}`);

    out.push(theme.cyan('\n  Agent & Model Controls:'));
    out.push(`    /model <name>           ${theme.muted('Change model for this session')}`);
    out.push(`    /mode <plan|ask|auto-edit|yolo> ${theme.muted('Change execution permission mode')}`);
    out.push(`    /undo [--force]         ${theme.muted('Revert the last file change')}`);
    out.push(`    /diff                   ${theme.muted('Inspect latest file modification diff')}`);
    out.push(`    /compact                ${theme.muted('Summarize and compact session history')}`);

    out.push(theme.cyan('\n  Integrations & Rules:'));
    out.push(`    /ui                     ${theme.muted('Open React Web UI in phone browser')}`);
    out.push(`    /rules                  ${theme.muted('View and manage saved permissions')}`);
    out.push(`    /help                   ${theme.muted('Display this command guide\n')}`);

    return out.join('\n');
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
