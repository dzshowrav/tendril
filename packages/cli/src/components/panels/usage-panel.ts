/**
 * Usage & Quota Overlay Panel.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 10).
 *
 * Requirements:
 * - Shows limits, progress bar, credit balance, and current session usage.
 * - Searchable, scrollable, Esc to dismiss.
 */

import { ActiveTheme } from '../../theme/loader.js';
import { formatProgressBar } from './context-panel.js';
import {
  createPanelState,
  filterPanelItems,
  movePanelCursor,
  PanelItem,
  PanelState,
  renderPanel,
} from './framework.js';

export interface UsageData {
  sessionInputTokens: number;
  sessionOutputTokens: number;
  sessionTotalTokens: number;
  creditBalance?: number;
  dailyTokenLimit?: number;
  dailyTokensUsed?: number;
  monthlyCreditLimit?: number;
  monthlyCreditUsed?: number;
  pageSize?: number;
}

export function createUsagePanelState(data: UsageData): PanelState {
  const items: PanelItem[] = [];

  // 1. Session Token Usage
  items.push({
    id: 'session_usage',
    title: `Current Session Tokens: ${data.sessionTotalTokens.toLocaleString()}`,
    description: `Input: ${data.sessionInputTokens.toLocaleString()} · Output: ${data.sessionOutputTokens.toLocaleString()}`,
    badge: 'session',
    category: 'session',
  });

  // 2. Daily Token Limit & Progress Bar
  if (data.dailyTokenLimit !== undefined && data.dailyTokensUsed !== undefined) {
    const dailyPct = data.dailyTokenLimit > 0 ? (data.dailyTokensUsed / data.dailyTokenLimit) * 100 : 0;
    const dailyBar = formatProgressBar(dailyPct, 16);
    items.push({
      id: 'daily_quota',
      title: `Daily Quota: [${dailyBar}] ${dailyPct.toFixed(1)}%`,
      description: `${data.dailyTokensUsed.toLocaleString()} / ${data.dailyTokenLimit.toLocaleString()} tokens used today`,
      badge: `${Math.round(dailyPct)}%`,
      category: 'quota',
    });
  }

  // 3. Credit Balance
  if (data.creditBalance !== undefined) {
    items.push({
      id: 'credit_balance',
      title: `Credit Balance: $${data.creditBalance.toFixed(2)}`,
      description: 'Remaining account API credits',
      badge: 'credits',
      category: 'billing',
    });
  }

  // 4. Monthly Credit Limit
  if (data.monthlyCreditLimit !== undefined && data.monthlyCreditUsed !== undefined) {
    const creditPct = data.monthlyCreditLimit > 0 ? (data.monthlyCreditUsed / data.monthlyCreditLimit) * 100 : 0;
    const creditBar = formatProgressBar(creditPct, 16);
    items.push({
      id: 'monthly_credits',
      title: `Monthly Budget: [${creditBar}] ${creditPct.toFixed(1)}%`,
      description: `$${data.monthlyCreditUsed.toFixed(2)} / $${data.monthlyCreditLimit.toFixed(2)} used this cycle`,
      badge: 'budget',
      category: 'billing',
    });
  }

  return createPanelState({
    title: 'Usage & Quota Limits',
    subtitle: `Session: ${data.sessionTotalTokens.toLocaleString()} tokens`,
    items,
    pageSize: data.pageSize || 6,
  });
}

export function renderUsagePanel(
  state: PanelState,
  theme: ActiveTheme,
): string {
  return renderPanel(state, theme);
}

export { filterPanelItems, movePanelCursor };
