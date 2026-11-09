import { DatabaseStore } from '../store.js';
import { isCatastrophic } from '../tools/guard.js';
import {
  SessionMode,
  ToolClass,
  PermissionEvaluation,
} from './types.js';
import { evaluateModeGate } from './matrix.js';
import {
  normalizeToolPattern,
  matchesPermissionRule,
} from './patterns.js';
import { PendingPermissionRegistry } from './registry.js';

export interface EvaluatePermissionOptions {
  mode: SessionMode;
  toolName: string;
  toolClass: ToolClass;
  input: Record<string, unknown>;
  workspacePath: string;
}

export class PermissionEngine {
  public readonly registry: PendingPermissionRegistry;

  constructor(private db?: DatabaseStore) {
    this.registry = new PendingPermissionRegistry(db);
  }

  public setDatabase(db: DatabaseStore): void {
    this.db = db;
    this.registry.setDatabase(db);
  }

  /**
   * Evaluates a tool call through the strict 4-step decision pipeline:
   * 1. Hard Guard (bash only, catastrophic commands blocked in every mode)
   * 2. Mode Gate (matrix check: allow, prompt, or not_offered)
   * 3. Saved Rules (database permission_rules table lookup)
   * 4. Prompt User (needs approval)
   */
  public evaluate(options: EvaluatePermissionOptions): PermissionEvaluation {
    const { mode, toolName, toolClass, input, workspacePath } = options;
    const patternInfo = normalizeToolPattern(toolName, input);

    // 1. Hard Guard (bash only)
    if (toolName === 'bash') {
      const command = ((input.command as string) || '').trim();
      if (isCatastrophic(command)) {
        return {
          decision: 'blocked_guard',
          decidedBy: 'mode',
          needsPrompt: false,
          reason: `Command blocked by safety guard: matches catastrophic pattern (${command})`,
          normalizedPattern: patternInfo.pattern,
          canAllowAlways: false,
          disallowAlwaysReason: 'Catastrophic command blocked by safety guard',
        };
      }
    }

    // 2. Mode Gate
    const gateResult = evaluateModeGate(mode, toolClass);
    if (gateResult === 'not_offered') {
      return {
        decision: 'deny',
        decidedBy: 'mode',
        needsPrompt: false,
        reason: `Tool '${toolName}' of class '${toolClass}' is not offered in '${mode}' mode`,
        normalizedPattern: patternInfo.pattern,
        canAllowAlways: patternInfo.canAllowAlways,
        disallowAlwaysReason: patternInfo.disallowAlwaysReason,
      };
    }

    if (gateResult === 'allow') {
      return {
        decision: 'auto_mode',
        decidedBy: 'mode',
        needsPrompt: false,
        reason: `Auto-allowed by mode '${mode}' for tool class '${toolClass}'`,
        normalizedPattern: patternInfo.pattern,
        canAllowAlways: patternInfo.canAllowAlways,
        disallowAlwaysReason: patternInfo.disallowAlwaysReason,
      };
    }

    // 3. Saved Rules
    if (this.db) {
      const rules = this.db.listPermissionRules(workspacePath);
      for (const rule of rules) {
        if (matchesPermissionRule(rule.tool, rule.pattern, toolName, input)) {
          if (rule.decision === 'allow') {
            return {
              decision: 'auto_rule',
              decidedBy: 'rule',
              needsPrompt: false,
              reason: `Auto-approved by saved rule '${rule.tool}: ${rule.pattern}'`,
              normalizedPattern: patternInfo.pattern,
              canAllowAlways: patternInfo.canAllowAlways,
              disallowAlwaysReason: patternInfo.disallowAlwaysReason,
            };
          } else if (rule.decision === 'deny') {
            return {
              decision: 'deny',
              decidedBy: 'rule',
              needsPrompt: false,
              reason: `Denied by saved rule '${rule.tool}: ${rule.pattern}'`,
              normalizedPattern: patternInfo.pattern,
              canAllowAlways: patternInfo.canAllowAlways,
              disallowAlwaysReason: patternInfo.disallowAlwaysReason,
            };
          }
        }
      }
    }

    // 4. Prompt the user
    return {
      decision: 'allow_once',
      needsPrompt: true,
      reason: `Requires user permission in mode '${mode}' for class '${toolClass}'`,
      normalizedPattern: patternInfo.pattern,
      canAllowAlways: patternInfo.canAllowAlways,
      disallowAlwaysReason: patternInfo.disallowAlwaysReason,
    };
  }
}
