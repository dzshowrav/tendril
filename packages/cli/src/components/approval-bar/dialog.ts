/**
 * Visual Permission Dialog Component.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 9).
 *
 * Implements:
 * - Temporary takeover of input box area during approvals
 * - 3-tier trust hierarchy for commands and file edits
 * - (1 of N pending) multi-approval queue counter in title
 * - Inline note taking field when tab is pressed
 * - Safety-first default focus
 * - Dashed dividers and box drawing borders
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';
import { visibleWidth, truncateVisible, padLine } from '../../ui/layout-calc.js';

export interface ApprovalOption {
  key: string; // '1', '2', etc.
  label: string;
  isDefault?: boolean;
}

export interface ApprovalDialogProps {
  type: 'command' | 'file' | 'trust_all';
  target: string;
  description?: string;
  diffLines?: string[];
  queueInfo?: { current: number; total: number };
  options: ApprovalOption[];
  selectedIndex: number;
  isNoteOpen?: boolean;
  noteText?: string;
  width?: number; // default 76
}

export class VisualApprovalDialog {
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

  public render(props: ApprovalDialogProps): string[] {
    const width = props.width ?? (process.stdout.columns || 76);
    const boxW = Math.min(width, 76);
    const innerW = boxW - 2;
    const g = this.glyphs;
    const noColor = isNoColor();

    const borderCol = noColor ? (s: string) => s : this.activeTheme.tokens.status.waiting;
    const vert = borderCol(g.boxVertical);

    // Title construction
    let baseTitle = '';
    if (props.type === 'command') baseTitle = 'Run command';
    else if (props.type === 'file') baseTitle = 'Edit file';
    else baseTitle = 'Trust all tools';

    let titleText = ` ${baseTitle} `;
    if (props.queueInfo && props.queueInfo.total > 1) {
      titleText = ` ${baseTitle}  (${props.queueInfo.current} of ${props.queueInfo.total} pending) `;
    }

    const topFill = Math.max(2, innerW - visibleWidth(titleText) - 1);
    const topBar = g.boxHorizontal.repeat(topFill);
    const topBorder = borderCol(`${g.boxTopLeft}─${titleText}${topBar}${g.boxTopRight}`);

    const dashedBar = g.dashedDivider.repeat(innerW);
    const dividerRow = borderCol(`${g.boxTeeLeft}${dashedBar}${g.boxTeeRight}`);
    const emptyRow = `${vert}${' '.repeat(innerW)}${vert}`;

    const lines: string[] = [topBorder];

    // Content: Target and description
    if (props.type === 'command') {
      const cmdStr = `   ${props.target}`;
      lines.push(`${vert}${padLine(noColor ? cmdStr : this.activeTheme.tokens.text.primary(cmdStr), innerW)}${vert}`);
      if (props.description) {
        const descStr = `   ${props.description}`;
        lines.push(`${vert}${padLine(noColor ? descStr : this.activeTheme.tokens.text.muted(descStr), innerW)}${vert}`);
      }
    } else if (props.type === 'file') {
      const fileStr = ` ${props.target}`;
      lines.push(`${vert}${padLine(noColor ? fileStr : this.activeTheme.tokens.text.primary(fileStr), innerW)}${vert}`);
      if (props.diffLines && props.diffLines.length > 0) {
        lines.push(dividerRow);
        for (const dl of props.diffLines.slice(0, 5)) {
          lines.push(`${vert}${padLine(`   ${dl}`, innerW)}${vert}`);
        }
      }
    } else {
      const warn1 = ' This lets the agent run every tool without asking, for this session.';
      const warn2 = ' Commands can modify or delete files and run arbitrary programs.';
      lines.push(`${vert}${padLine(noColor ? warn1 : this.activeTheme.tokens.text.muted(warn1), innerW)}${vert}`);
      lines.push(`${vert}${padLine(noColor ? warn2 : this.activeTheme.tokens.text.muted(warn2), innerW)}${vert}`);
    }

    lines.push(dividerRow);

    // Question
    const questionText = props.type === 'command'
      ? ' Allow this command?'
      : props.type === 'file'
      ? ' Apply this change?'
      : ' Enable trust-all mode?';
    lines.push(`${vert}${padLine(noColor ? questionText : this.activeTheme.tokens.text.primary(questionText), innerW)}${vert}`);
    lines.push(emptyRow);

    // Options list
    for (let i = 0; i < props.options.length; i++) {
      const opt = props.options[i];
      const isSelected = i === props.selectedIndex;
      const caret = isSelected
        ? (noColor ? `${g.focusCaret} ` : `${this.activeTheme.tokens.status.info(g.focusCaret)} `)
        : '  ';

      const optText = `${caret}${opt.key}. ${opt.label}`;
      const coloredOpt = isSelected && !noColor
        ? this.activeTheme.tokens.text.primary(optText)
        : (noColor ? optText : this.activeTheme.tokens.text.muted(optText));

      lines.push(`${vert}${padLine(coloredOpt, innerW)}${vert}`);
    }

    // Inline note input if tab was pressed
    if (props.isNoteOpen) {
      lines.push(emptyRow);
      const notePrompt = ` Note: ${props.noteText || ''}_`;
      lines.push(`${vert}${padLine(noColor ? notePrompt : this.activeTheme.tokens.prompt.accent(notePrompt), innerW)}${vert}`);
    }

    // Bottom border with navigation hints
    const botHint = ' enter select · tab add note · esc cancel ';
    const botFill = Math.max(2, innerW - visibleWidth(botHint) - 1);
    const botBar = g.boxHorizontal.repeat(botFill);
    const botBorder = borderCol(`${g.boxBottomLeft}─${botHint}${botBar}${g.boxBottomRight}`);
    lines.push(botBorder);

    return lines;
  }
}
