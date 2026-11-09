import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseStore } from '../src/store.js';
import { WorkspaceGuard } from '../src/workspace.js';
import { ReadTracker } from '../src/read-tracker.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { readFileTool, listDirTool, globTool, grepTool, todoWriteTool } from '../src/tools/read-tools.js';
import { writeFileTool, editFileTool, bashTool, webFetchTool } from '../src/tools/mutate-tools.js';
import { PermissionEngine } from '../src/permissions/index.js';
import {
  Agent,
  recoverInterruptedSessions,
  TendrilEvent,
  buildSystemPrompt,
  MAX_INSTRUCTION_FILE_BYTES,
} from '../src/agent/index.js';
import { ProviderAdapter, ProviderEvent, Message, ToolSpec } from '../src/providers/types.js';

// ==========================================
// Fake Scriptable Provider for Testing
// ==========================================
class FakeScriptedProvider implements ProviderAdapter {
  private script: Array<(req: { system: string; messages: Message[] }) => AsyncIterable<ProviderEvent>> = [];
  public capturedRequests: Array<{ system: string; messages: Message[] }> = [];

  public queueStep(handler: (req: { system: string; messages: Message[] }) => AsyncIterable<ProviderEvent>): void {
    this.script.push(handler);
  }

  public async *stream(req: {
    model: string;
    system: string;
    messages: Message[];
    tools: ToolSpec[];
    maxOutputTokens: number;
    signal: AbortSignal;
  }): AsyncIterable<ProviderEvent> {
    this.capturedRequests.push({ system: req.system, messages: req.messages });

    const nextHandler = this.script.shift();
    if (!nextHandler) {
      // Default fallback: return text stop
      yield { type: 'text_delta', text: 'Default response' };
      yield { type: 'usage', inputTokens: 10, outputTokens: 5 };
      yield { type: 'stop', reason: 'end_turn' };
      return;
    }

    for await (const event of nextHandler(req)) {
      yield event;
    }
  }
}

