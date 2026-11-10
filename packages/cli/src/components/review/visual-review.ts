/**
 * Visual Document Review Screen.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 16).
 *
 * Implements:
 * - Line numbers right-aligned with fixed gutter `│`
 * - Staged comments indicated by `▌` marker (status.waiting color)
 * - Review status bar with comment counter
 * - Vim-style navigation hints
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';
import { visibleWidth, truncateVisible, padLine } from '../../ui/layout-calc.js';

export interface StagedComment {
  lineNumber: number;
  text: string;
}

export interface DocumentReviewProps {
  documentName: string;
  sectionIndex: number;
  totalSections: number;
  lines: string[];
  startLineNumber?: number;
  stagedComments?: StagedComment[];
  selectedLine?: number;
  width?: number; // default 76
}

export class VisualReviewScreen {
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

  public render(props: DocumentReviewProps): string[] {
    const width = props.width ?? (process.stdout.columns || 76);
    const boxW = Math.min(width, 76);
    const innerW = boxW - 2;
    const g = this.glyphs;
    const noColor = isNoColor();

    const borderCol = noColor ? (s: string) => s : this.activeTheme.tokens.border.active;
    const vert = borderCol(g.boxVertical);

    // Header title: Review: <doc> section <n> of <total>
    const titleText = ` Review: ${props.documentName}   section ${props.sectionIndex} of ${props.totalSections} `;
    const topFill = Math.max(2, innerW - visibleWidth(titleText) - 1);
    const topBar = g.boxHorizontal.repeat(topFill);
    const topBorder = borderCol(`${g.boxTopLeft}─${titleText}${topBar}${g.boxTopRight}`);

    const dashedBar = g.dashedDivider.repeat(innerW);
    const dividerRow = borderCol(`${g.boxTeeLeft}${dashedBar}${g.boxTeeRight}`);

    const linesOut: string[] = [topBorder];

    const startLn = props.startLineNumber ?? 1;
    const numDigits = Math.max(3, String(startLn + props.lines.length).length);
    const contentW = innerW - numDigits - 4;

    const commentsMap = new Map<number, string[]>();
    if (props.stagedComments) {
      for (const sc of props.stagedComments) {
        if (!commentsMap.has(sc.lineNumber)) commentsMap.set(sc.lineNumber, []);
        commentsMap.get(sc.lineNumber)!.push(sc.text);
      }
    }

    for (let i = 0; i < props.lines.length; i++) {
      const currentLn = startLn + i;
      const isSel = currentLn === props.selectedLine;
      const lnStr = String(currentLn).padStart(numDigits, ' ');
      const rawText = props.lines[i];

      const gutter = noColor ? g.boxVertical : this.activeTheme.tokens.border.muted(g.boxVertical);
      const rowContent = ` ${lnStr} ${gutter} ${truncateVisible(rawText, contentW)}`;

      const coloredRow = isSel && !noColor
        ? this.activeTheme.tokens.text.primary(rowContent)
        : rowContent;

      linesOut.push(`${vert}${padLine(coloredRow, innerW)}${vert}`);

      // If comments staged on this line, display with ▌ marker
      if (commentsMap.has(currentLn)) {
        for (const comm of commentsMap.get(currentLn)!) {
          const marker = noColor ? g.commentMarker : this.activeTheme.tokens.status.waiting(g.commentMarker);
          const commText = `comment: "${comm}"`;
          const commFormatted = noColor ? commText : this.activeTheme.tokens.text.muted(commText);
          const commentRow = ` ${' '.repeat(numDigits)} ${gutter}${marker} ${commFormatted}`;
          linesOut.push(`${vert}${padLine(commentRow, innerW)}${vert}`);
        }
      }
    }

    linesOut.push(dividerRow);

    const commentCount = props.stagedComments ? props.stagedComments.length : 0;
    const countRow = ` Comments staged: ${commentCount}`;
    linesOut.push(`${vert}${padLine(countRow, innerW)}${vert}`);

    const botHint = ' j/k move · enter comment · ? help · q back ';
    const botFill = Math.max(2, innerW - visibleWidth(botHint) - 1);
    const botBar = g.boxHorizontal.repeat(botFill);
    linesOut.push(borderCol(`${g.boxBottomLeft}─${botHint}${botBar}${g.boxBottomRight}`));

    return linesOut;
  }
}
