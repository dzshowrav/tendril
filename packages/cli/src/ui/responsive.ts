/**
 * Responsive Layout Adapter & Terminal Breakpoints.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 19).
 *
 * Implements 4 responsive column buckets:
 * - wide (>= 100 cols)
 * - normal (60 to 99 cols)
 * - compact (50 to 59 cols)
 * - narrow (< 50 cols)
 *
 * Includes smart middle path truncation and 100ms debounced resize listener.
 */

import { visibleWidth } from './layout-calc.js';

export type BreakpointBucket = 'wide' | 'normal' | 'compact' | 'narrow';

export interface ResponsiveConfig {
  bucket: BreakpointBucket;
  isWide: boolean;
  isNormal: boolean;
  isCompact: boolean;
  isNarrow: boolean;
  twoPaneMonitors: boolean;
  fullFooterHints: boolean;
  panelWidth: number;
}

export function getBreakpoint(columns: number): BreakpointBucket {
  if (columns >= 100) return 'wide';
  if (columns >= 60) return 'normal';
  if (columns >= 50) return 'compact';
  return 'narrow';
}

export function getResponsiveConfig(columns: number): ResponsiveConfig {
  const bucket = getBreakpoint(columns);
  return {
    bucket,
    isWide: bucket === 'wide',
    isNormal: bucket === 'normal',
    isCompact: bucket === 'compact',
    isNarrow: bucket === 'narrow',
    twoPaneMonitors: columns >= 60,
    fullFooterHints: columns >= 60,
    panelWidth: columns >= 100 ? 76 : columns,
  };
}

/**
 * Smart middle path truncation: <start>/…/<end>
 * Used on compact/narrow terminals for file paths in headers & tool cards.
 */
export function truncatePath(path: string, maxWidth: number): string {
  if (visibleWidth(path) <= maxWidth) {
    return path;
  }
  if (maxWidth <= 7) {
    return path.slice(0, Math.max(1, maxWidth - 1)) + '…';
  }

  const parts = path.split('/');
  if (parts.length <= 2) {
    const half = Math.floor((maxWidth - 3) / 2);
    return path.slice(0, half) + '…' + path.slice(-half);
  }

  const filename = parts[parts.length - 1];
  const firstDir = parts[0] || (path.startsWith('/') ? '/' + parts[1] : parts[0]);

  const candidate = `${firstDir}/…/${filename}`;
  if (visibleWidth(candidate) <= maxWidth) {
    return candidate;
  }

  // If even that is too long, truncate filename
  const availForFile = Math.max(3, maxWidth - visibleWidth(firstDir) - 4);
  return `${firstDir}/…/${filename.slice(0, availForFile - 1)}…`;
}

/**
 * Creates a resize handler with 100ms debounce to prevent flicker during terminal resizing.
 */
export function createResizeHandler(
  onResize: (width: number, height: number) => void,
  debounceMs = 100
): { trigger: (width: number, height: number) => void; dispose: () => void } {
  let timer: NodeJS.Timeout | undefined;

  const trigger = (width: number, height: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      onResize(width, height);
    }, debounceMs);
  };

  const dispose = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return { trigger, dispose };
}
