/**
 * Help Overlay Panel.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 10, § 15).
 */

import { SlashCommandRegistry } from '../../commands/registry.js';
import { ActiveTheme } from '../../theme/loader.js';
import {
  createPanelState,
  filterPanelItems,
  movePanelCursor,
  PanelItem,
  PanelState,
  renderPanel,
} from './framework.js';

export function createHelpPanelState(registry: SlashCommandRegistry, pageSize = 10): PanelState {
  const commands = registry.list();
  const items: PanelItem[] = commands.map((cmd) => {
    const aliasStr = cmd.aliases && cmd.aliases.length > 0 ? ` (alias: /${cmd.aliases.join(', /')})` : '';
    const argStr = cmd.argumentSchema ? ` ${cmd.argumentSchema}` : '';
    return {
      id: cmd.name,
      title: `/${cmd.name}${argStr}`,
      description: `${cmd.description}${aliasStr}`,
      badge: cmd.category,
      category: cmd.category,
      data: cmd,
    };
  });

  return createPanelState({
    title: 'Command Help & Shortcuts',
    subtitle: 'Fuzzy searchable command list',
    items,
    pageSize,
  });
}

export function renderHelpPanel(
  state: PanelState,
  theme: ActiveTheme,
): string {
  return renderPanel(state, theme);
}

export { filterPanelItems, movePanelCursor };
