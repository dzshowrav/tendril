/**
 * Model Fallback & Availability Notice Manager.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 8.1, § 8.2).
 *
 * Requirements:
 * - Turn-level fallback chain execution with transcript notices.
 * - Records which model rejected/failed, which model responded, and if permanent.
 * - Session-start availability check without silently overriding user preferences.
 * - Clear guidance when entire fallback chain fails.
 */

import { ActiveTheme } from '../../theme/loader.js';

export interface FallbackAttempt {
  model: string;
  success: boolean;
  error?: string;
  isPermanentSwitch?: boolean;
}

export interface FallbackNotice {
  rejectedModel: string;
  reason: string;
  activeModel?: string;
  isPermanentSwitch: boolean;
  chainAttempts: FallbackAttempt[];
  allFailed: boolean;
}

export function evaluateModelAvailability(options: {
  requestedModel?: string;
  availableModels: string[];
  serviceDefault: string;
  isHeadless?: boolean;
}): { selectedModel: string; notice?: string; willFail: boolean } {
  // If user explicitly provided --model
  if (options.requestedModel) {
    const isAvail = options.availableModels.includes(options.requestedModel);
    if (!isAvail) {
      return {
        selectedModel: options.requestedModel,
        notice: options.isHeadless
          ? undefined
          : `Requested model '${options.requestedModel}' is unavailable on daemon. Request will fail unless changed.`,
        willFail: true,
      };
    }
    return { selectedModel: options.requestedModel, willFail: false };
  }

  // If no model list yet, keep current selection
  if (options.availableModels.length === 0) {
    return { selectedModel: options.serviceDefault, willFail: false };
  }

  // Use service default
  return { selectedModel: options.serviceDefault, willFail: false };
}

export function createFallbackNotice(data: {
  rejectedModel: string;
  reason: string;
  fallbackChain: string[];
  attemptResults: Array<{ model: string; success: boolean; error?: string }>;
  isPermanentSwitch?: boolean;
}): FallbackNotice {
  const successfulAttempt = data.attemptResults.find((a) => a.success);
  const allFailed = !successfulAttempt;

  return {
    rejectedModel: data.rejectedModel,
    reason: data.reason,
    activeModel: successfulAttempt?.model,
    isPermanentSwitch: data.isPermanentSwitch || false,
    chainAttempts: data.attemptResults,
    allFailed,
  };
}

export function formatFallbackNotice(notice: FallbackNotice, theme: ActiveTheme): string {
  const { colors } = theme;
  const lines: string[] = [];

  if (notice.allFailed) {
    lines.push(colors.bold(colors.statusError('✖ Model Fallback Chain Exhausted:')));
    lines.push(colors.textMuted(`  Primary model '${notice.rejectedModel}' failed: ${notice.reason}`));
    lines.push(colors.textMuted('  Fallback chain attempts:'));
    for (const a of notice.chainAttempts) {
      lines.push(colors.textError(`    • ${a.model}: ${a.error || 'Unavailable'}`));
    }
    lines.push(colors.textAccent('\n  Action required: Please switch model using /model <name> or check daemon credentials.'));
    return lines.join('\n');
  }

  // Successful failover
  lines.push(colors.bold(colors.statusWaiting('⚠ Model Fallback Notice:')));
  lines.push(colors.textMuted(`  Model '${notice.rejectedModel}' was unavailable or rejected turn: ${notice.reason}`));
  lines.push(
    colors.textSuccess(
      `  Turn answered by fallback model: ${colors.bold(notice.activeModel || '')}` +
        (notice.isPermanentSwitch ? ' (switched permanently for this session)' : ' (turn-only fallback)'),
    ),
  );

  return lines.join('\n');
}
