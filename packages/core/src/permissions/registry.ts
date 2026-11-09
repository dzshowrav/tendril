import { createId } from '../ids.js';
import { DatabaseStore } from '../store.js';
import {
  PendingPermissionRequest,
  ResolveResult,
  ToolClass,
  DecidedBy,
} from './types.js';

export interface CreateRequestOptions {
  sessionId: string;
  toolRunId: string;
  tool: string;
  toolClass: ToolClass;
  input: Record<string, unknown>;
  workspacePath: string;
  normalizedPattern: string | null;
  canAllowAlways: boolean;
  disallowAlwaysReason?: string;
}

export interface ResolveOptions {
  requestId: string;
  decision: 'allow_once' | 'allow_always' | 'deny';
  decidedBy: DecidedBy;
  note?: string;
}

export class PendingPermissionRegistry {
  private requests = new Map<string, PendingPermissionRequest>();
  private resolvers = new Map<
    string,
    (value: { decision: 'allow_once' | 'allow_always' | 'deny'; decidedBy: DecidedBy; note?: string }) => void
  >();

  constructor(private db?: DatabaseStore) {}

  public setDatabase(db: DatabaseStore): void {
    this.db = db;
  }

  /**
   * Registers a new pending permission request.
   */
  public createRequest(options: CreateRequestOptions): PendingPermissionRequest {
    const id = createId();
    const now = new Date().toISOString();

    const request: PendingPermissionRequest = {
      id,
      sessionId: options.sessionId,
      toolRunId: options.toolRunId,
      tool: options.tool,
      toolClass: options.toolClass,
      input: options.input,
      workspacePath: options.workspacePath,
      normalizedPattern: options.normalizedPattern,
      canAllowAlways: options.canAllowAlways,
      disallowAlwaysReason: options.disallowAlwaysReason,
      createdAt: now,
      resolved: false,
    };

    this.requests.set(id, request);

    // Update tool_run status in database if available
    if (this.db && options.toolRunId) {
      try {
        this.db.updateToolRun(options.toolRunId, {
          status: 'awaiting_permission',
        });
      } catch {
        // Non-fatal if tool run record doesn't exist yet
      }
    }

    return request;
  }

  /**
   * Returns a promise that resolves when the user answers this permission request.
   */
  public waitForAnswer(
    requestId: string,
  ): Promise<{ decision: 'allow_once' | 'allow_always' | 'deny'; decidedBy: DecidedBy; note?: string }> {
    const request = this.requests.get(requestId);
    if (!request) {
      return Promise.reject(new Error(`Permission request '${requestId}' not found`));
    }

    if (request.resolved && request.decision && request.decidedBy) {
      return Promise.resolve({
        decision: request.decision,
        decidedBy: request.decidedBy,
        note: request.decisionNote,
      });
    }

    return new Promise((resolve) => {
      this.resolvers.set(requestId, resolve);
    });
  }

  /**
   * Resolves a pending permission request with first-answer-wins semantics.
   */
  public async resolveRequest(options: ResolveOptions): Promise<ResolveResult> {
    const { requestId, decision, decidedBy, note } = options;
    const request = this.requests.get(requestId);

    if (!request) {
      throw new Error(`Permission request '${requestId}' not found`);
    }

    // First-answer-wins guard
    if (request.resolved) {
      return {
        status: 'already_resolved',
        requestId,
        request,
        decision: request.decision,
      };
    }

    // If allow_always, verify it can be allowed permanently
    if (decision === 'allow_always') {
      if (!request.canAllowAlways) {
        throw new Error(
          `Cannot save 'allow_always' rule: ${request.disallowAlwaysReason || 'Command is not eligible for permanent rule'}`,
        );
      }

      // Persist rule in database
      if (this.db && request.normalizedPattern) {
        const ruleTool =
          request.tool === 'write_file' || request.tool === 'edit_file' ? 'edit' : request.tool;

        // Check if rule already exists to avoid unique constraint error
        const existing = this.db.findPermissionRule(
          request.workspacePath,
          ruleTool,
          request.normalizedPattern,
        );
        if (!existing) {
          this.db.createPermissionRule({
            workspace_path: request.workspacePath,
            tool: ruleTool,
            pattern: request.normalizedPattern,
            decision: 'allow',
          });
        }
      }
    }

    // Mark resolved
    request.resolved = true;
    request.resolvedAt = new Date().toISOString();
    request.decision = decision;
    request.decidedBy = decidedBy;
    request.decisionNote = note;

    // Update database tool_run status
    if (this.db && request.toolRunId) {
      try {
        this.db.updateToolRun(request.toolRunId, {
          decision,
          decided_by: decidedBy,
          decision_note: note,
          status: decision === 'deny' ? 'denied' : 'running',
        });
      } catch {
        // Non-fatal
      }
    }

    // Notify any waiting promise
    const resolver = this.resolvers.get(requestId);
    if (resolver) {
      resolver({ decision, decidedBy, note });
      this.resolvers.delete(requestId);
    }

    return {
      status: 'resolved',
      requestId,
      request,
      decision,
    };
  }

  /**
   * Retrieves a request by ID.
   */
  public getRequest(requestId: string): PendingPermissionRequest | undefined {
    return this.requests.get(requestId);
  }

  /**
   * Lists pending requests (optionally filtered by sessionId).
   */
  public listPending(sessionId?: string): PendingPermissionRequest[] {
    const list: PendingPermissionRequest[] = [];
    for (const req of this.requests.values()) {
      if (!req.resolved) {
        if (!sessionId || req.sessionId === sessionId) {
          list.push(req);
        }
      }
    }
    return list;
  }

  /**
   * Aborts all pending requests for a session with decision: 'deny', decidedBy: 'abort'.
   */
  public async abortSessionRequests(sessionId: string): Promise<ResolveResult[]> {
    const pending = this.listPending(sessionId);
    const results: ResolveResult[] = [];

    for (const req of pending) {
      const res = await this.resolveRequest({
        requestId: req.id,
        decision: 'deny',
        decidedBy: 'abort',
        note: 'Session aborted',
      });
      results.push(res);
    }

    return results;
  }

  /**
   * Cleans up resolved requests.
   */
  public clear(): void {
    this.requests.clear();
    this.resolvers.clear();
  }
}
