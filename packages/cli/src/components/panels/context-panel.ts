/**
 * Context Breakdown Overlay Panel.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 10).
 *
 * Requirements:
 * - File-by-file token count and percentage breakdown.
 * - Actions: add, remove, show, clear.
 * - Searchable, scrollable, Esc to dismiss.
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

export interface ContextItem {
  id: string;
  type: 'system' | 'message' | 'file' | 'tool_output';
  label: string;
  tokenCount: number;
  percentage?: number;
}

export interface ContextPanelData {
  totalTokens: number;
  maxTokens: number;
  items: ContextItem[];
  pageSize?: number;
}

export function formatProgressBar(
  percentage: number,
  width = 16,
  char = '■',
  emptyChar = '─',
): string {
  const filled = Math.min(width, Math.max(0, Math.round((percentage / 100) * width)));
  return char.repeat(filled) + emptyChar.repeat(width - filled);
}

export function createContextPanelState(data: ContextPanelData): PanelState {
  const panelItems: PanelItem[] = [];

  // Summary header item
  const pct = data.maxTokens > 0 ? (data.totalTokens / data.maxTokens) * 100 : 0;
  const bar = formatProgressBar(pct);
  panelItems.push({
    id: '__context_summary__',
    title: `[Total Context Usage] ${bar} ${pct.toFixed(1)}%`,
    description: `${data.totalTokens.toLocaleString()} / ${data.maxTokens.toLocaleString()} tokens`,
    badge: `${Math.round(pct)}%`,
    category: 'summary',
    data: { total: data.totalTokens, max: data.maxTokens },
  });

  // Action items (§ 10: add/remove/show/clear)
  panelItems.push({
    id: '__action_clear__',
    title: '⚡ Compact / Clear Context',
    description: 'Summarize older messages to reclaim context window space',
    badge: 'action',
    category: 'action',
    data: { action: 'clear' },
  });

  // Context item breakdown
  for (const item of data.items) {
    const itemPct = data.totalTokens > 0 ? (item.tokenCount / data.totalTokens) * 100 : 0;
    const itemBar = formatProgressBar(itemPct, 8, '■', '·');

    panelItems.push({
      id: item.id,
      title: `${item.label} (${itemBar} ${itemPct.toFixed(1)}%)`,
      description: `${item.tokenCount.toLocaleString()} tokens · type: ${item.type}`,
      badge: item.type,
      category: 'breakdown',
      data: item,
    });
  }

  return createPanelState({
    title: 'Context Breakdown & Token Analysis',
    subtitle: `${data.totalTokens.toLocaleString()} tokens active`,
    items: panelItems,
    pageSize: data.pageSize || 8,
  });
}

export function renderContextPanel(
  state: PanelState,
  theme: ActiveTheme,
): string {
  return renderPanel(state, theme);
}

export { filterPanelItems, movePanelCursor };
