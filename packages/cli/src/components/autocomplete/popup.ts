/**
 * Autocomplete Popup Component.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 10).
 *
 * Implements:
 * - Positioned strictly ABOVE the input box
 * - Bordered box with category title in top border
 * - Max 8 visible rows with scroll indicators (▲ <n> more / <n> more ↓)
 * - Selected row marked with `▸` caret (or `>` in ASCII)
 * - Fuzzy match character highlighting in command/file names
 * - Right-aligned dim descriptions
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';
import { visibleWidth, truncateVisible, padLine } from '../../ui/layout-calc.js';

export interface AutocompleteItem {
  name: string;
  description: string;
  type?: 'command' | 'file';
}

export interface AutocompletePopupProps {
  categoryTitle: string; // 'Commands' | 'Files'
  items: AutocompleteItem[];
  selectedIndex: number;
  query?: string;
  maxRows?: number; // default 8
  width?: number; // default 60 or terminal width
}

export class AutocompletePopup {
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
   * Highlights matching characters of query in item name.
   */
  public highlightMatch(name: string, query?: string): string {
    const noColor = isNoColor();
    if (noColor || !query || query.length === 0) {
      return name;
    }

    const cleanQuery = query.toLowerCase();
    const cleanName = name.toLowerCase();

    // Check prefix or substring
    const matchIdx = cleanName.indexOf(cleanQuery);
    if (matchIdx !== -1) {
      const before = name.slice(0, matchIdx);
      const match = name.slice(matchIdx, matchIdx + query.length);
      const after = name.slice(matchIdx + query.length);
      return `${before}${this.activeTheme.tokens.text.primary(match)}${after}`;
    }

    return name;
  }

  /**
   * Renders the Autocomplete popup box to be placed above the input box.
   */
  public render(props: AutocompletePopupProps): string[] {
    const totalItems = props.items.length;
    if (totalItems === 0) return [];

    const width = props.width ?? Math.min(process.stdout.columns || 76, 60);
    const innerW = width - 2;
    const maxRows = props.maxRows ?? 8;
    const g = this.glyphs;
    const noColor = isNoColor();

    const borderCol = noColor ? (s: string) => s : this.activeTheme.tokens.border.active;
    const vert = borderCol(g.boxVertical);

    // Calculate window range
    let startIdx = 0;
    const selIdx = Math.max(0, Math.min(totalItems - 1, props.selectedIndex));

    if (totalItems > maxRows) {
      const half = Math.floor(maxRows / 2);
      startIdx = Math.max(0, selIdx - half);
      if (startIdx + maxRows > totalItems) {
        startIdx = Math.max(0, totalItems - maxRows);
      }
    }
    const endIdx = Math.min(totalItems, startIdx + maxRows);
    const visibleItems = props.items.slice(startIdx, endIdx);

    // Top border with title: ╭─ Commands ──────────────╮
    const title = ` ${props.categoryTitle} `;
    const topFill = Math.max(2, innerW - visibleWidth(title) - 1);
    const topBar = g.boxHorizontal.repeat(topFill);
    const botBar = g.boxHorizontal.repeat(innerW);

    const lines: string[] = [
      borderCol(`${g.boxTopLeft}─${title}${topBar}${g.boxTopRight}`),
    ];

    // Scroll up indicator if needed
    if (startIdx > 0) {
      const upIndicator = `  ${g.scrollUp} ${startIdx} more above`;
      lines.push(`${vert}${padLine(noColor ? upIndicator : this.activeTheme.tokens.text.muted(upIndicator), innerW)}${vert}`);
    }

    // Rows
    for (let i = 0; i < visibleItems.length; i++) {
      const realIndex = startIdx + i;
      const isSelected = realIndex === selIdx;
      const item = visibleItems[i];

      const caret = isSelected
        ? (noColor ? `${g.focusCaret} ` : `${this.activeTheme.tokens.status.info(g.focusCaret)} `)
        : '  ';

      const highlightedName = this.highlightMatch(item.name, props.query);
      const nameW = visibleWidth(item.name);

      // Remaining space for description
      const availableDesc = innerW - nameW - 5;
      let descPart = '';
      if (availableDesc > 5 && item.description) {
        const descTruncated = truncateVisible(item.description, availableDesc);
        descPart = noColor ? descTruncated : this.activeTheme.tokens.text.muted(descTruncated);
      }

      const left = `${caret}${highlightedName}`;
      const gap = Math.max(2, innerW - visibleWidth(caret) - nameW - visibleWidth(item.description ? descPart : ''));
      const fullRow = `${left}${' '.repeat(gap)}${descPart}`;

      lines.push(`${vert}${padLine(fullRow, innerW)}${vert}`);
    }

    // Scroll down indicator if needed
    if (endIdx < totalItems) {
      const remaining = totalItems - endIdx;
      const downIndicator = `${remaining} more   ${g.scrollDown}  `;
      lines.push(`${vert}${padLine(noColor ? downIndicator : this.activeTheme.tokens.text.muted(downIndicator), innerW, 'right')}${vert}`);
    }

    lines.push(borderCol(`${g.boxBottomLeft}${botBar}${g.boxBottomRight}`));

    return lines;
  }
}
