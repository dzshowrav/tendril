import { ToolClass, SessionMode, ToolDecision } from '../store.js';

export { ToolClass, SessionMode, ToolDecision };

export type DecidedBy = 'cli' | 'web' | 'abort' | 'rule' | 'mode';

export type PermissionDecision = Exclude<ToolDecision, null>;

export type GateResult = 'allow' | 'prompt' | 'not_offered';

export interface PermissionEvaluation {
  decision: PermissionDecision;
  decidedBy?: DecidedBy;
  needsPrompt: boolean;
  reason?: string;
  normalizedPattern: string | null;
  canAllowAlways: boolean;
  disallowAlwaysReason?: string;
}

export interface PendingPermissionRequest {
  id: string;
  sessionId: string;
  toolRunId: string;
  tool: string;
  toolClass: ToolClass;
  input: Record<string, unknown>;
  workspacePath: string;
  normalizedPattern: string | null;
  canAllowAlways: boolean;
  disallowAlwaysReason?: string;
  createdAt: string;
  resolved: boolean;
  resolvedAt?: string;
  decision?: 'allow_once' | 'allow_always' | 'deny';
  decidedBy?: DecidedBy;
  decisionNote?: string;
}

export interface ResolveResult {
  status: 'resolved' | 'already_resolved';
  requestId: string;
  request?: PendingPermissionRequest;
  decision?: 'allow_once' | 'allow_always' | 'deny';
}
