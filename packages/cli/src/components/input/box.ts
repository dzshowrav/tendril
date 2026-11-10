/**
 * Upward Expanding Bordered Input Box Component.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 4).
 *
 * Implements:
 * - Fixed bottom border, expands upward (3 to 10 rows)
 * - Normal (>) vs Shell Escape (!) prompt toggle
 * - Mode accents for Normal, Shell, and Plan modes
 * - Dim placeholder for empty input
 * - Paste chips formatting: [pasted text <n> lines]
 * - Internal scrolling window when content exceeds 10 rows
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';
import { visibleWidth, truncateVisible, padLine, wrapLines } from '../../ui/layout-calc.js';

export interface PasteChip {
  id: string;
  lineCount: number;
}

export interface InputBoxProps {
  value: string;
  mode?: 'normal' | 'shell' | 'plan';
  placeholder?: string;
  chips?: PasteChip[];
  maxRows?: number; // default 10
  width?: number; // default 76
  cursorPos?: number;
}

export class VisualInputBox {
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

  public render(props: InputBoxProps): string[] {
    const width = props.width ?? (process.stdout.columns || 76);
    const boxW = Math.min(width, 76);
    const innerW = boxW - 2;
    const maxRows = props.maxRows ?? 10;
    const g = this.glyphs;
    const noColor = isNoColor();

    const mode = props.mode || 'normal';
    const isShell = mode === 'shell' || props.value.startsWith('!');

    // Prompt glyph & styling
    const promptGlyph = isShell ? g.shellPrompt : g.prompt;
    let borderCol = (s: string) => s;
    let promptCol = (s: string) => s;

    if (!noColor) {
      if (isShell) {
        borderCol = this.activeTheme.tokens.prompt.accent;
        promptCol = this.activeTheme.tokens.prompt.accent;
      } else if (mode === 'plan') {
        borderCol = this.activeTheme.tokens.status.waiting;
        promptCol = this.activeTheme.tokens.status.waiting;
      } else {
        borderCol = this.activeTheme.tokens.border.focus;
        promptCol = this.activeTheme.tokens.prompt.default;
      }
    }

    // Top and bottom borders
    const topBar = g.boxHorizontal.repeat(innerW);
    const botBar = g.boxHorizontal.repeat(innerW);
    const topBorder = borderCol(`${g.boxTopLeft}${topBar}${g.boxTopRight}`);
    const botBorder = borderCol(`${g.boxBottomLeft}${botBar}${g.boxBottomRight}`);
    const vert = borderCol(g.boxVertical);

    // Format content lines
    const text = isShell && props.value.startsWith('!') ? props.value.slice(1).trimStart() : props.value;
    const chipText = props.chips && props.chips.length > 0
      ? props.chips.map((c) => `[pasted text ${c.lineCount} lines]`).join(' ') + ' '
      : '';

    const contentLines: string[] = [];

    if (!text && !chipText) {
      // Empty input with placeholder
      const placeholder = props.placeholder || 'Ask anything   /  commands   @  files   !  shell';
      const promptStr = `${promptCol(promptGlyph)} `;
      const dimPlaceholder = noColor ? placeholder : this.activeTheme.tokens.text.muted(placeholder);
      const rowContent = ` ${promptStr}${dimPlaceholder}`;
      contentLines.push(rowContent);
    } else {
      const fullContent = chipText + text;
      // Wrap content to fit inside inner width (leaving 3 cols for prompt)
      const availWidth = innerW - 4;
      const wrapped = wrapLines(fullContent, availWidth);

      for (let i = 0; i < wrapped.length; i++) {
        if (i === 0) {
          const promptStr = `${promptCol(promptGlyph)} `;
          contentLines.push(` ${promptStr}${wrapped[i]}`);
        } else {
          // 2 space continuation indent
          contentLines.push(`   ${wrapped[i]}`);
        }
      }
    }

    // Apply 10-row maximum window with scrolling
    let visibleRows = contentLines;
    if (contentLines.length > maxRows) {
      // Show bottom `maxRows` lines (scrolled to bottom where typing happens)
      visibleRows = contentLines.slice(-maxRows);
    }

    // Assemble the bordered box
    const lines: string[] = [topBorder];
    for (const row of visibleRows) {
      const padded = padLine(row, innerW);
      lines.push(`${vert}${padded}${vert}`);
    }
    lines.push(botBorder);

    return lines;
  }
}
