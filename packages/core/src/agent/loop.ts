import { createId } from '../ids.js';
import { DatabaseStore, SessionRow, ToolRunStatus, ToolDecision } from '../store.js';
import { DecidedBy } from '../permissions/types.js';
import {
  Message,
  Block,
  ProviderAdapter,
  ToolSpec,
} from '../providers/types.js';
import { ToolRegistry, ToolContext } from '../tools/registry.js';
import { WorkspaceGuard } from '../workspace.js';
import { ReadTracker } from '../read-tracker.js';
import { PermissionEngine, isToolOfferedInMode } from '../permissions/index.js';
import {
  TendrilEvent,
  EventSink,
  AgentRunTurnOptions,
} from './types.js';
import { buildSystemPrompt } from './prompt.js';
import {
  prepareContextMessages,
  runCompaction,
  DEFAULT_CONTEXT_WINDOW,
  AUTO_COMPACT_RATIO,
} from './context.js';

export const DEFAULT_MAX_STEPS = 50;

export interface AgentOptions {
  db: DatabaseStore;
  provider: ProviderAdapter;
  toolRegistry: ToolRegistry;
  permissionEngine: PermissionEngine;
  readTracker: ReadTracker;
  workspaceGuard: WorkspaceGuard;
  eventSink?: EventSink;
  maxSteps?: number;
  contextWindow?: number;
}

/**
 * On startup, recovers any sessions that were left in 'running' or 'awaiting_permission' state
 * (e.g. process killed mid-turn) by marking them 'interrupted'.
 */
export function recoverInterruptedSessions(db: DatabaseStore, eventSink?: EventSink): SessionRow[] {
  const stmt = db.db.prepare(
    "SELECT * FROM sessions WHERE status IN ('running', 'awaiting_permission')",
  );
  const rows = stmt.all() as unknown as SessionRow[];

  for (const session of rows) {
    db.updateSession(session.id, { status: 'interrupted' });
    eventSink?.({
      type: 'session.status',
      sessionId: session.id,
      data: { status: 'interrupted' },
    });
  }

  return rows;
}

export class Agent {
  public readonly db: DatabaseStore;
  public readonly provider: ProviderAdapter;
  public readonly toolRegistry: ToolRegistry;
  public readonly permissionEngine: PermissionEngine;
  public readonly readTracker: ReadTracker;
  public readonly workspaceGuard: WorkspaceGuard;
  public readonly eventSink?: EventSink;
  public readonly maxSteps: number;
  public readonly contextWindow: number;

  constructor(options: AgentOptions) {
    this.db = options.db;
    this.provider = options.provider;
    this.toolRegistry = options.toolRegistry;
    this.permissionEngine = options.permissionEngine;
    this.readTracker = options.readTracker;
    this.workspaceGuard = options.workspaceGuard;
    this.eventSink = options.eventSink;
    this.maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;
    this.contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  }

  private emit(event: TendrilEvent): void {
    if (this.eventSink) {
      this.eventSink(event);
    }
  }

