import { ToolClass, SessionMode, GateResult } from './types.js';

/**
 * The Mode × Class permission gate matrix defined in docs/02-TRD.md.
 *
 * | Class  | plan        | ask (default) | auto-edit            | yolo                             |
 * | read   | allow       | allow         | allow                | allow                            |
 * | edit   | not offered | prompt        | allow (in workspace) | allow                            |
 * | exec   | not offered | prompt        | prompt               | allow (hard guard still applies) |
 * | net    | not offered | prompt        | prompt               | allow                            |
 * | system | not offered | prompt        | prompt               | prompt                           |
 */
export const MODE_MATRIX: Record<SessionMode, Record<ToolClass, GateResult>> = {
  plan: {
    read: 'allow',
    edit: 'not_offered',
    exec: 'not_offered',
    net: 'not_offered',
    system: 'not_offered',
  },
  ask: {
    read: 'allow',
    edit: 'prompt',
    exec: 'prompt',
    net: 'prompt',
    system: 'prompt',
  },
  'auto-edit': {
    read: 'allow',
    edit: 'allow',
    exec: 'prompt',
    net: 'prompt',
    system: 'prompt',
  },
  yolo: {
    read: 'allow',
    edit: 'allow',
    exec: 'allow',
    net: 'allow',
    system: 'prompt',
  },
};

/**
 * Returns the gate result for a given mode and tool class.
 */
export function evaluateModeGate(mode: SessionMode, toolClass: ToolClass): GateResult {
  const modeGates = MODE_MATRIX[mode];
  if (!modeGates) {
    throw new Error(`Unknown session mode: ${mode}`);
  }
  const result = modeGates[toolClass];
  if (!result) {
    throw new Error(`Unknown tool class: ${toolClass}`);
  }
  return result;
}

/**
 * Returns whether a tool class is offered to the model in the given mode.
 */
export function isToolOfferedInMode(mode: SessionMode, toolClass: ToolClass): boolean {
  return evaluateModeGate(mode, toolClass) !== 'not_offered';
}
