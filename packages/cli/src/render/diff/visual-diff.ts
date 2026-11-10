/**
 * Visual Diff Syntax Formatter.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 8).
 *
 * Implements:
 * - Line numbers right-aligned with gutter `│`
 * - Clear `+` / `-` prefixes (mandatory for NO_COLOR safety)
 * - Semantic colors (diff.addition, diff.removal, text.muted for context)
 * - Hunk separators `···` (or `...` in ASCII)
 * - Intra-line token diffing for replaced lines
 * - Clean width truncation
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';
import { visibleWidth, truncateVisible } from '../../ui/layout-calc.js';

export interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'hunk_break';
  oldLineNumber?: number;
  newLineNumber?: number;
  text: string;
}

export interface DiffHunk {
  header?: string;
  lines: DiffLine[];
}

export interface DiffFileSummary {
  filePath: string;
  additions: number;
  removals: number;
  hunks: DiffHunk[];
}

export class VisualDiffFormatter {
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

  /**
   * Computes intra-line diff highlights between an old string and a new string.
   */
  public computeIntraLineDiff(oldText: string, newText: string): { oldFormatted: string; newFormatted: string } {
    const noColor = isNoColor();
    if (noColor || oldText === newText) {
      return { oldFormatted: oldText, newFormatted: newText };
    }

    // Find common prefix length
    let prefixLen = 0;
    while (
      prefixLen < oldText.length &&
      prefixLen < newText.length &&
      oldText[prefixLen] === newText[prefixLen]
    ) {
      prefixLen++;
    }

    // Find common suffix length
    let oldSuffixIndex = oldText.length - 1;
    let newSuffixIndex = newText.length - 1;
    while (
      oldSuffixIndex >= prefixLen &&
      newSuffixIndex >= prefixLen &&
      oldText[oldSuffixIndex] === newText[newSuffixIndex]
    ) {
      oldSuffixIndex--;
      newSuffixIndex--;
    }

    const commonPrefix = oldText.slice(0, prefixLen);
    const oldDiff = oldText.slice(prefixLen, oldSuffixIndex + 1);
    const newDiff = newText.slice(prefixLen, newSuffixIndex + 1);
    const commonSuffix = oldText.slice(oldSuffixIndex + 1);

    const oldFormatted = `${this.activeTheme.tokens.diff.removal(commonPrefix)}${this.activeTheme.tokens.text.primary(oldDiff)}${this.activeTheme.tokens.diff.removal(commonSuffix)}`;
    const newFormatted = `${this.activeTheme.tokens.diff.addition(commonPrefix)}${this.activeTheme.tokens.text.primary(newDiff)}${this.activeTheme.tokens.diff.addition(commonSuffix)}`;

    return { oldFormatted, newFormatted };
  }

  /**
   * Renders the complete diff block with gutter, signs, and hunk dividers.
   */
  public renderDiff(summary: DiffFileSummary, maxWidth = 76): string[] {
    const noColor = isNoColor();
    const g = this.glyphs;
    const gutterSymbol = g.boxVertical;
    const linesOut: string[] = [];

    // Header summary: "Updated <path> with <a> additions and <r> removals"
    const addWord = `${summary.additions} addition${summary.additions === 1 ? '' : 's'}`;
    const remWord = `${summary.removals} removal${summary.removals === 1 ? '' : 's'}`;
    const summaryText = `Updated ${summary.filePath} with ${addWord} and ${remWord}`;
    linesOut.push(`  ${g.connector}  ${summaryText}`);

    // Calculate maximum line number for fixed-width gutter
    let maxLineNum = 1;
    for (const hunk of summary.hunks) {
      for (const line of hunk.lines) {
        if (line.oldLineNumber && line.oldLineNumber > maxLineNum) maxLineNum = line.oldLineNumber;
        if (line.newLineNumber && line.newLineNumber > maxLineNum) maxLineNum = line.newLineNumber;
      }
    }

    const numWidth = Math.max(3, String(maxLineNum).length);
    const gutterPrefix = ' '.repeat(numWidth) + ` ${gutterSymbol} `;
    const contentWidth = Math.max(20, maxWidth - numWidth - 5);

    for (let hIdx = 0; hIdx < summary.hunks.length; hIdx++) {
      if (hIdx > 0) {
        // Hunk divider: ···
        const hunkDiv = `${' '.repeat(numWidth)} ${g.hunkDivider}`;
        linesOut.push(noColor ? hunkDiv : this.activeTheme.tokens.text.muted(hunkDiv));
      }

      const hunk = summary.hunks[hIdx];
      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i];

        if (line.type === 'hunk_break') {
          const hunkDiv = `${' '.repeat(numWidth)} ${g.hunkDivider}`;
          linesOut.push(noColor ? hunkDiv : this.activeTheme.tokens.text.muted(hunkDiv));
          continue;
        }

        const lineNum = line.newLineNumber ?? line.oldLineNumber ?? 0;
        const lineNumStr = lineNum > 0 ? String(lineNum).padStart(numWidth, ' ') : ' '.repeat(numWidth);
        const gutter = noColor ? gutterSymbol : this.activeTheme.tokens.border.muted(gutterSymbol);

        if (line.type === 'remove') {
          // Check if followed by an 'add' line for intra-line highlighting
          const next = hunk.lines[i + 1];
          let formattedText = line.text;
          if (next && next.type === 'add') {
            const pair = this.computeIntraLineDiff(line.text, next.text);
            formattedText = pair.oldFormatted;
          } else {
            formattedText = noColor ? line.text : this.activeTheme.tokens.diff.removal(line.text);
          }

          const prefix = noColor ? '-' : this.activeTheme.tokens.diff.removal('-');
          const truncated = truncateVisible(formattedText, contentWidth - 1);
          linesOut.push(`       ${lineNumStr} ${gutter} ${prefix}${truncated}`);
        } else if (line.type === 'add') {
          // Check if preceded by a 'remove' line for intra-line highlighting
          const prev = hunk.lines[i - 1];
          let formattedText = line.text;
          if (prev && prev.type === 'remove') {
            const pair = this.computeIntraLineDiff(prev.text, line.text);
            formattedText = pair.newFormatted;
          } else {
            formattedText = noColor ? line.text : this.activeTheme.tokens.diff.addition(line.text);
          }

          const prefix = noColor ? '+' : this.activeTheme.tokens.diff.addition('+');
          const truncated = truncateVisible(formattedText, contentWidth - 1);
          linesOut.push(`       ${lineNumStr} ${gutter} ${prefix}${truncated}`);
        } else {
          // Context line
          const contextText = noColor ? line.text : this.activeTheme.tokens.text.muted(line.text);
          const truncated = truncateVisible(contextText, contentWidth - 1);
          linesOut.push(`       ${lineNumStr} ${gutter}  ${truncated}`);
        }
      }
    }

    return linesOut;
  }
}
