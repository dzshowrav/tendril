/**
 * Screen Zones Stack & Frame Buffer Orchestrator.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 2, § 3).
 *
 * Coordinates the 6 vertical zones:
 * A: BANNER (printed once into scrollback)
 * B: CONVERSATION (append-only into scrollback)
 * C: LIVE REGION (in-place redrawn)
 * D: APPROVAL BAR (above/replaces input box)
 * E: INPUT BOX (fixed bottom, expands upward)
 * F: FOOTER (1 row: hint + status)
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { visibleWidth, truncateVisible, padLine } from '../../ui/layout-calc.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';

export interface BannerProps {
  version: string;
  model: string;
  cwd: string;
  permissionMode: string;
  accountLabel?: string;
  width?: number;
}

export interface LiveFrame {
  zoneC?: string[]; // Live Region lines (spinner, tasks, queued)
  zoneD?: string[]; // Approval Bar lines
  zoneE?: string[]; // Input Box lines
  zoneF?: string;   // Footer 1-row string
}

export class ScreenOrchestrator {
  private lastRenderedLineCount = 0;
  private activeTheme: ActiveTheme;
  private glyphs: GlyphSet;

  constructor(
    private writeOut: (text: string) => void = (t) => process.stdout.write(t),
    theme?: ActiveTheme
  ) {
    this.activeTheme = theme || resolveActiveTheme();
    this.glyphs = getGlyphs();
  }

  public setTheme(theme: ActiveTheme): void {
    this.activeTheme = theme;
  }

  public setGlyphs(glyphs: GlyphSet): void {
    this.glyphs = glyphs;
  }

  /**
   * Zone A: Renders Welcome Banner according to § 3.1 (>= 70 cols) or § 3.2 (< 50 cols).
   * Printed once into scrollback.
   */
  public renderBanner(props: BannerProps): string {
    const width = props.width ?? (process.stdout.columns || 76);
    const g = this.glyphs;
    const noColor = isNoColor();
    const borderCol = noColor ? (s: string) => s : this.activeTheme.tokens.border.active;
    const titleCol = noColor ? (s: string) => s : this.activeTheme.tokens.text.primary;
    const mutedCol = noColor ? (s: string) => s : this.activeTheme.tokens.text.muted;

    // Compact layout for narrow terminals (< 50 cols) - § 3.2
    if (width < 50) {
      const boxW = Math.max(30, width - 2);
      const innerW = boxW - 2;
      const title = ` Agent Harness v${props.version} `;
      const topFill = Math.max(1, innerW - visibleWidth(title) - 1);
      const topBar = g.boxHorizontal.repeat(topFill);
      const botBar = g.boxHorizontal.repeat(innerW);

      const l1 = truncateVisible(` ${props.model}`, innerW);
      const l2 = truncateVisible(` ${props.cwd}`, innerW);
      const l3 = truncateVisible(' /help   @file   !shell', innerW);

      return [
        borderCol(`${g.boxTopLeft}─${titleCol(title)}${topBar}${g.boxTopRight}`),
        borderCol(g.boxVertical) + padLine(mutedCol(l1), innerW) + borderCol(g.boxVertical),
        borderCol(g.boxVertical) + padLine(mutedCol(l2), innerW) + borderCol(g.boxVertical),
        borderCol(g.boxVertical) + padLine(mutedCol(l3), innerW) + borderCol(g.boxVertical),
        borderCol(`${g.boxBottomLeft}${botBar}${g.boxBottomRight}`),
      ].join('\n');
    }

    // Full 76-column layout - § 3.1
    const boxW = Math.min(width, 76);
    const innerW = boxW - 2;

    const title = ` Agent Harness v${props.version} `;
    const topFill = Math.max(2, innerW - visibleWidth(title) - 1);
    const topBar = g.boxHorizontal.repeat(topFill);
    const botBar = g.boxHorizontal.repeat(innerW);

    const padRow = (leftText: string, rightText: string = ''): string => {
      const leftW = visibleWidth(leftText);
      const rightW = visibleWidth(rightText);
      const gap = Math.max(2, innerW - leftW - rightW);
      const full = leftText + ' '.repeat(gap) + rightText;
      return borderCol(g.boxVertical) + padLine(full, innerW) + borderCol(g.boxVertical);
    };

    const emptyRow = borderCol(g.boxVertical) + ' '.repeat(innerW) + borderCol(g.boxVertical);

    const row1Left = `   ${props.model}`;
    const row1Right = `cwd   ${props.cwd}   `;
    const row2Left = `   ${props.accountLabel || ''}`;
    const row2Right = `mode  ${props.permissionMode}   `;
    const row3 = '   /help  commands     @  file reference     !  shell     ctrl+c  exit';

    const lines: string[] = [
      borderCol(`${g.boxTopLeft}─${titleCol(title)}${topBar}${g.boxTopRight}`),
      emptyRow,
      padRow(titleCol(row1Left), mutedCol(row1Right)),
      padRow(mutedCol(row2Left), mutedCol(row2Right)),
      emptyRow,
      borderCol(g.boxVertical) + padLine(mutedCol(row3), innerW) + borderCol(g.boxVertical),
      emptyRow,
      borderCol(`${g.boxBottomLeft}${botBar}${g.boxBottomRight}`),
    ];

    return lines.join('\n');
  }

  /**
   * Zone B: Append lines directly into terminal scrollback.
   * If there is an active Live Region on screen, it is first cleanly erased,
   * the history lines are printed, and then the Live Region is redrawn below.
   */
  public appendHistory(lines: string[]): void {
    this.clearLiveRegion();
    for (const line of lines) {
      this.writeOut(line + '\n');
    }
  }

  /**
   * Cleanly erases the currently displayed Live Region (Zones C-F)
   * so no artifacts linger in scrollback.
   */
  public clearLiveRegion(): void {
    if (this.lastRenderedLineCount > 0) {
      // Move cursor up N lines and clear from cursor to screen end
      this.writeOut(`\x1B[${this.lastRenderedLineCount}A\r\x1B[J`);
      this.lastRenderedLineCount = 0;
    }
  }

  /**
   * Renders a frame of the Live Region (Zones C, D, E, F).
   * Overwrites previous live frame cleanly in place.
   */
  public renderLiveFrame(frame: LiveFrame): void {
    const lines: string[] = [];

    if (frame.zoneC && frame.zoneC.length > 0) {
      lines.push(...frame.zoneC);
    }
    if (frame.zoneD && frame.zoneD.length > 0) {
      lines.push(...frame.zoneD);
    }
    if (frame.zoneE && frame.zoneE.length > 0) {
      lines.push(...frame.zoneE);
    }
    if (frame.zoneF !== undefined && frame.zoneF.length > 0) {
      lines.push(frame.zoneF);
    }

    if (lines.length === 0) {
      this.clearLiveRegion();
      return;
    }

    // Atomic redraw: erase previous frame and render new frame in a single write
    let output = '';
    if (this.lastRenderedLineCount > 0) {
      output += `\x1B[${this.lastRenderedLineCount}A\r\x1B[J`;
    }

    output += lines.join('\n') + '\n';
    this.writeOut(output);
    this.lastRenderedLineCount = lines.length;
  }

  public getLastLineCount(): number {
    return this.lastRenderedLineCount;
  }
}
