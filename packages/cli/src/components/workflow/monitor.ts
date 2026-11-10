/**
 * Workflow Monitor Component.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 11.3).
 *
 * Requirements:
 * - Step tree, active step output, run status, credit/token usage.
 * - Cooperative Pause, Resume/Retry (shown only when applicable), Reply to paused step.
 * - Two-step Stop: first press arms stop, second press confirms, Esc disarms/cancels.
 *   (Acceptance criterion: Stop cannot be triggered accidentally in a single press).
 */

import { ActiveTheme, stripAnsi } from '../../theme/loader.js';

export interface WorkflowStep {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  outputPreview?: string;
  creditCost?: number;
}

export interface WorkflowRunState {
  runId: string;
  title: string;
  status: 'running' | 'paused' | 'failed' | 'completed';
  steps: WorkflowStep[];
  activeStepId: string;
  isStopArmed: boolean;
}

export function handleMonitorAction(
  state: WorkflowRunState,
  actionKey: 'p' | 's' | 'r' | 'esc',
): { newState: WorkflowRunState; actionTaken?: string } {
  // Esc disarms stop or exits
  if (actionKey === 'esc') {
    if (state.isStopArmed) {
      return { newState: { ...state, isStopArmed: false }, actionTaken: 'disarmed' };
    }
    return { newState: state, actionTaken: 'close' };
  }

  // Two-step Stop (§ 11.3)
  if (actionKey === 's') {
    if (!state.isStopArmed) {
      // Step 1: Arm stop
      return { newState: { ...state, isStopArmed: true }, actionTaken: 'armed' };
    } else {
      // Step 2: Confirm stop
      const updatedSteps = state.steps.map((s) =>
        s.status === 'running' ? { ...s, status: 'cancelled' as const } : s,
      );
      return {
        newState: {
          ...state,
          status: 'failed',
          isStopArmed: false,
          steps: updatedSteps,
        },
        actionTaken: 'stopped',
      };
    }
  }

  // Any other action resets armed state
  const resetState = { ...state, isStopArmed: false };

  // Cooperative Pause
  if (actionKey === 'p' && state.status === 'running') {
    const updatedSteps = resetState.steps.map((s) =>
      s.id === resetState.activeStepId ? { ...s, status: 'paused' as const } : s,
    );
    return {
      newState: { ...resetState, status: 'paused', steps: updatedSteps },
      actionTaken: 'paused',
    };
  }

  // Resume / Retry (only when paused or failed)
  if (actionKey === 'r' && (state.status === 'paused' || state.status === 'failed')) {
    const updatedSteps = resetState.steps.map((s) =>
      s.id === resetState.activeStepId ? { ...s, status: 'running' as const } : s,
    );
    return {
      newState: { ...resetState, status: 'running', steps: updatedSteps },
      actionTaken: 'resumed',
    };
  }

  return { newState: resetState };
}

export function renderWorkflowMonitor(
  state: WorkflowRunState,
  theme: ActiveTheme,
  width = 76,
): string {
  const { colors, symbols } = theme;
  const innerW = width - 2;
  const lines: string[] = [];

  // Top header
  const title = ` Workflow Monitor: ${state.title} (${state.runId}) `;
  lines.push(
    colors.borderFocus(symbols.boxTopLeft + symbols.boxHorizontal) +
      colors.bold(colors.textPrimary(title)) +
      colors.borderFocus(symbols.boxHorizontal.repeat(Math.max(0, innerW - stripAnsi(title).length - 1)) + symbols.boxTopRight),
  );

  // Status banner
  const statusDisplay =
    state.status === 'running'
      ? colors.statusRunning('● RUNNING')
      : state.status === 'paused'
        ? colors.statusWaiting('⏸ PAUSED (cooperative stop)')
        : state.status === 'failed'
          ? colors.statusError('✖ FAILED / STOPPED')
          : colors.statusSuccess('✔ COMPLETED');

  lines.push(
    colors.borderDefault(symbols.boxVertical) +
      `  Status: ${statusDisplay}` +
      ' '.repeat(Math.max(0, innerW - stripAnsi(statusDisplay).length - 10)) +
      colors.borderDefault(symbols.boxVertical),
  );

  // Divider
  lines.push(
    colors.borderDefault(
      symbols.boxDividerLeft + symbols.boxHorizontal.repeat(innerW) + symbols.boxDividerRight,
    ),
  );

  // Step tree
  lines.push(
    colors.borderDefault(symbols.boxVertical) +
      colors.textAccent('  Step Execution Tree:') +
      ' '.repeat(Math.max(0, innerW - 22)) +
      colors.borderDefault(symbols.boxVertical),
  );

  for (const step of state.steps) {
    const isActive = step.id === state.activeStepId;
    const prefix = isActive ? '  ➔ ' : '    ';
    const statusIcon =
      step.status === 'completed'
        ? colors.textSuccess('✔')
        : step.status === 'running'
          ? colors.statusRunning('●')
          : step.status === 'paused'
            ? colors.statusWaiting('⏸')
            : step.status === 'failed' || step.status === 'cancelled'
              ? colors.statusError('✖')
              : colors.textMuted('○');

    const costStr = step.creditCost !== undefined ? colors.dim(` ($${step.creditCost.toFixed(2)})`) : '';
    const lineContent = `${prefix}${statusIcon} ${step.name}${costStr}`;
    const visibleLen = stripAnsi(lineContent).length;

    lines.push(
      colors.borderDefault(symbols.boxVertical) +
        lineContent +
        ' '.repeat(Math.max(0, innerW - visibleLen)) +
        colors.borderDefault(symbols.boxVertical),
    );
  }

  // Active step output preview
  const activeStep = state.steps.find((s) => s.id === state.activeStepId);
  if (activeStep?.outputPreview) {
    lines.push(
      colors.borderDefault(
        symbols.boxDividerLeft + symbols.boxHorizontal.repeat(innerW) + symbols.boxDividerRight,
      ),
    );
    lines.push(
      colors.borderDefault(symbols.boxVertical) +
        colors.textMuted(`  Output: ${activeStep.outputPreview.slice(0, innerW - 12)}`) +
        ' '.repeat(Math.max(0, innerW - activeStep.outputPreview.slice(0, innerW - 12).length - 10)) +
        colors.borderDefault(symbols.boxVertical),
    );
  }

  // Bottom action bar (§ 11.3)
  lines.push(
    colors.borderDefault(
      symbols.boxDividerLeft + symbols.boxHorizontal.repeat(innerW) + symbols.boxDividerRight,
    ),
  );

  // Stop armed warning vs standard controls
  let controlsStr = '';
  if (state.isStopArmed) {
    controlsStr = colors.bold(colors.statusError(' ⚠️ STOP ARMED: Press "s" again to CONFIRM STOP or Esc to cancel '));
  } else {
    const availableActions: string[] = [];
    if (state.status === 'running') availableActions.push('p: pause');
    if (state.status === 'paused' || state.status === 'failed') availableActions.push('r: resume/retry');
    availableActions.push('s: stop (2-step)');
    availableActions.push('Esc: close');
    controlsStr = colors.textMuted(' ' + availableActions.join(' · ') + ' ');
  }

  const controlsLen = stripAnsi(controlsStr).length;
  lines.push(
    colors.borderFocus(symbols.boxBottomLeft) +
      controlsStr +
      colors.borderFocus(symbols.boxHorizontal.repeat(Math.max(0, innerW - controlsLen)) + symbols.boxBottomRight),
  );

  return lines.join('\n');
}
