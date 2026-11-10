/**
 * Settings & Preferences Overlay Panel.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 10).
 *
 * Requirements:
 * - Theme selection, keybinding configuration, terminal input, and display preferences.
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

export interface SettingsData {
  currentTheme: string;
  uiMode: string;
  isNoColor: boolean;
  synchronizedOutput: boolean;
  hyperlinks: boolean;
  historyMode: 'session' | 'global';
  pageSize?: number;
}

export function createSettingsPanelState(data: SettingsData): PanelState {
  const items: PanelItem[] = [
    {
      id: 'theme',
      title: `Theme: ${data.currentTheme}`,
      description: 'Switch between dark, light, or safe (ANSI 16-color)',
      badge: data.currentTheme,
      category: 'appearance',
      data: { key: 'theme', value: data.currentTheme },
    },
    {
      id: 'no_color',
      title: `Color Mode: ${data.isNoColor ? 'Monochrome (NO_COLOR)' : 'Color Enabled'}`,
      description: 'Disable all ANSI color codes adhering to NO_COLOR standard',
      badge: data.isNoColor ? 'NO_COLOR' : 'color',
      category: 'appearance',
    },
    {
      id: 'history_mode',
      title: `Prompt History: ${data.historyMode.toUpperCase()}`,
      description: 'Toggle history scope between per-session and global (all sessions)',
      badge: data.historyMode,
      category: 'input',
      data: { key: 'historyMode', value: data.historyMode },
    },
    {
      id: 'synchronized_output',
      title: `Synchronized Output: ${data.synchronizedOutput ? 'ON' : 'OFF'}`,
      description: 'Mode 2026 atomic frame rendering to prevent terminal flicker',
      badge: data.synchronizedOutput ? 'enabled' : 'disabled',
      category: 'rendering',
    },
    {
      id: 'hyperlinks',
      title: `Terminal Hyperlinks: ${data.hyperlinks ? 'ON' : 'OFF'}`,
      description: 'OSC 8 clickable hyperlink escape sequences',
      badge: data.hyperlinks ? 'enabled' : 'disabled',
      category: 'rendering',
    },
    {
      id: 'keybindings',
      title: 'Keybindings & Shortcuts',
      description: 'Context-aware keybindings (global, panel, monitor, review)',
      badge: 'keys',
      category: 'input',
    },
  ];

  return createPanelState({
    title: 'Tendril Settings & Preferences',
    subtitle: 'Preferences apply across sessions',
    items,
    pageSize: data.pageSize || 6,
  });
}

export function renderSettingsPanel(
  state: PanelState,
  theme: ActiveTheme,
): string {
  return renderPanel(state, theme);
}

export { filterPanelItems, movePanelCursor };
