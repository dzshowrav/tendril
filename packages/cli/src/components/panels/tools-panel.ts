/**
 * Tools & Trust State Overlay Panel.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 10).
 *
 * Requirements:
 * - Lists available tools and their current permission/trust state.
 * - Shows MCP servers and registered capabilities.
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

export interface ToolEntry {
  name: string;
  category: string;
  trustState: 'allow_always' | 'ask' | 'deny';
  description?: string;
  mcpServer?: string;
}

export interface ToolsPanelData {
  tools: ToolEntry[];
  mcpServers?: Array<{ name: string; status: 'connected' | 'disconnected'; toolCount: number }>;
  pageSize?: number;
}

export function createToolsPanelState(data: ToolsPanelData): PanelState {
  const items: PanelItem[] = [];

  // MCP Servers section
  if (data.mcpServers && data.mcpServers.length > 0) {
    for (const server of data.mcpServers) {
      items.push({
        id: `mcp_${server.name}`,
        title: `MCP Server: ${server.name}`,
        description: `Status: ${server.status} · ${server.toolCount} tools provided`,
        badge: server.status === 'connected' ? 'connected' : 'offline',
        category: 'mcp_server',
      });
    }
  }

  // Tools list
  for (const t of data.tools) {
    const trustBadge =
      t.trustState === 'allow_always'
        ? 'always allowed'
        : t.trustState === 'deny'
          ? 'blocked'
          : 'ask on use';

    items.push({
      id: t.name,
      title: `${t.name} (${trustBadge})`,
      description: t.description || `Tool in category: ${t.category}`,
      badge: t.category,
      category: t.category,
      data: t,
    });
  }

  return createPanelState({
    title: 'Available Tools & Permissions',
    subtitle: `${data.tools.length} tools registered`,
    items,
    pageSize: data.pageSize || 8,
  });
}

export function renderToolsPanel(
  state: PanelState,
  theme: ActiveTheme,
): string {
  return renderPanel(state, theme);
}

export { filterPanelItems, movePanelCursor };
