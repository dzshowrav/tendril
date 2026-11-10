/**
 * Activity Tray Component.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 11.1, § 16.3).
 *
 * Requirements:
 * - One key (Ctrl+X in global context) to toggle at-a-glance task progress and queued messages.
 * - Does not require scrolling the conversation history.
 * - Shows active tool, elapsed time, queued inputs, subagents.
 */

import { ActiveTheme } from '../../theme/loader.js';

export interface ActivityTrayData {
  status: 'idle' | 'working' | 'waiting_for_user' | 'error';
  elapsedWorkMs: number;
  currentTool?: string;
  queuedMessages: string[];
  activeSubagents?: Array<{ name: string; task: string }>;
  tokenUsage?: { input: number; output: number };
}

export function renderActivityTray(data: ActivityTrayData, theme: ActiveTheme, width = 76): string {
  const { colors, symbols } = theme;
  const innerW = width - 2;
  const lines: string[] = [];

  // Top border
  const title = ` ${colors.bold(colors.textPrimary('Activity Tray (Ctrl+X)'))} `;
  const topPad = Math.max(0, innerW - 25);
  lines.push(
    colors.borderFocus(symbols.boxTopLeft + symbols.boxHorizontal) +
      title +
      colors.borderFocus(symbols.boxHorizontal.repeat(topPad) + symbols.boxTopRight),
  );

  // Status & Elapsed line
  const elapsedSec = (data.elapsedWorkMs / 1000).toFixed(1);
  const statusIcon =
    data.status === 'working'
      ? colors.statusRunning('● WORKING')
      : data.status === 'waiting_for_user'
        ? colors.statusWaiting('⏸ WAITING FOR APPROVAL')
        : colors.statusSuccess('○ IDLE');

  lines.push(
    colors.borderDefault(symbols.boxVertical) +
      `  Status: ${statusIcon} · Elapsed: ${colors.textPrimary(`${elapsedSec}s`)}` +
      ' '.repeat(Math.max(0, innerW - 40)) +
      colors.borderDefault(symbols.boxVertical),
  );

  // Active Tool
  if (data.currentTool) {
    lines.push(
      colors.borderDefault(symbols.boxVertical) +
        `  Current Tool: ${colors.textAccent(data.currentTool)}` +
        ' '.repeat(Math.max(0, innerW - 20 - data.currentTool.length)) +
        colors.borderDefault(symbols.boxVertical),
    );
  }

  // Queued Messages
  const qCount = data.queuedMessages.length;
  lines.push(
    colors.borderDefault(symbols.boxVertical) +
      `  Queued Messages: ${colors.bold(String(qCount))}` +
      ' '.repeat(Math.max(0, innerW - 22)) +
      colors.borderDefault(symbols.boxVertical),
  );
  for (let i = 0; i < Math.min(3, qCount); i++) {
    const preview = data.queuedMessages[i].slice(0, innerW - 8);
    lines.push(
      colors.borderDefault(symbols.boxVertical) +
        `    [#${i + 1}] ${colors.textMuted(preview)}` +
        ' '.repeat(Math.max(0, innerW - 9 - preview.length)) +
        colors.borderDefault(symbols.boxVertical),
    );
  }

  // Subagents
  if (data.activeSubagents && data.activeSubagents.length > 0) {
    lines.push(
      colors.borderDefault(symbols.boxVertical) +
        `  Subagents Running: ${colors.bold(String(data.activeSubagents.length))}` +
        ' '.repeat(Math.max(0, innerW - 25)) +
        colors.borderDefault(symbols.boxVertical),
    );
    for (const sub of data.activeSubagents.slice(0, 2)) {
      const subLine = `    • ${sub.name}: ${sub.task}`.slice(0, innerW - 4);
      lines.push(
        colors.borderDefault(symbols.boxVertical) +
          colors.textMuted(subLine) +
          ' '.repeat(Math.max(0, innerW - subLine.length)) +
          colors.borderDefault(symbols.boxVertical),
      );
    }
  }

  // Bottom border
  lines.push(
    colors.borderFocus(symbols.boxBottomLeft) +
      colors.textMuted(' Esc / Ctrl+X: Close Tray ') +
      colors.borderFocus(symbols.boxHorizontal.repeat(Math.max(0, innerW - 26)) + symbols.boxBottomRight),
  );

  return lines.join('\n');
}
