/**
 * Visual Workflow, Crew & Activity Monitors.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 13, § 14, § 15).
 *
 * Implements:
 * - Activity Tray (Ctrl+X) with task checklist (☐ / ☒) and queued messages
 * - Crew Monitor (Ctrl+G) 2-pane agent activity monitor
 * - Workflow DAG Monitor with 2-step stop arming (press ctrl+x again to stop)
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';
import { visibleWidth, truncateVisible, padLine } from '../../ui/layout-calc.js';

export interface TaskItem {
  id: string;
  label: string;
  status: 'done' | 'in_progress' | 'pending';
}

export interface ActivityTrayProps {
  tasks: TaskItem[];
  queuedMessages?: string[];
  width?: number; // default 76
}

export interface CrewAgent {
  id: string;
  name: string;
  status: 'running' | 'success' | 'waiting' | 'error';
  recentActivity?: string[];
}

export interface CrewMonitorProps {
  agents: CrewAgent[];
  selectedAgentIndex: number;
  width?: number;
}

export interface WorkflowStep {
  index: number;
  name: string;
  status: 'success' | 'running' | 'waiting' | 'pending' | 'failed';
  credits?: number;
}

export interface WorkflowMonitorProps {
  name: string;
  runId: string;
  status: string;
  steps: WorkflowStep[];
  selectedStepIndex: number;
  outputPreview?: string[];
  width?: number;
}

export class VisualWorkflowMonitors {
  private activeTheme: ActiveTheme;
  private glyphs: GlyphSet;
  private stopArmed = false;
  private stopArmTimer?: NodeJS.Timeout;

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
   * 2-Step Stop Arming Logic:
   * First trigger arms the stop action and sets a 5-second automatic disarm timer.
   * Second trigger confirms the stop.
   */
  public armStop(): { armed: boolean; message: string } {
    if (this.stopArmed) {
      this.cancelStop();
      return { armed: false, message: 'Workflow stop confirmed.' };
    }

    this.stopArmed = true;
    if (this.stopArmTimer) clearTimeout(this.stopArmTimer);
    this.stopArmTimer = setTimeout(() => {
      this.stopArmed = false;
    }, 5000);

    return { armed: true, message: 'Press ctrl+x again to stop this run · esc to keep running' };
  }

  public isStopArmed(): boolean {
    return this.stopArmed;
  }

  public cancelStop(): void {
    this.stopArmed = false;
    if (this.stopArmTimer) {
      clearTimeout(this.stopArmTimer);
      this.stopArmTimer = undefined;
    }
  }

  /**
   * Activity Tray (Ctrl+X) rendering according to § 13.
   */
  public renderActivityTray(props: ActivityTrayProps): string[] {
    const width = props.width ?? (process.stdout.columns || 76);
    const boxW = Math.min(width, 76);
    const innerW = boxW - 2;
    const g = this.glyphs;
    const noColor = isNoColor();

    const borderCol = noColor ? (s: string) => s : this.activeTheme.tokens.border.active;
    const vert = borderCol(g.boxVertical);

    const topFill = Math.max(2, innerW - visibleWidth(' Activity ') - 1);
    const topBar = g.boxHorizontal.repeat(topFill);
    const topBorder = borderCol(`${g.boxTopLeft}─ Activity ${topBar}${g.boxTopRight}`);

    const dashedBar = g.dashedDivider.repeat(innerW);
    const dividerRow = borderCol(`${g.boxTeeLeft}${dashedBar}${g.boxTeeRight}`);

    const lines: string[] = [topBorder];

    // Tasks Header
    lines.push(`${vert}${padLine(' Tasks', innerW)}${vert}`);

    for (const task of props.tasks) {
      let row = '';
      if (task.status === 'done') {
        const marker = noColor ? g.taskDone : this.activeTheme.tokens.status.success(g.taskDone);
        const text = noColor ? task.label : this.activeTheme.tokens.text.muted(task.label);
        row = `   ${marker} ${text}`;
      } else if (task.status === 'in_progress') {
        const caret = noColor ? g.focusCaret : this.activeTheme.tokens.status.info(g.focusCaret);
        const spinner = noColor ? g.spinnerFrames[0] : this.activeTheme.tokens.status.info(g.spinnerFrames[0]);
        const text = noColor ? task.label : this.activeTheme.tokens.text.primary(task.label);
        row = `  ${caret} ${spinner} ${text}`;
      } else {
        const marker = noColor ? g.taskOpen : this.activeTheme.tokens.text.muted(g.taskOpen);
        row = `   ${marker} ${task.label}`;
      }
      lines.push(`${vert}${padLine(row, innerW)}${vert}`);
    }

    if (props.queuedMessages && props.queuedMessages.length > 0) {
      lines.push(dividerRow);
      lines.push(`${vert}${padLine(` Queued messages (${props.queuedMessages.length})`, innerW)}${vert}`);
      for (const q of props.queuedMessages) {
        const cleanQ = truncateVisible(`   > ${q}`, innerW - 2);
        lines.push(`${vert}${padLine(noColor ? cleanQ : this.activeTheme.tokens.text.muted(cleanQ), innerW)}${vert}`);
      }
    }

    const botHint = ' ctrl+x close · up/down move · esc close ';
    const botFill = Math.max(2, innerW - visibleWidth(botHint) - 1);
    const botBar = g.boxHorizontal.repeat(botFill);
    lines.push(borderCol(`${g.boxBottomLeft}─${botHint}${botBar}${g.boxBottomRight}`));

    return lines;
  }

  /**
   * Crew Monitor (Ctrl+G) 2-pane layout according to § 14.
   */
  public renderCrewMonitor(props: CrewMonitorProps): string[] {
    const width = props.width ?? (process.stdout.columns || 76);
    const boxW = Math.min(width, 76);
    const innerW = boxW - 2;
    const g = this.glyphs;
    const noColor = isNoColor();

    const borderCol = noColor ? (s: string) => s : this.activeTheme.tokens.border.active;
    const vert = borderCol(g.boxVertical);

    // Responsive: >= 60 cols = 2 panes; < 60 cols = 1 pane list
    if (boxW < 60) {
      // 1-pane compact mode
      const lines: string[] = [borderCol(`${g.boxTopLeft}─ Crew Monitor ─${g.boxTopRight}`)];
      for (let i = 0; i < props.agents.length; i++) {
        const ag = props.agents[i];
        const isSel = i === props.selectedAgentIndex;
        const caret = isSel ? `${g.focusCaret} ` : '  ';
        lines.push(`${vert}${padLine(`${caret}${ag.name} (${ag.status})`, innerW)}${vert}`);
      }
      lines.push(borderCol(`${g.boxBottomLeft}─ enter details · esc close ─${g.boxBottomRight}`));
      return lines;
    }

    // 2-pane layout: Left pane width ~26 cols, Right pane width remainder
    const leftW = 26;
    const rightW = innerW - leftW - 1; // 1 col for inner separator │

    const topBarL = g.boxHorizontal.repeat(leftW);
    const topBarR = g.boxHorizontal.repeat(rightW);
    const topBorder = borderCol(`${g.boxTopLeft}─ Crew monitor ─${topBarL.slice(16)}${g.boxTeeTop}${topBarR}${g.boxTopRight}`);

    const midDivL = g.boxHorizontal.repeat(leftW);
    const midDivR = g.boxHorizontal.repeat(rightW);
    const headerSep = borderCol(`${g.boxTeeLeft}${midDivL}${g.boxCross}${midDivR}${g.boxTeeRight}`);

    const selectedAgent = props.agents[props.selectedAgentIndex] || props.agents[0];
    const leftHeader = padLine(' Agents', leftW);
    const rightHeader = padLine(` Activity: ${selectedAgent ? selectedAgent.name : ''}`, rightW);

    const lines: string[] = [
      topBorder,
      `${vert}${leftHeader}${vert}${rightHeader}${vert}`,
      headerSep,
    ];

    const leftRows: string[] = [];
    for (let i = 0; i < props.agents.length; i++) {
      const ag = props.agents[i];
      const isSel = i === props.selectedAgentIndex;
      const caret = isSel ? `${g.focusCaret} ` : '  ';
      let stSymbol = g.spinnerFrames[0];
      if (ag.status === 'success') stSymbol = g.success;
      else if (ag.status === 'error') stSymbol = g.error;
      else if (ag.status === 'waiting') stSymbol = g.waiting;

      const rowText = `${caret}${ag.name}`.padEnd(leftW - 4) + ` ${stSymbol}`;
      leftRows.push(padLine(rowText, leftW));
    }

    const rightRows: string[] = [];
    if (selectedAgent && selectedAgent.recentActivity) {
      for (const act of selectedAgent.recentActivity) {
        rightRows.push(padLine(` ${truncateVisible(act, rightW - 2)}`, rightW));
      }
    }

    const rowCount = Math.max(leftRows.length, rightRows.length, 4);
    for (let i = 0; i < rowCount; i++) {
      const l = leftRows[i] || ' '.repeat(leftW);
      const r = rightRows[i] || ' '.repeat(rightW);
      lines.push(`${vert}${l}${vert}${r}${vert}`);
    }

    const botDivL = g.boxHorizontal.repeat(leftW);
    const botDivR = g.boxHorizontal.repeat(rightW);
    const botBorder = borderCol(`${g.boxBottomLeft}─ ctrl+d/u switch · q close ─${botDivL.slice(28)}${g.boxTeeBottom}${botDivR}${g.boxBottomRight}`);
    lines.push(botBorder);

    return lines;
  }
}