  /**
   * Executes a full agent turn (User prompt -> Model -> Tools -> Model -> Final text).
   */
  public async runTurn(options: AgentRunTurnOptions): Promise<{ finalResponse: string; steps: number }> {
    const { sessionId, userPrompt, origin = 'cli', signal } = options;

    const session = this.db.getSession(sessionId);
    if (!session) {
      throw new Error(`Session '${sessionId}' not found`);
    }

    if (session.status === 'running') {
      throw new Error(`Session '${sessionId}' is busy (turn already running)`);
    }

    // Set status to running
    this.db.updateSession(sessionId, { status: 'running' });
    this.emit({
      type: 'session.status',
      sessionId,
      data: { status: 'running' },
    });

    // Create user message in DB
    const userMsg = this.db.createMessage({
      session_id: sessionId,
      role: 'user',
      content_json: JSON.stringify([{ type: 'text', text: userPrompt }]),
      origin,
    });

    this.emit({
      type: 'message.created',
      sessionId,
      data: {
        message: {
          id: userMsg.id,
          sessionId,
          seq: userMsg.seq,
          role: 'user',
          content: [{ type: 'text', text: userPrompt }],
        },
      },
    });

    let currentStep = 0;
    let finalResponse = '';

    // Track consecutive identical failures for stuck-loop detection
    let lastFailedCall: { name: string; inputJson: string; count: number } | null = null;

    try {
      while (currentStep < this.maxSteps) {
        if (signal?.aborted) {
          throw new Error('Turn aborted by signal');
        }

        currentStep++;

        // 1. Prepare context messages and check compaction
        const currentSession = this.db.getSession(sessionId)!;
        let { messages, totalTokens } = prepareContextMessages({
          session: currentSession,
          db: this.db,
        });

        // Auto-compaction check (80% threshold)
        if (totalTokens >= this.contextWindow * AUTO_COMPACT_RATIO) {
          this.emit({
            type: 'compaction',
            sessionId,
            data: { status: 'started' },
          });

          try {
            const compactResult = await runCompaction({
              sessionId,
              provider: this.provider,
              model: currentSession.model,
              db: this.db,
              signal,
            });

            if (compactResult) {
              this.emit({
                type: 'compaction',
                sessionId,
                data: {
                  status: 'done',
                  droppedMessages: compactResult.droppedMessages,
                },
              });

              // Rebuild context messages after compaction
              const refreshed = prepareContextMessages({
                session: this.db.getSession(sessionId)!,
                db: this.db,
              });
              messages = refreshed.messages;
              totalTokens = refreshed.totalTokens;
            }
          } catch {
            this.emit({
              type: 'compaction',
              sessionId,
              data: { status: 'failed' },
            });
          }
        }

        // 2. Build system prompt (re-read AGENTS.md dynamically each step)
        const offeredTools = this.toolRegistry
          .list()
          .filter((t) => isToolOfferedInMode(currentSession.mode, t.class));

        const systemPrompt = buildSystemPrompt({
          workspacePath: currentSession.workspace_path,
          mode: currentSession.mode,
          availableTools: offeredTools.map((t) => t.name),
        });

        const offeredSpecs = this.toolRegistry.getSpecs((t) =>
          isToolOfferedInMode(currentSession.mode, t.class),
        );

        // 3. Call Provider Stream
        const assistantMsgId = createId();
        let accumulatedText = '';
        const accumulatedBlocks: Block[] = [];
        let stopReason: string | null = null;
        let inputTokens = 0;
        let outputTokens = 0;

        const stream = this.provider.stream({
          model: currentSession.model,
          system: systemPrompt,
          messages,
          tools: offeredSpecs,
          maxOutputTokens: 4096,
          signal: signal || new AbortController().signal,
        });

        const toolCallsInProgress = new Map<string, { id: string; name: string; inputJson: string }>();

        for await (const event of stream) {
          if (signal?.aborted) {
            throw new Error('Turn aborted by signal');
          }

          if (event.type === 'text_delta') {
            accumulatedText += event.text;
            this.emit({
              type: 'text.delta',
              sessionId,
              data: {
                messageId: assistantMsgId,
                text: event.text,
              },
            });
          } else if (event.type === 'tool_use_start') {
            toolCallsInProgress.set(event.id, {
              id: event.id,
              name: event.name,
              inputJson: '',
            });
          } else if (event.type === 'tool_use_input_delta') {
            const tc = toolCallsInProgress.get(event.id);
            if (tc) {
              tc.inputJson += event.delta;
            }
          } else if (event.type === 'tool_use_end') {
            const tc = toolCallsInProgress.get(event.id);
            const toolName = event.name || tc?.name || '';
            let parsedInput: unknown = event.input;
            if (parsedInput === undefined) {
              try {
                parsedInput = JSON.parse(tc?.inputJson || '{}');
              } catch {
                parsedInput = {};
              }
            }
            accumulatedBlocks.push({
              type: 'tool_use',
              id: event.id,
              name: toolName,
              input: parsedInput,
            });
            toolCallsInProgress.delete(event.id);
          } else if (event.type === 'usage') {
            inputTokens = event.inputTokens;
            outputTokens = event.outputTokens;

            this.emit({
              type: 'usage',
              sessionId,
              data: {
                inputTokens,
                outputTokens,
                contextTokens: inputTokens + outputTokens,
                contextWindow: this.contextWindow,
              },
            });
          } else if (event.type === 'error') {
            const err = event.error instanceof Error ? event.error : new Error(String(event.error));
            throw err;
          } else if (event.type === 'stop') {
            stopReason = event.reason;
          }
        }

        if (accumulatedText.trim()) {
          accumulatedBlocks.unshift({
            type: 'text',
            text: accumulatedText,
          });
          finalResponse = accumulatedText;
        }

        // Save Assistant message in DB
        const savedAssistant = this.db.createMessage({
          id: assistantMsgId,
          session_id: sessionId,
          role: 'assistant',
          content_json: JSON.stringify(accumulatedBlocks),
          stop_reason: stopReason,
          input_tokens: inputTokens,
          output_tokens: outputTokens,
          origin,
        });

        this.emit({
          type: 'message.created',
          sessionId,
          data: {
            message: {
              id: savedAssistant.id,
              sessionId,
              seq: savedAssistant.seq,
              role: 'assistant',
              content: accumulatedBlocks,
              stopReason,
            },
          },
        });

        // Update session usage statistics
        this.db.updateSession(sessionId, {
          input_tokens: currentSession.input_tokens + inputTokens,
          output_tokens: currentSession.output_tokens + outputTokens,
          context_tokens: inputTokens + outputTokens,
        });

        // Filter out tool calls
        const toolUseBlocks = accumulatedBlocks.filter(
          (b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use',
        );

        // If no tools requested, turn is complete!
        if (toolUseBlocks.length === 0) {
          break;
        }

        // 4. Execute tool calls: parallel read-only tools, sequential mutating tools
        const readOnlyTools = toolUseBlocks.filter((t) => {
          const def = this.toolRegistry.get(t.name);
          return def?.class === 'read';
        });

        const mutatingTools = toolUseBlocks.filter((t) => {
          const def = this.toolRegistry.get(t.name);
          return def?.class !== 'read';
        });

        const toolResultBlocks: Block[] = [];

        // Helper to execute a single tool call with permission check and logging
        const executeToolCall = async (t: Extract<Block, { type: 'tool_use' }>): Promise<Block> => {
          const toolDef = this.toolRegistry.get(t.name);
          const toolClass = toolDef?.class || 'read';
          const inputObj = (t.input as Record<string, unknown>) || {};
          const summary = `${t.name} ${JSON.stringify(inputObj).slice(0, 50)}`;

          // Create tool_runs DB record
          const toolRun = this.db.createToolRun({
            session_id: sessionId,
            message_id: savedAssistant.id,
            tool_use_id: t.id,
            name: t.name,
            class: toolClass,
            input_json: JSON.stringify(inputObj),
            status: 'pending',
          });

          this.emit({
            type: 'tool.start',
            sessionId,
            data: {
              toolRunId: toolRun.id,
              messageId: savedAssistant.id,
              name: t.name,
              input: inputObj,
              summary,
            },
          });

          // Evaluate Permission Pipeline
          const evalResult = this.permissionEngine.evaluate({
            mode: currentSession.mode,
            toolName: t.name,
            toolClass,
            input: inputObj,
            workspacePath: currentSession.workspace_path,
          });

          let permitted = false;
          let decision: ToolDecision = evalResult.decision;
          let decidedBy: DecidedBy | null = evalResult.decidedBy || null;
          let denialReason: string | undefined;

          if (evalResult.decision === 'blocked_guard') {
            permitted = false;
            denialReason = evalResult.reason || 'Blocked by safety hard guard';
            this.db.updateToolRun(toolRun.id, {
              status: 'denied',
              decision: 'blocked_guard',
              decided_by: 'mode',
            });
          } else if (evalResult.needsPrompt) {
            // Awaiting user permission
            this.db.updateSession(sessionId, { status: 'awaiting_permission' });
            this.emit({
              type: 'session.status',
              sessionId,
              data: { status: 'awaiting_permission' },
            });

            const req = this.permissionEngine.registry.createRequest({
              sessionId,
              toolRunId: toolRun.id,
              tool: t.name,
              toolClass,
              input: inputObj,
              workspacePath: currentSession.workspace_path,
              normalizedPattern: evalResult.normalizedPattern,
              canAllowAlways: evalResult.canAllowAlways,
              disallowAlwaysReason: evalResult.disallowAlwaysReason,
            });

            this.emit({
              type: 'tool.permission',
              sessionId,
              data: {
                requestId: req.id,
                toolRunId: toolRun.id,
                name: t.name,
                summary,
                input: inputObj,
                options: {
                  canAllowAlways: evalResult.canAllowAlways,
                  disallowAlwaysReason: evalResult.disallowAlwaysReason,
                  normalizedPattern: evalResult.normalizedPattern,
                },
              },
            });

            const answer = await this.permissionEngine.registry.waitForAnswer(req.id);

            this.emit({
              type: 'permission.resolved',
              sessionId,
              data: {
                requestId: req.id,
                decision: answer.decision,
                by: answer.decidedBy,
              },
            });

            // Restore running status
            this.db.updateSession(sessionId, { status: 'running' });
            this.emit({
              type: 'session.status',
              sessionId,
              data: { status: 'running' },
            });

            decision = answer.decision;
            decidedBy = answer.decidedBy;

            if (answer.decision === 'deny') {
              permitted = false;
              denialReason = `Permission denied by user${answer.note ? ': ' + answer.note : ''}`;
              this.db.updateToolRun(toolRun.id, {
                status: 'denied',
                decision: 'deny',
                decided_by: answer.decidedBy,
                decision_note: answer.note,
              });
            } else {
              permitted = true;
            }
          } else {
            // Auto allowed by mode or saved rule
            permitted = evalResult.decision !== 'deny';
            if (!permitted) {
              denialReason = evalResult.reason || 'Denied by rule/mode';
            }
          }

          if (!permitted) {
            this.emit({
              type: 'tool.end',
              sessionId,
              data: {
                toolRunId: toolRun.id,
                status: 'denied',
                resultPreview: denialReason || 'Denied',
              },
            });

            // Track stuck loop if tool denied
            return {
              type: 'tool_result',
              toolUseId: t.id,
              content: `Error: ${denialReason || 'Action denied'}`,
              isError: true,
            };
          }

          // Execute Tool
          const startTime = Date.now();
          this.db.updateToolRun(toolRun.id, {
            status: 'running',
            decision,
            decided_by: decidedBy,
          });

          const toolContext: ToolContext = {
            sessionId,
            workspace: this.workspaceGuard,
            readTracker: this.readTracker,
            db: this.db,
            toolRunId: toolRun.id,
            signal,
            onOutput: (chunk: string) => {
              this.emit({
                type: 'tool.output',
                sessionId,
                data: {
                  toolRunId: toolRun.id,
                  chunk,
                  stream: 'stdout',
                },
              });
            },
          };

          try {
            const result = await this.toolRegistry.execute(t.name, inputObj, toolContext);
            const durationMs = Date.now() - startTime;

            let resultContent: string;
            let resultPreview: string;
            let exitCode: number | null = null;
            let changeId: string | undefined;

            if (typeof result === 'string') {
              resultContent = result;
              resultPreview = result.slice(0, 500);
            } else if (result && typeof result === 'object') {
              const resObj = result as Record<string, unknown>;
              if (typeof resObj.output === 'string') {
                resultContent = resObj.output;
              } else {
                resultContent = JSON.stringify(result, null, 2);
              }
              resultPreview = resultContent.slice(0, 500);
              if (typeof resObj.exit_code === 'number') {
                exitCode = resObj.exit_code;
              }
              if (typeof resObj.snapshotId === 'string') {
                changeId = resObj.snapshotId;
              }
            } else {
              resultContent = String(result);
              resultPreview = resultContent.slice(0, 500);
            }

            this.db.updateToolRun(toolRun.id, {
              status: 'ok',
              result_preview: resultPreview,
              exit_code: exitCode,
              duration_ms: durationMs,
              finished_at: new Date().toISOString(),
            });

            this.emit({
              type: 'tool.end',
              sessionId,
              data: {
                toolRunId: toolRun.id,
                status: 'ok',
                resultPreview,
                changeId,
                exitCode,
                durationMs,
              },
            });

            // Clear stuck failure tracking on success
            lastFailedCall = null;

            return {
              type: 'tool_result',
              toolUseId: t.id,
              content: resultContent,
              isError: false,
            };
          } catch (err: any) {
            const durationMs = Date.now() - startTime;
            const errorMsg = err?.message || String(err);

            this.db.updateToolRun(toolRun.id, {
              status: 'error',
              result_preview: errorMsg.slice(0, 500),
              duration_ms: durationMs,
              finished_at: new Date().toISOString(),
            });

            this.emit({
              type: 'tool.end',
              sessionId,
              data: {
                toolRunId: toolRun.id,
                status: 'error',
                resultPreview: errorMsg.slice(0, 500),
                durationMs,
              },
            });

            // Stuck Loop Detection: 3 consecutive identical failing calls
            const inputJson = JSON.stringify(inputObj);
            if (
              lastFailedCall &&
              lastFailedCall.name === t.name &&
              lastFailedCall.inputJson === inputJson
            ) {
              lastFailedCall.count++;
              if (lastFailedCall.count >= 3) {
                throw new Error(
                  `Detected stuck loop: tool '${t.name}' with identical inputs failed 3 consecutive times. Halting turn.`,
                );
              }
            } else {
              lastFailedCall = { name: t.name, inputJson, count: 1 };
            }

            return {
              type: 'tool_result',
              toolUseId: t.id,
              content: `Error: ${errorMsg}`,
              isError: true,
            };
          }
        };

        // 4a. Run read-only tools in parallel
        if (readOnlyTools.length > 0) {
          const readResults = await Promise.all(readOnlyTools.map((t) => executeToolCall(t)));
          toolResultBlocks.push(...readResults);
        }

        // 4b. Run mutating tools sequentially
        for (const t of mutatingTools) {
          const res = await executeToolCall(t);
          toolResultBlocks.push(res);
        }

        // 5. Save Tool Results as a user message in DB
        const savedToolMsg = this.db.createMessage({
          session_id: sessionId,
          role: 'user',
          content_json: JSON.stringify(toolResultBlocks),
          origin,
        });

        this.emit({
          type: 'message.created',
          sessionId,
          data: {
            message: {
              id: savedToolMsg.id,
              sessionId,
              seq: savedToolMsg.seq,
              role: 'user',
              content: toolResultBlocks,
            },
          },
        });
      }
    } finally {
      // Return session status to idle
      this.db.updateSession(sessionId, {
        status: 'idle',
        updated_at: new Date().toISOString(),
      });

      this.emit({
        type: 'session.status',
        sessionId,
        data: { status: 'idle' },
      });
    }

    return {
      finalResponse,
      steps: currentStep,
    };
  }
}
