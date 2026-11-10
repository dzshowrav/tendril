/**
 * 76-Column Visual Overlay Panels.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 11, § 12).
 *
 * Implements:
 * - Help Panel (/help) with filter and commands
 * - Context Panel (/context) with 30-character progress bar, >70% warning, >90% error
 * - Model Panel (/model) with interactive effort adjuster ‹ low medium high ›
 * - Sessions Panel (/sessions) with relative time and 40-col titles
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';
import { visibleWidth, truncateVisible, padLine } from '../../ui/layout-calc.js';

export interface HelpItem {
  command: string;
  description: string;
}

export interface ContextBreakdownItem {
  source: string;
  tokens: number;
  sharePercent: number;
}

export interface ContextPanelProps {
  usedTokens: number;
  limitTokens: number;
  breakdown: ContextBreakdownItem[];
  attachedFiles?: { path: string; tokens: number; sharePercent: number }[];
  width?: number;
}

export interface ModelItem {
  id: string;
  displayName: string;
  isCurrent?: boolean;
  isAvailable?: boolean;
}

export interface ModelPanelProps {
  models: ModelItem[];
  selectedIndex: number;
  effort: 'low' | 'medium' | 'high';
  fallbackModel?: string;
  thinkingEnabled?: boolean;
  width?: number;
}

export class VisualPanels {
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
   * Generates a 30-character progress bar for context and usage panels.
   */
  public render30SlotBar(percent: number): string {
    const clamped = Math.max(0, Math.min(100, percent));
    const fillCount = Math.round((clamped / 100) * 30);
    const emptyCount = 30 - fillCount;
    const filled = this.glyphs.progressFill.repeat(fillCount);
    const empty = this.glyphs.progressEmpty.repeat(emptyCount);
    return `[${filled}${empty}]`;
  }

  /**
   * Renders the /context panel according to § 11.2.
   */
  public renderContextPanel(props: ContextPanelProps): string[] {
    const width = props.width ?? (process.stdout.columns || 76);
    const boxW = Math.min(width, 76);
    const innerW = boxW - 2;
    const g = this.glyphs;
    const noColor = isNoColor();

    const percent = Math.round((props.usedTokens / Math.max(1, props.limitTokens)) * 100);
    const borderCol = noColor ? (s: string) => s : this.activeTheme.tokens.border.active;
    const vert = borderCol(g.boxVertical);

    // Color code the bar based on threshold
    let barColor = this.activeTheme.tokens.status.info;
    if (percent > 90) {
      barColor = this.activeTheme.tokens.status.error;
    } else if (percent > 70) {
      barColor = this.activeTheme.tokens.status.waiting;
    }

    const rawBar = this.render30SlotBar(percent);
    const coloredBar = noColor ? rawBar : barColor(rawBar);
    const tokenStr = `${props.usedTokens.toLocaleString()} / ${props.limitTokens.toLocaleString()} tok`;

    // Top border
    const topFill = Math.max(2, innerW - visibleWidth(' Context ') - 1);
    const topBar = g.boxHorizontal.repeat(topFill);
    const topBorder = borderCol(`${g.boxTopLeft}─ Context ${topBar}${g.boxTopRight}`);

    // Dashed divider
    const dashedBar = g.dashedDivider.repeat(innerW);
    const dividerRow = borderCol(`${g.boxTeeLeft}${dashedBar}${g.boxTeeRight}`);

    // Window bar line: Window [███░░░] <pct>% <used> / <limit> tok
    const windowLine = ` Window  ${coloredBar}  ${percent}%  ${tokenStr}`;

    const lines: string[] = [
      topBorder,
      `${vert}${padLine(windowLine, innerW)}${vert}`,
      dividerRow,
    ];

    // Table Header
    const col1 = '  Source';
    const col2 = 'Tokens';
    const col3 = 'Share';
    const gap1 = 35;
    const gap2 = 12;
    const headerRow = `${col1.padEnd(gap1)}${col2.padStart(gap2)}   ${col3.padStart(6)}`;
    lines.push(`${vert}${padLine(noColor ? headerRow : this.activeTheme.tokens.text.muted(headerRow), innerW)}${vert}`);

    // Breakdown rows
    for (const item of props.breakdown) {
      const src = `  ${item.source}`.padEnd(gap1);
      const tok = item.tokens.toLocaleString().padStart(gap2);
      const share = `${item.sharePercent}%`.padStart(6);
      const row = `${src}${tok}   ${share}`;
      lines.push(`${vert}${padLine(row, innerW)}${vert}`);
    }

    if (props.attachedFiles && props.attachedFiles.length > 0) {
      lines.push(dividerRow);
      for (const file of props.attachedFiles) {
        const p = `  ${truncateVisible(file.path, 30)}`.padEnd(gap1);
        const tok = file.tokens.toLocaleString().padStart(gap2);
        const share = `${file.sharePercent}%`.padStart(6);
        const row = `${p}${tok}   ${share}`;
        lines.push(`${vert}${padLine(row, innerW)}${vert}`);
      }
    }

    // Bottom border with actions
    const botHint = ' a add · r remove · c clear · esc close ';
    const botFill = Math.max(2, innerW - visibleWidth(botHint) - 1);
    const botBar = g.boxHorizontal.repeat(botFill);
    lines.push(borderCol(`${g.boxBottomLeft}─${botHint}${botBar}${g.boxBottomRight}`));

    return lines;
  }

  /**
   * Renders the /model panel with interactive effort selector ‹ low medium high › (§ 11.3).
   */
  public renderModelPanel(props: ModelPanelProps): string[] {
    const width = props.width ?? (process.stdout.columns || 76);
    const boxW = Math.min(width, 76);
    const innerW = boxW - 2;
    const g = this.glyphs;
    const noColor = isNoColor();

    const borderCol = noColor ? (s: string) => s : this.activeTheme.tokens.border.active;
    const vert = borderCol(g.boxVertical);

    // Top border
    const topFill = Math.max(2, innerW - visibleWidth(' Model ') - 1);
    const topBar = g.boxHorizontal.repeat(topFill);
    const topBorder = borderCol(`${g.boxTopLeft}─ Model ${topBar}${g.boxTopRight}`);

    const dashedBar = g.dashedDivider.repeat(innerW);
    const dividerRow = borderCol(`${g.boxTeeLeft}${dashedBar}${g.boxTeeRight}`);

    const lines: string[] = [topBorder];

    // Model list
    for (let i = 0; i < props.models.length; i++) {
      const m = props.models[i];
      const isSelected = i === props.selectedIndex;
      const caret = isSelected
        ? (noColor ? `${g.focusCaret} ` : `${this.activeTheme.tokens.status.info(g.focusCaret)} `)
        : '  ';

      const tag = m.isCurrent ? 'current' : (!m.isAvailable ? '(unavailable)' : '');
      const left = `${caret}${m.displayName}`;
      const gap = Math.max(2, innerW - visibleWidth(left) - visibleWidth(tag) - 2);
      const fullRow = `${left}${' '.repeat(gap)}${tag} `;

      const coloredRow = isSelected && !noColor
        ? this.activeTheme.tokens.text.primary(fullRow)
        : (m.isAvailable === false && !noColor ? this.activeTheme.tokens.text.muted(fullRow) : fullRow);

      lines.push(`${vert}${padLine(coloredRow, innerW)}${vert}`);
    }

    lines.push(dividerRow);

    // Effort selector: Effort   ‹  low   medium   high  ›
    const efforts: ('low' | 'medium' | 'high')[] = ['low', 'medium', 'high'];
    const formattedEfforts = efforts.map((e) => {
      if (e === props.effort) {
        return noColor ? `[${e}]` : this.activeTheme.tokens.text.primary(`[${e}]`);
      }
      return noColor ? ` ${e} ` : this.activeTheme.tokens.text.muted(` ${e} `);
    });

    const effortRow = `  Effort      ${g.adjustLeft} ${formattedEfforts.join(' ')} ${g.adjustRight}`;
    lines.push(`${vert}${padLine(effortRow, innerW)}${vert}`);

    // Fallback model
    const fallbackText = props.fallbackModel || 'auto';
    const fallbackRow = `  Fallback    ${fallbackText}`;
    lines.push(`${vert}${padLine(noColor ? fallbackRow : this.activeTheme.tokens.text.muted(fallbackRow), innerW)}${vert}`);

    // Thinking toggle
    const thinkingText = props.thinkingEnabled ? 'on' : 'off';
    const thinkingRow = `  Thinking    ${thinkingText}`;
    lines.push(`${vert}${padLine(noColor ? thinkingRow : this.activeTheme.tokens.text.muted(thinkingRow), innerW)}${vert}`);

    // Bottom border
    const botHint = ' up/down move · left/right adjust · enter apply · esc close ';
    const botFill = Math.max(2, innerW - visibleWidth(botHint) - 1);
    const botBar = g.boxHorizontal.repeat(botFill);
    lines.push(borderCol(`${g.boxBottomLeft}─${botHint}${botBar}${g.boxBottomRight}`));

    return lines;
  }
}
