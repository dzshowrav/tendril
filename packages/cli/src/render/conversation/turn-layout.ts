/**
 * Turn Formatting & Hanging Indent Pipeline.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 5).
 *
 * Enforces exact indentation rules:
 * - User: Col 0 `> `, hanging indent Col 2
 * - Assistant: Col 0 `● `, hanging indent Col 2
 * - Tool title: Col 0 `● Name(args)`
 * - Tool result: Col 2 `⎿  `, text at Col 5, hanging indent Col 5
 * - Thinking: Col 2 `✻ Thinking…`
 * - Code block / lists: Col 2
 * - 1 blank line between distinct blocks
 * - Max width: min(terminalWidth - 2, 100)
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { formatHangingIndent, visibleWidth } from '../../ui/layout-calc.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';

export class TurnLayout {
  private activeTheme: ActiveTheme;
  private glyphs: GlyphSet;

  constructor(theme?: ActiveTheme, glyphs?: GlyphSet) {
    this.activeTheme = theme || resolveActiveTheme();
    this.glyphs = glyphs || getGlyphs();
  }

  public setTheme(theme: ActiveTheme): void {
    this.activeTheme = theme;
  }

  public setGlyphs(glyphs: GlyphSet): void {
    this.glyphs = glyphs;
  }

  private getMaxWidth(terminalWidth?: number): number {
    const rawWidth = terminalWidth ?? (process.stdout.columns || 76);
    return Math.min(Math.max(30, rawWidth - 2), 100);
  }

  /**
   * Formats a User Turn:
   * Col 0: `> `
   * Continuation: Col 2 (hanging indent)
   */
  public formatUserTurn(text: string, terminalWidth?: number): string[] {
    const maxW = this.getMaxWidth(terminalWidth);
    const noColor = isNoColor();
    const promptPrefix = noColor
      ? `${this.glyphs.prompt} `
      : `${this.activeTheme.tokens.prompt.default(this.glyphs.prompt)} `;

    return formatHangingIndent(promptPrefix, text, 2, maxW);
  }

  /**
   * Formats an Assistant Turn:
   * Col 0: `● `
   * Continuation: Col 2 (hanging indent)
   */
  public formatAssistantTurn(text: string, terminalWidth?: number): string[] {
    const maxW = this.getMaxWidth(terminalWidth);
    const noColor = isNoColor();
    const bulletPrefix = noColor
      ? `${this.glyphs.bullet} `
      : `${this.activeTheme.tokens.status.info(this.glyphs.bullet)} `;

    return formatHangingIndent(bulletPrefix, text, 2, maxW);
  }

  /**
   * Formats a Thinking Block:
   * Col 2: `✻ Thinking…  (ctrl+o to expand)`
   */
  public formatThinking(summary: string = 'Thinking…', isExpanded = false, fullContent?: string): string[] {
    const noColor = isNoColor();
    const g = this.glyphs;
    const marker = noColor ? g.thinking : this.activeTheme.tokens.text.muted(g.thinking);
    const hint = isExpanded ? '(ctrl+o to collapse)' : '(ctrl+o to expand)';
    const hintColored = noColor ? hint : this.activeTheme.tokens.text.muted(hint);

    const lines: string[] = [`  ${marker} ${summary}  ${hintColored}`];

    if (isExpanded && fullContent) {
      const contentLines = fullContent.split('\n');
      for (const line of contentLines) {
        const coloredLine = noColor ? line : this.activeTheme.tokens.text.muted(line);
        lines.push(`    ${coloredLine}`);
      }
    }

    return lines;
  }

  /**
   * Formats a Tool Result line:
   * Col 2: `⎿  ` (connector + 2 spaces)
   * Col 5+: text and multi-line continuations
   */
  public formatToolResult(text: string, terminalWidth?: number): string[] {
    const maxW = this.getMaxWidth(terminalWidth);
    const noColor = isNoColor();
    const connPrefix = noColor
      ? `  ${this.glyphs.connector}  `
      : `  ${this.activeTheme.tokens.text.muted(this.glyphs.connector)}  `;

    return formatHangingIndent(connPrefix, text, 5, maxW);
  }

  /**
   * Formats a Code Block with left gutter:
   * Col 2: `│ ` gutter
   */
  public formatCodeBlock(code: string, language?: string): string[] {
    const noColor = isNoColor();
    const g = this.glyphs;
    const gutter = noColor ? g.boxVertical : this.activeTheme.tokens.border.muted(g.boxVertical);
    const lines = code.split('\n');
    const out: string[] = [];

    if (language) {
      const tag = noColor ? `[${language}]` : this.activeTheme.tokens.text.muted(`[${language}]`);
      out.push(`  ${gutter} ${tag}`);
    }

    for (const line of lines) {
      out.push(`  ${gutter} ${line}`);
    }

    return out;
  }
}
