import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';

export interface CollapsibleOptions {
  maxHead?: number;
  maxTail?: number;
  isExpanded?: boolean;
  theme?: ActiveTheme;
}

/**
 * Collapses long tool or shell output into head + tail view with expansion hint.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 6.4).
 */
export function formatHeadTailOutput(
  lines: string[],
  options?: CollapsibleOptions,
): string[] {
  const maxHead = options?.maxHead ?? 5;
  const maxTail = options?.maxTail ?? 5;
  const isExpanded = options?.isExpanded ?? false;
  const theme = options?.theme || resolveActiveTheme();

  if (lines.length <= maxHead + maxTail || isExpanded) {
    return lines.map((l) => `  ${theme.colors.textMuted(l)}`);
  }

  const omittedCount = lines.length - (maxHead + maxTail);
  const head = lines.slice(0, maxHead).map((l) => `  ${theme.colors.textMuted(l)}`);
  const tail = lines.slice(-maxTail).map((l) => `  ${theme.colors.textMuted(l)}`);
  const omissionLine = `  ${theme.colors.borderFocus(`┄┄┄ [${omittedCount} lines collapsed · Ctrl+O to expand] ┄┄┄`)}`;

  return [...head, omissionLine, ...tail];
}
