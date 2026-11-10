/**
 * Dynamic Context-Aware Footer & Status Bar.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 4, § 19, § 21).
 *
 * Implements 10+ dynamic context-aware hint states on the left,
 * and `<mode> | <model> | ctx <pct>%` on the right with responsive pruning.
 */

import { ActiveTheme } from '../../theme/loader.js';
import { resolveActiveTheme } from '../../theme/loader.js';
import { visibleWidth, truncateVisible } from '../../ui/layout-calc.js';
import { isNoColor } from '../../ui/theme.js';

export type FooterState =
  | 'idle'
  | 'typing'
  | 'multiline'
  | 'chip'
  | 'running'
  | 'approval'
  | 'autocomplete'
  | 'shell'
  | 'plan'
  | 'stop_armed'
  | 'exit_armed'
  | 'suspend_armed'
  | 'review'
  | 'monitor'
  | 'panel';

export interface StatusBarProps {
  state: FooterState;
  customHint?: string;
  mode: string;
  model: string;
  contextPercent?: number; // e.g. 14 for 14%
  width?: number; // terminal columns, default 76
  theme?: ActiveTheme;
}

export const FOOTER_HINTS: Record<FooterState, string> = {
  idle: '? for shortcuts',
  typing: 'shift+enter newline · esc clear',
  multiline: 'shift+enter newline · esc clear',
  chip: 'tab expand chip · backspace remove chip',
  running: 'esc to interrupt · ctrl+o expand · ctrl+x tray',
  approval: 'enter select · tab add note · esc cancel',
  autocomplete: 'up/down move · tab complete · esc close',
  shell: 'shell mode · enter run · esc exit shell mode',
  plan: 'plan mode · shift+tab to leave',
  stop_armed: 'press ctrl+x again to stop · esc to keep running',
  exit_armed: 'press ctrl+c again to exit',
  suspend_armed: 'press ctrl+z again to suspend',
  review: 'j/k scroll · c comment · enter accept · q quit',
  monitor: 's stop workflow · space details · esc back',
  panel: '↑↓ scroll · q / esc close',
};

export class StatusBar {
  private activeTheme: ActiveTheme;

  constructor(theme?: ActiveTheme) {
    this.activeTheme = theme || resolveActiveTheme();
  }

  public setTheme(theme: ActiveTheme): void {
    this.activeTheme = theme;
  }

  /**
   * Formats the right-side status: `<mode> | <model> | ctx <pct>%`
   * with progressive pruning as width decreases.
   */
  public formatRightStatus(
    mode: string,
    model: string,
    contextPercent: number | undefined,
    availableWidth: number
  ): string {
    const ctxStr = contextPercent !== undefined ? `ctx ${Math.round(contextPercent)}%` : '';

    // Full format: "<mode> | <model> | <ctx>"
    const fullParts = [mode, model, ctxStr].filter(Boolean);
    const full = fullParts.join(' | ');

    if (visibleWidth(full) <= availableWidth) {
      return full;
    }

    // Prune model: "<mode> | <ctx>"
    const withoutModelParts = [mode, ctxStr].filter(Boolean);
    const withoutModel = withoutModelParts.join(' | ');
    if (visibleWidth(withoutModel) <= availableWidth) {
      return withoutModel;
    }

    // Prune mode, keep compact: "<mode> <ctx>" or just "<ctx>"
    if (ctxStr && visibleWidth(ctxStr) <= availableWidth) {
      return ctxStr;
    }

    return truncateVisible(full, availableWidth, '');
  }

  /**
   * Renders the complete 1-row footer according to column width and state.
   */
  public render(props: StatusBarProps): string {
    const width = props.width ?? (process.stdout.columns || 76);
    const theme = props.theme || this.activeTheme;
    const noColor = isNoColor();

    const hintText = props.customHint || FOOTER_HINTS[props.state] || FOOTER_HINTS.idle;

    // Responsive rules (§ 19, § 21):
    // < 50 cols: hint hidden, compact status only
    if (width < 50) {
      const rightStatus = this.formatRightStatus(props.mode, props.model, props.contextPercent, width - 2);
      const coloredStatus = noColor ? rightStatus : theme.tokens.text.muted(rightStatus);
      return `  ${coloredStatus}`;
    }

    // 50 to 59 cols: hint hidden, standard right status
    if (width < 60) {
      const rightStatus = this.formatRightStatus(props.mode, props.model, props.contextPercent, width - 2);
      const coloredStatus = noColor ? rightStatus : theme.tokens.text.muted(rightStatus);
      return `  ${coloredStatus}`;
    }

    // >= 60 cols: full hint on left, status on right
    // Calculate right status width first
    const maxRightWidth = Math.min(35, Math.floor(width * 0.45));
    const rightStatus = this.formatRightStatus(props.mode, props.model, props.contextPercent, maxRightWidth);
    const rightLen = visibleWidth(rightStatus);

    // Left hint: starts with 2 spaces indent ("  ")
    const leftMargin = 2;
    const rightMargin = 0;
    const minGap = 2;
    const maxHintWidth = Math.max(10, width - leftMargin - rightLen - minGap - rightMargin);

    const truncatedHint = truncateVisible(hintText, maxHintWidth);
    const hintLen = visibleWidth(truncatedHint);

    const gap = Math.max(minGap, width - leftMargin - hintLen - rightLen - rightMargin);
    const spacePadding = ' '.repeat(gap);

    const coloredHint = noColor ? truncatedHint : theme.tokens.text.muted(truncatedHint);

    // Format right status with token colors
    let coloredStatus = rightStatus;
    if (!noColor) {
      // Color mode badge if present
      coloredStatus = theme.tokens.text.muted(rightStatus);
    }

    return `  ${coloredHint}${spacePadding}${coloredStatus}`;
  }
}
