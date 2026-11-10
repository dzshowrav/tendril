import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';

export interface ThinkingBlockOptions {
  showThinking?: boolean;
  maxTailLines?: number;
  theme?: ActiveTheme;
}

/**
 * Thinking (Reasoning) trace stream component with collapsible tail view.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 6.6).
 */
export class ThinkingBlock {
  private lines: string[] = [];
  private isExpanded = false;
  private showThinking: boolean;
  private maxTailLines: number;
  private theme: ActiveTheme;

  constructor(options?: ThinkingBlockOptions) {
    this.showThinking = options?.showThinking ?? true;
    this.maxTailLines = options?.maxTailLines ?? 4;
    this.theme = options?.theme || resolveActiveTheme();
  }

  public append(chunk: string): void {
    if (!this.showThinking) return;
    const incomingLines = chunk.split('\n');
    for (const l of incomingLines) {
      if (l.trim()) {
        this.lines.push(l);
      }
    }
  }

  public toggleExpand(): void {
    this.isExpanded = !this.isExpanded;
  }

  public clear(): void {
    this.lines = [];
    this.isExpanded = false;
  }

  public render(): string {
    if (!this.showThinking || this.lines.length === 0) {
      return '';
    }

    const { colors, symbols } = this.theme;
    const header = `  ${colors.textMuted(`${symbols.boxTopLeft}─ Thinking trace (${this.lines.length} lines) ─`)}`;
    const footer = `  ${colors.textMuted(`${symbols.boxBottomLeft}──────────────────────────────`)}`;

    if (this.isExpanded || this.lines.length <= this.maxTailLines) {
      const body = this.lines.map((l) => `  ${colors.textMuted('│')} ${colors.textMuted(l)}`).join('\n');
      return `${header}\n${body}\n${footer}\n`;
    }

    // Collapsed tail view
    const omitted = this.lines.length - this.maxTailLines;
    const tail = this.lines.slice(-this.maxTailLines);
    const omittedNote = `  ${colors.textMuted('│')} ${colors.borderFocus(`┄ [${omitted} lines collapsed · Ctrl+O to expand] ┄`)}`;
    const tailLines = tail.map((l) => `  ${colors.textMuted('│')} ${colors.textMuted(l)}`).join('\n');

    return `${header}\n${omittedNote}\n${tailLines}\n${footer}\n`;
  }
}
