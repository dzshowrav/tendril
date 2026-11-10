/**
 * Model & Fallback Overlay Panel.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 8.1, § 10).
 *
 * Requirements:
 * - Lists models, thinking/effort toggle, and dedicated fallback configuration row.
 * - Displays active model marker and available providers.
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

export interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  isAvailable?: boolean;
  contextWindow?: number;
}

export interface ModelPanelConfig {
  currentModel: string;
  models: ModelEntry[];
  thinkingEffort?: 'low' | 'medium' | 'high' | 'off';
  fallbackChain?: string[];
  pageSize?: number;
}

export function createModelPanelState(config: ModelPanelConfig): PanelState {
  const items: PanelItem[] = [];

  // 1. Thinking / Effort Setting Item
  const effort = config.thinkingEffort || 'medium';
  items.push({
    id: '__setting_effort__',
    title: `[Thinking / Effort] Current: ${effort.toUpperCase()}`,
    description: 'Toggle reasoning effort (off / low / medium / high)',
    badge: 'effort',
    category: 'settings',
    data: { type: 'effort', value: effort },
  });

  // 2. Fallback Chain Setting Item (§ 8.1)
  const chainStr =
    config.fallbackChain && config.fallbackChain.length > 0
      ? config.fallbackChain.join(' ➔ ')
      : 'None (default provider failover)';
  items.push({
    id: '__setting_fallback__',
    title: `[Model Fallback Chain] ${chainStr}`,
    description: 'Automatic failover sequence if primary model is unavailable or rejects turn',
    badge: 'fallback',
    category: 'settings',
    data: { type: 'fallback', chain: config.fallbackChain || [] },
  });

  // 3. Model list
  for (const m of config.models) {
    const isCurrent = m.id === config.currentModel;
    const marker = isCurrent ? '★ ACTIVE: ' : '';
    const availStr = m.isAvailable === false ? ' [UNAVAILABLE]' : '';
    const ctxStr = m.contextWindow ? ` · ${Math.round(m.contextWindow / 1000)}k ctx` : '';

    items.push({
      id: m.id,
      title: `${marker}${m.name || m.id}${availStr}`,
      description: `Provider: ${m.provider}${ctxStr}`,
      badge: m.provider,
      category: isCurrent ? 'active' : 'models',
      data: { type: 'model', model: m },
    });
  }

  return createPanelState({
    title: 'Model & Fallback Configuration',
    subtitle: `Active: ${config.currentModel}`,
    items,
    pageSize: config.pageSize || 8,
  });
}

export function renderModelPanel(
  state: PanelState,
  theme: ActiveTheme,
): string {
  return renderPanel(state, theme);
}

export { filterPanelItems, movePanelCursor };