describe('Agent Loop, Prompts & Context Management (Step 7)', () => {
  let tempDir: string;
  let workspace: WorkspaceGuard;
  let readTracker: ReadTracker;
  let store: DatabaseStore;
  let registry: ToolRegistry;
  let permissionEngine: PermissionEngine;
  const sessionId = 'test-session-agent-001';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'tendril-agent-test-'));
    workspace = new WorkspaceGuard(tempDir);
    readTracker = new ReadTracker();
    store = new DatabaseStore(':memory:');
    permissionEngine = new PermissionEngine(store);

    registry = new ToolRegistry();
    registry.register(readFileTool);
    registry.register(listDirTool);
    registry.register(globTool);
    registry.register(grepTool);
    registry.register(todoWriteTool);
    registry.register(writeFileTool);
    registry.register(editFileTool);
    registry.register(bashTool);
    registry.register(webFetchTool);

    store.createSession({
      id: sessionId,
      title: 'Agent Test Session',
      workspace_path: tempDir,
      provider_id: 'test-provider',
      model: 'test-model',
      mode: 'ask',
    });
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  // ==========================================
  // 1. Scripted 3-step task (read -> edit with permission -> final text)
  // ==========================================
  it('runs a 3-step task (read -> edit with permission answer -> final text) and asserts event sequence and DB rows', async () => {
    const filePath = join(tempDir, 'hello.txt');
    writeFileSync(filePath, 'Hello World\n', 'utf8');

    const fakeProvider = new FakeScriptedProvider();
    const emittedEvents: TendrilEvent[] = [];

    // Step 1: Model requests read_file
    fakeProvider.queueStep(async function* () {
      yield { type: 'text_delta', text: 'I will read the file first.' };
      yield { type: 'tool_use_start', id: 'call_read_1', name: 'read_file' };
      yield { type: 'tool_use_input_delta', id: 'call_read_1', delta: JSON.stringify({ path: 'hello.txt' }) };
      yield { type: 'tool_use_end', id: 'call_read_1', name: 'read_file', input: { path: 'hello.txt' } };
      yield { type: 'usage', inputTokens: 50, outputTokens: 20 };
      yield { type: 'stop', reason: 'tool_use' };
    });

    // Step 2: Model requests edit_file
    fakeProvider.queueStep(async function* () {
      yield { type: 'text_delta', text: 'Now editing the file.' };
      yield { type: 'tool_use_start', id: 'call_edit_2', name: 'edit_file' };
      yield {
        type: 'tool_use_input_delta',
        id: 'call_edit_2',
        delta: JSON.stringify({ path: 'hello.txt', old_string: 'World', new_string: 'Termux' }),
      };
      yield {
        type: 'tool_use_end',
        id: 'call_edit_2',
        name: 'edit_file',
        input: { path: 'hello.txt', old_string: 'World', new_string: 'Termux' },
      };
      yield { type: 'usage', inputTokens: 80, outputTokens: 30 };
      yield { type: 'stop', reason: 'tool_use' };
    });

    // Step 3: Model returns final text
    fakeProvider.queueStep(async function* () {
      yield { type: 'text_delta', text: 'All done! hello.txt has been updated to Hello Termux.' };
      yield { type: 'usage', inputTokens: 110, outputTokens: 15 };
      yield { type: 'stop', reason: 'end_turn' };
    });

    const agent = new Agent({
      db: store,
      provider: fakeProvider,
      toolRegistry: registry,
      permissionEngine,
      readTracker,
      workspaceGuard: workspace,
      eventSink: (event) => {
        emittedEvents.push(event);

        // When permission is requested for edit_file, answer it with allow_once
        if (event.type === 'tool.permission') {
          setTimeout(() => {
            permissionEngine.registry.resolveRequest({
              requestId: event.data.requestId,
              decision: 'allow_once',
              decidedBy: 'cli',
            });
          }, 10);
        }
      },
    });

    const result = await agent.runTurn({
      sessionId,
      userPrompt: 'Please change World to Termux in hello.txt',
      origin: 'cli',
    });

    expect(result.steps).toBe(3);
    expect(result.finalResponse).toContain('All done!');

    // 1. Verify file content was modified
    expect(readFileSync(filePath, 'utf8')).toBe('Hello Termux\n');

    // 2. Verify event sequence
    const eventTypes = emittedEvents.map((e) => e.type);
    expect(eventTypes).toContain('session.status');
    expect(eventTypes).toContain('message.created');
    expect(eventTypes).toContain('text.delta');
    expect(eventTypes).toContain('tool.start');
    expect(eventTypes).toContain('tool.end');
    expect(eventTypes).toContain('tool.permission');
    expect(eventTypes).toContain('permission.resolved');
    expect(eventTypes).toContain('usage');

    // 3. Verify DB rows
    const messages = store.listMessages(sessionId);
    expect(messages.length).toBe(6); // user, asst(read), user(result), asst(edit), user(result), asst(final)

    const toolRuns = store.listToolRuns(sessionId);
    expect(toolRuns.length).toBe(2);

    const readRun = toolRuns.find((tr) => tr.name === 'read_file');
    expect(readRun).toBeDefined();
    expect(readRun?.status).toBe('ok');

    const editRun = toolRuns.find((tr) => tr.name === 'edit_file');
    expect(editRun).toBeDefined();
    expect(editRun?.status).toBe('ok');
    expect(editRun?.decision).toBe('allow_once');

    const snapshots = store.listSnapshots(sessionId);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0].path).toBe('hello.txt');

    const session = store.getSession(sessionId);
    expect(session?.status).toBe('idle');
  });

  // ==========================================
  // 2. Forced compaction with tiny context window
  // ==========================================
  it('forces compaction with a tiny context window, stores summary in DB, and compacts subsequent requests', async () => {
    // Populate session with multiple turns (e.g. 8 messages)
    for (let i = 1; i <= 8; i++) {
      store.createMessage({
        session_id: sessionId,
        role: i % 2 === 1 ? 'user' : 'assistant',
        content_json: JSON.stringify([{ type: 'text', text: `Turn ${i}: Content for testing compaction in detail.` }]),
      });
    }

    const fakeProvider = new FakeScriptedProvider();
    const emittedEvents: TendrilEvent[] = [];

    // Step 1 (Summarizer): generated when compaction runs
    fakeProvider.queueStep(async function* () {
      yield { type: 'text_delta', text: 'Compact summary: discussed turns 1 and 2 in detail.' };
      yield { type: 'stop', reason: 'end_turn' };
    });

    // Step 2 (Normal turn reply)
    fakeProvider.queueStep(async function* () {
      yield { type: 'text_delta', text: 'Replying based on compacted context.' };
      yield { type: 'stop', reason: 'end_turn' };
    });

    // Tiny context window (e.g. 50 tokens so total tokens trigger 80% compaction immediately)
    const agent = new Agent({
      db: store,
      provider: fakeProvider,
      toolRegistry: registry,
      permissionEngine,
      readTracker,
      workspaceGuard: workspace,
      contextWindow: 50,
      eventSink: (event) => emittedEvents.push(event),
    });

    const result = await agent.runTurn({
      sessionId,
      userPrompt: 'What was discussed earlier?',
      origin: 'cli',
    });

    expect(result.finalResponse).toBe('Replying based on compacted context.');

    // Verify compaction event was emitted
    const compactionEvent = emittedEvents.find((e) => e.type === 'compaction' && (e as any).data.status === 'done');
    expect(compactionEvent).toBeDefined();

    // Verify summary is stored in DB
    const session = store.getSession(sessionId);
    expect(session?.summary).toContain('Compact summary: discussed turns 1 and 2 in detail.');
    expect(session?.summary_upto_seq).toBeDefined();

    // Verify model received the summary in messages
    const lastRequest = fakeProvider.capturedRequests[fakeProvider.capturedRequests.length - 1];
    const firstMsgText = JSON.stringify(lastRequest.messages[0]);
    expect(firstMsgText).toContain('Previous conversation summary up to turn #');
  });

  // ==========================================
  // 3. Simulated mid-turn crash and startup recovery
  // ==========================================
  it('recovers interrupted sessions on startup when process died mid-turn', () => {
    // Simulate a session that was left running when daemon was killed
    const runningSessionId = 'crashed-session-001';
    store.createSession({
      id: runningSessionId,
      title: 'Crashed Session',
      workspace_path: tempDir,
      provider_id: 'test',
      model: 'test',
      status: 'running',
    });

    const awaitingSessionId = 'crashed-session-002';
    store.createSession({
      id: awaitingSessionId,
      title: 'Awaiting Session',
      workspace_path: tempDir,
      provider_id: 'test',
      model: 'test',
      status: 'awaiting_permission',
    });

    const recoveredEvents: TendrilEvent[] = [];
    const recovered = recoverInterruptedSessions(store, (e) => recoveredEvents.push(e));

    expect(recovered.length).toBe(2);

    // Verify status was updated to 'interrupted' in DB
    expect(store.getSession(runningSessionId)?.status).toBe('interrupted');
    expect(store.getSession(awaitingSessionId)?.status).toBe('interrupted');

    // Verify events were emitted
    expect(recoveredEvents.some((e) => e.sessionId === runningSessionId && (e as any).data.status === 'interrupted')).toBe(
      true,
    );
  });

  // ==========================================
  // 4. AGENTS.md appears in system prompt and is re-read each turn
  // ==========================================
  it('includes workspace AGENTS.md in system prompt and re-reads it dynamically on every turn', async () => {
    const agentsFile = join(tempDir, 'AGENTS.md');
    writeFileSync(agentsFile, 'Project Guideline: Always write unit tests.\n', 'utf8');

    const fakeProvider = new FakeScriptedProvider();

    fakeProvider.queueStep(async function* () {
      yield { type: 'text_delta', text: 'Step 1 response' };
      yield { type: 'stop', reason: 'end_turn' };
    });

    fakeProvider.queueStep(async function* () {
      yield { type: 'text_delta', text: 'Step 2 response' };
      yield { type: 'stop', reason: 'end_turn' };
    });

    const agent = new Agent({
      db: store,
      provider: fakeProvider,
      toolRegistry: registry,
      permissionEngine,
      readTracker,
      workspaceGuard: workspace,
    });

    // Turn 1
    await agent.runTurn({
      sessionId,
      userPrompt: 'First question',
    });

    expect(fakeProvider.capturedRequests[0].system).toContain('Project Guideline: Always write unit tests.');

    // Update AGENTS.md on disk between turns
    writeFileSync(agentsFile, 'Project Guideline: Updated to require Prettier formatting.\n', 'utf8');

    // Turn 2
    await agent.runTurn({
      sessionId,
      userPrompt: 'Second question',
    });

    expect(fakeProvider.capturedRequests[1].system).toContain(
      'Project Guideline: Updated to require Prettier formatting.',
    );
  });

  // ==========================================
  // 5. Instruction file 32 KB truncation & CLAUDE.md fallback
  // ==========================================
  it('truncates instruction files over 32 KB and falls back to CLAUDE.md if AGENTS.md is absent', () => {
    const claudeFile = join(tempDir, 'CLAUDE.md');
    const hugeContent = 'Line of instruction\n'.repeat(3000); // ~60 KB
    writeFileSync(claudeFile, hugeContent, 'utf8');

    const systemPrompt = buildSystemPrompt({
      workspacePath: tempDir,
      mode: 'ask',
      availableTools: ['read_file'],
    });

    expect(systemPrompt).toContain('Project CLAUDE.md (truncated to 32 KB):');
    expect(systemPrompt).toContain('[Note: Project CLAUDE.md was truncated to 32 KB]');
  });

  // ==========================================
  // 6. Stuck loop detection: 3 consecutive identical failing calls
  // ==========================================
  it('detects a stuck loop when a failing tool call repeats 3 times consecutively', async () => {
    const fakeProvider = new FakeScriptedProvider();

    // Queue 3 steps all requesting the exact same failing command
    for (let i = 0; i < 3; i++) {
      fakeProvider.queueStep(async function* () {
        yield { type: 'tool_use_start', id: `call_fail_${i}`, name: 'read_file' };
        yield {
          type: 'tool_use_input_delta',
          id: `call_fail_${i}`,
          delta: JSON.stringify({ path: 'nonexistent-file.txt' }),
        };
        yield {
          type: 'tool_use_end',
          id: `call_fail_${i}`,
          name: 'read_file',
          input: { path: 'nonexistent-file.txt' },
        };
        yield { type: 'stop', reason: 'tool_use' };
      });
    }

    const agent = new Agent({
      db: store,
      provider: fakeProvider,
      toolRegistry: registry,
      permissionEngine,
      readTracker,
      workspaceGuard: workspace,
    });

    await expect(
      agent.runTurn({
        sessionId,
        userPrompt: 'Read the missing file',
      }),
    ).rejects.toThrow(/Detected stuck loop: tool 'read_file' with identical inputs failed 3 consecutive times/i);
  });
});
