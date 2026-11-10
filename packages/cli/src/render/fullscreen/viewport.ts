/**
 * Fullscreen Scrollable Viewport & Scrollbar Component.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 20).
 *
 * Implements:
 * - Alternate screen buffer switching (ESC[?1049h / ESC[?1049l)
 * - Right-edge scrollbar track and thumb (┃ thumb, │ track)
 * - "▼ <n> new lines (end to jump)" arrival indicator
 * - Viewport line slicing and scrolling offsets
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';
import { visibleWidth, truncateVisible, padLine } from '../../ui/layout-calc.js';

export interface ViewportProps {
  title: string;
  totalLines: string[];
  viewportHeight: number;
  scrollOffset: number; // 0 = at top; totalLines.length - viewportHeight = at bottom
  unreadLinesCount?: number;
  width?: number; // default 76
}

export class FullscreenViewport {
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

  public enterAlternateScreen(): string {
    return '\x1B[?1049h\x1B[H';
  }

  public leaveAlternateScreen(): string {
    return '\x1B[?1049l';
  }

  /**
   * Computes which rows have scrollbar thumb vs track.
   */
  public computeScrollbar(visibleRows: number, totalRows: number, scrollOffset: number): string[] {
    const g = this.glyphs;
    if (totalRows <= visibleRows) {
      return Array(visibleRows).fill(' ');
    }

    const thumbRatio = Math.max(0.1, visibleRows / totalRows);
    const thumbHeight = Math.max(1, Math.round(visibleRows * thumbRatio));
    const maxOffset = totalRows - visibleRows;
    const progress = Math.max(0, Math.min(1, scrollOffset / maxOffset));
    const thumbStart = Math.min(visibleRows - thumbHeight, Math.round((visibleRows - thumbHeight) * progress));

    const scrollbar: string[] = [];
    for (let i = 0; i < visibleRows; i++) {
      if (i === 0 && scrollOffset > 0) {
        scrollbar.push(g.scrollUp);
      } else if (i === visibleRows - 1 && scrollOffset < maxOffset) {
        scrollbar.push(g.scrollDown);
      } else if (i >= thumbStart && i < thumbStart + thumbHeight) {
        scrollbar.push(g.scrollbarThumb);
      } else {
        scrollbar.push(g.scrollbarTrack);
      }
    }

    return scrollbar;
  }

  /**
   * Renders the complete Fullscreen Viewport frame with right scrollbar.
   */
  public render(props: ViewportProps): string[] {
    const width = props.width ?? (process.stdout.columns || 76);
    const boxW = Math.min(width, 76);
    const innerW = boxW - 2;
    const g = this.glyphs;
    const noColor = isNoColor();

    const borderCol = noColor ? (s: string) => s : this.activeTheme.tokens.border.active;
    const vert = borderCol(g.boxVertical);

    // Header border: ╭─ fullscreen · <session-title> ──╮
    const titleText = ` fullscreen · ${props.title} `;
    const topFill = Math.max(2, innerW - visibleWidth(titleText) - 1);
    const topBar = g.boxHorizontal.repeat(topFill);
    const topBorder = borderCol(`${g.boxTopLeft}─${titleText}${topBar}${g.boxTopRight}`);

    const contentWidth = innerW - 2; // 1 space margin + 1 col scrollbar
    const totalCount = props.totalLines.length;
    const vHeight = props.viewportHeight;

    const maxScroll = Math.max(0, totalCount - vHeight);
    const offset = Math.max(0, Math.min(maxScroll, props.scrollOffset));

    const slice = props.totalLines.slice(offset, offset + vHeight);
    while (slice.length < vHeight) {
      slice.push('');
    }

    const scrollbar = this.computeScrollbar(vHeight, totalCount, offset);
    const lines: string[] = [topBorder];

    for (let i = 0; i < vHeight; i++) {
      const lineText = truncateVisible(slice[i], contentWidth);
      const paddedContent = padLine(` ${lineText}`, contentWidth + 1);
      const sbChar = scrollbar[i] || ' ';
      const coloredSb = noColor ? sbChar : this.activeTheme.tokens.text.muted(sbChar);

      lines.push(`${vert}${paddedContent}${coloredSb}${vert}`);
    }

    // New lines arrival indicator if user is scrolled up
    if (props.unreadLinesCount && props.unreadLinesCount > 0 && offset < maxScroll) {
      const indicator = ` ${g.scrollDown} ${props.unreadLinesCount} new lines  (end to jump)`;
      const coloredInd = noColor ? indicator : this.activeTheme.tokens.status.info(indicator);
      lines.push(`${vert}${padLine(coloredInd, innerW, 'right')}${vert}`);
    }

    // Dashed divider separating viewport from fixed bottom input/footer
    const dashedBar = g.dashedDivider.repeat(innerW);
    lines.push(borderCol(`${g.boxTeeLeft}${dashedBar}${g.boxTeeRight}`));

    return lines;
  }
}
