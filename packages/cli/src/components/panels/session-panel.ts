/**
 * Session Picker Overlay Panel.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 10, § 17).
 *
 * Requirements:
 * - Scoped to current working directory by default.
 * - Displays timestamp, mode, title, active marker.
 * - Fuzzy searchable, scrollable, Esc to dismiss.
 * - Backward compatible with legacy session formats.
 */

import { ActiveTheme } from '../../theme/loader.js';
import {
  createPanelState,
  filterPanelItems,
  movePanelCursor,
  PanelItem,
  PanelState,
  renderPanel,
} from './framework.js';

export interface SessionData {
  id: string;
  title: string;
  workspace?: string;
  workspace_path?: string;
  mode?: string;
  model?: string;
  created_at?: string;
  updated_at?: string;
}

export function formatSessionTimestamp(iso?: string): string {
  if (!iso) return 'unknown';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  } catch {
    return iso;
  }
}

export function filterSessionsByWorkspace(
  sessions: SessionData[],
  workspacePath: string,
  scopeToCwd = true,
): SessionData[] {
  if (!scopeToCwd) return sessions;
  const target = workspacePath.replace(/\/+$/, '');
  return sessions.filter((s) => {
    const ws = (s.workspace_path || s.workspace || '').replace(/\/+$/, '');
    return ws === target;
  });
}

export function createSessionPanelState(options: {
  sessions: SessionData[];
  currentSessionId?: string;
  workspacePath?: string;
  scopeToCwd?: boolean;
  pageSize?: number;
}): PanelState {
  const ws = options.workspacePath || process.cwd();
  const filtered = filterSessionsByWorkspace(
    options.sessions,
    ws,
    options.scopeToCwd !== false,
  );

  const items: PanelItem[] = filtered.map((s) => {
    const isActive = s.id === options.currentSessionId;
    const timeStr = formatSessionTimestamp(s.updated_at || s.created_at);
    const modeStr = s.mode || 'auto-edit';
    const marker = isActive ? '★ CURRENT: ' : '';

    return {
      id: s.id,
      title: `${marker}${s.title || 'Untitled Session'} (${s.id.slice(0, 8)})`,
      description: `${timeStr} · model: ${s.model || 'default'}`,
      badge: modeStr,
      category: isActive ? 'active' : 'recent',
      data: s,
    };
  });

  return createPanelState({
    title: 'Select Session to Resume',
    subtitle: `Scoped to ${ws}`,
    items,
    pageSize: options.pageSize || 8,
  });
}

export function renderSessionPanel(
  state: PanelState,
  theme: ActiveTheme,
): string {
  return renderPanel(state, theme);
}

export { filterPanelItems, movePanelCursor };
