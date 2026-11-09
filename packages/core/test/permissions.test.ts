import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseStore } from '../src/store.js';
import {
  SessionMode,
  ToolClass,
  GateResult,
  MODE_MATRIX,
  evaluateModeGate,
  isToolOfferedInMode,
  isCompoundBashCommand,
  normalizeBashCommand,
  normalizeToolPattern,
  matchesPermissionRule,
  PendingPermissionRegistry,
  PermissionEngine,
} from '../src/permissions/index.js';

describe('Permission Engine & Step 6 Contracts', () => {
  let store: DatabaseStore;
  let engine: PermissionEngine;
  const workspacePath = '/home/user/project';
  const sessionId = 'session_test_123';

  beforeEach(() => {
    store = new DatabaseStore(':memory:');
    engine = new PermissionEngine(store);
  });

  // ==========================================
  // 1. Matrix test: class × mode matches TRD table
  // ==========================================
  describe('Mode × Class Matrix Contract', () => {
    const expectedTable: Record<SessionMode, Record<ToolClass, GateResult>> = {
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

    const modes: SessionMode[] = ['plan', 'ask', 'auto-edit', 'yolo'];
    const classes: ToolClass[] = ['read', 'edit', 'exec', 'net', 'system'];

    it('enumerates all 20 mode × class combinations and matches the TRD table exactly', () => {
      let count = 0;
      for (const mode of modes) {
        for (const cls of classes) {
          count++;
          const expected = expectedTable[mode][cls];
          const actualFromMatrix = MODE_MATRIX[mode][cls];
          const actualFromHelper = evaluateModeGate(mode, cls);

          expect(
            actualFromMatrix,
            `MODE_MATRIX mismatch for [${mode}][${cls}]: expected ${expected}, got ${actualFromMatrix}`,
          ).toBe(expected);

          expect(
            actualFromHelper,
            `evaluateModeGate mismatch for [${mode}][${cls}]: expected ${expected}, got ${actualFromHelper}`,
          ).toBe(expected);

          if (expected === 'not_offered') {
            expect(isToolOfferedInMode(mode, cls)).toBe(false);
          } else {
            expect(isToolOfferedInMode(mode, cls)).toBe(true);
          }
        }
      }

      expect(count).toBe(20);
    });
  });

  // ==========================================
  // 2. "Allow always" refusal for compound commands
  // ==========================================
  describe('Refusal of "allow always" for compound commands', () => {
    const compoundCommands = [
      { cmd: 'a && b', reason: 'Logical AND' },
      { cmd: 'npm test && git status', reason: 'Logical AND with real commands' },
      { cmd: 'a || b', reason: 'Logical OR' },
      { cmd: 'npm test || exit 1', reason: 'Logical OR with fallback' },
      { cmd: 'cat file.txt | grep foo', reason: 'Pipe' },
      { cmd: 'echo $(whoami)', reason: 'Command substitution subshell $()' },
      { cmd: 'echo `pwd`', reason: 'Backticks command substitution' },
      { cmd: 'echo "hello" > output.txt', reason: 'Output redirection >' },
      { cmd: 'echo "append" >> log.txt', reason: 'Append redirection >>' },
      { cmd: 'cat < input.txt', reason: 'Input redirection <' },
      { cmd: 'git add . ; git commit -m "msg"', reason: 'Semicolon sequential command' },
      { cmd: 'echo line1\nline2', reason: 'Newline separator' },
      { cmd: 'echo line1\r\nline2', reason: 'CRLF separator' },
    ];

    it('identifies and marks all compound commands as non-eligible for allow_always', () => {
      for (const { cmd, reason } of compoundCommands) {
        expect(isCompoundBashCommand(cmd), `Failed for ${cmd} (${reason})`).toBe(true);

        const norm = normalizeBashCommand(cmd);
        expect(norm.canAllowAlways, `normalizeBashCommand must refuse allow_always for "${cmd}" (${reason})`).toBe(
          false,
        );
        expect(norm.pattern).toBeNull();
        expect(norm.disallowAlwaysReason).toBeDefined();
      }
    });

    it('rejects attempt to resolve a compound command with allow_always in registry', async () => {
      const compoundCmd = 'npm test && rm -rf dist';
      const norm = normalizeBashCommand(compoundCmd);

      const req = engine.registry.createRequest({
        sessionId,
        toolRunId: 'tr_compound_001',
        tool: 'bash',
        toolClass: 'exec',
        input: { command: compoundCmd },
        workspacePath,
        normalizedPattern: norm.pattern,
        canAllowAlways: norm.canAllowAlways,
        disallowAlwaysReason: norm.disallowAlwaysReason,
      });

      await expect(
        engine.registry.resolveRequest({
          requestId: req.id,
          decision: 'allow_always',
          decidedBy: 'cli',
        }),
      ).rejects.toThrow(/Cannot save 'allow_always' rule/i);
    });

    it('allows simple commands to have normalized patterns and allow_always', () => {
      const validCases = [
        { cmd: 'npm test', expected: 'npm test' },
        { cmd: 'npm test -- --watch', expected: 'npm test' },
        { cmd: 'git status', expected: 'git status' },
        { cmd: 'git commit -m "fix"', expected: 'git commit' },
        { cmd: 'ls -la', expected: 'ls' },
        { cmd: 'cargo build --release', expected: 'cargo build' },
      ];

      for (const { cmd, expected } of validCases) {
        expect(isCompoundBashCommand(cmd)).toBe(false);
        const norm = normalizeBashCommand(cmd);
        expect(norm.canAllowAlways).toBe(true);
        expect(norm.pattern).toBe(expected);
      }
    });
  });

  // ==========================================
  // 3. Concurrent double-answer test (first-answer-wins)
  // ==========================================
  describe('Concurrent double-answer (first-answer-wins)', () => {
    it('shows exactly one winner (resolved) and one already_resolved on concurrent answers', async () => {
      const req = engine.registry.createRequest({
        sessionId,
        toolRunId: 'tr_race_001',
        tool: 'bash',
        toolClass: 'exec',
        input: { command: 'npm test' },
        workspacePath,
        normalizedPattern: 'npm test',
        canAllowAlways: true,
      });

      // Simulate simultaneous answers from Web UI and CLI
      const [res1, res2] = await Promise.all([
        engine.registry.resolveRequest({
          requestId: req.id,
          decision: 'allow_once',
          decidedBy: 'cli',
        }),
        engine.registry.resolveRequest({
          requestId: req.id,
          decision: 'deny',
          decidedBy: 'web',
          note: 'denied from web',
        }),
      ]);

      const winners = [res1, res2].filter((r) => r.status === 'resolved');
      const losers = [res1, res2].filter((r) => r.status === 'already_resolved');

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(1);

      // The winner's decision should be locked in the request
      const winner = winners[0];
      const loser = losers[0];

      expect(winner.status).toBe('resolved');
      expect(loser.status).toBe('already_resolved');
      expect(loser.decision).toBe(winner.decision);

      // Verify request state
      const finalReq = engine.registry.getRequest(req.id);
      expect(finalReq?.resolved).toBe(true);
      expect(finalReq?.decision).toBe(winner.decision);
      expect(finalReq?.decidedBy).toBe(winner.request?.decidedBy);
    });
  });

  // ==========================================
  // 4. Decision Pipeline Order & Saved Rules
  // ==========================================
  describe('Decision pipeline order (Hard guard -> Mode gate -> Saved rules -> Prompt)', () => {
    it('step 1: Hard guard blocks catastrophic command even in yolo mode', () => {
      const evalResult = engine.evaluate({
        mode: 'yolo',
        toolName: 'bash',
        toolClass: 'exec',
        input: { command: 'rm -rf /' },
        workspacePath,
      });

      expect(evalResult.decision).toBe('blocked_guard');
      expect(evalResult.needsPrompt).toBe(false);
      expect(evalResult.reason).toContain('Command blocked by safety guard');
    });

    it('step 2: Mode gate auto-allows read tools across all modes', () => {
      for (const mode of ['plan', 'ask', 'auto-edit', 'yolo'] as SessionMode[]) {
        const evalResult = engine.evaluate({
          mode,
          toolName: 'read_file',
          toolClass: 'read',
          input: { path: 'src/index.ts' },
          workspacePath,
        });

        expect(evalResult.decision).toBe('auto_mode');
        expect(evalResult.needsPrompt).toBe(false);
        expect(evalResult.decidedBy).toBe('mode');
      }
    });

    it('step 2: Mode gate refuses mutating tools in plan mode', () => {
      const evalResult = engine.evaluate({
        mode: 'plan',
        toolName: 'write_file',
        toolClass: 'edit',
        input: { path: 'src/file.ts', content: 'test' },
        workspacePath,
      });

      expect(evalResult.decision).toBe('deny');
      expect(evalResult.needsPrompt).toBe(false);
      expect(evalResult.decidedBy).toBe('mode');
      expect(evalResult.reason).toContain('not offered');
    });

    it('step 2: Mode gate auto-allows edit in auto-edit mode', () => {
      const evalResult = engine.evaluate({
        mode: 'auto-edit',
        toolName: 'edit_file',
        toolClass: 'edit',
        input: { path: 'src/file.ts', old_string: 'a', new_string: 'b' },
        workspacePath,
      });

      expect(evalResult.decision).toBe('auto_mode');
      expect(evalResult.needsPrompt).toBe(false);
      expect(evalResult.decidedBy).toBe('mode');
    });

    it('step 3: Saved allow rule auto-approves matching bash command', async () => {
      // Create request and resolve as allow_always
      const req = engine.registry.createRequest({
        sessionId,
        toolRunId: 'tr_rule_001',
        tool: 'bash',
        toolClass: 'exec',
        input: { command: 'npm test' },
        workspacePath,
        normalizedPattern: 'npm test',
        canAllowAlways: true,
      });

      await engine.registry.resolveRequest({
        requestId: req.id,
        decision: 'allow_always',
        decidedBy: 'cli',
      });

      // Next execution of npm test in 'ask' mode should be auto_rule!
      const evalResult = engine.evaluate({
        mode: 'ask',
        toolName: 'bash',
        toolClass: 'exec',
        input: { command: 'npm test -- --watch=false' },
        workspacePath,
      });

      expect(evalResult.decision).toBe('auto_rule');
      expect(evalResult.needsPrompt).toBe(false);
      expect(evalResult.decidedBy).toBe('rule');
    });

    it('step 3: Saved deny rule automatically denies matching tool call', () => {
      store.createPermissionRule({
        workspace_path: workspacePath,
        tool: 'bash',
        pattern: 'git push',
        decision: 'deny',
      });

      const evalResult = engine.evaluate({
        mode: 'ask',
        toolName: 'bash',
        toolClass: 'exec',
        input: { command: 'git push origin main' },
        workspacePath,
      });

      expect(evalResult.decision).toBe('deny');
      expect(evalResult.needsPrompt).toBe(false);
      expect(evalResult.decidedBy).toBe('rule');
      expect(evalResult.reason).toContain('Denied by saved rule');
    });

    it('step 4: Prompts the user when no rule matches in ask mode', () => {
      const evalResult = engine.evaluate({
        mode: 'ask',
        toolName: 'bash',
        toolClass: 'exec',
        input: { command: 'npm run custom-build' },
        workspacePath,
      });

      expect(evalResult.needsPrompt).toBe(true);
      expect(evalResult.decision).toBe('allow_once');
      expect(evalResult.canAllowAlways).toBe(true);
      expect(evalResult.normalizedPattern).toBe('npm run');
    });
  });

  // ==========================================
  // 5. Session Abort handling
  // ==========================================
  describe('Session Abort handling', () => {
    it('aborts all pending permission requests for a session with decision: deny', async () => {
      const req1 = engine.registry.createRequest({
        sessionId,
        toolRunId: 'tr_abort_001',
        tool: 'bash',
        toolClass: 'exec',
        input: { command: 'sleep 10' },
        workspacePath,
        normalizedPattern: 'sleep',
        canAllowAlways: true,
      });

      const req2 = engine.registry.createRequest({
        sessionId,
        toolRunId: 'tr_abort_002',
        tool: 'web_fetch',
        toolClass: 'net',
        input: { url: 'https://example.com' },
        workspacePath,
        normalizedPattern: 'example.com',
        canAllowAlways: true,
      });

      expect(engine.registry.listPending(sessionId).length).toBe(2);

      const abortResults = await engine.registry.abortSessionRequests(sessionId);
      expect(abortResults.length).toBe(2);
      expect(abortResults.every((r) => r.decision === 'deny')).toBe(true);

      expect(engine.registry.listPending(sessionId).length).toBe(0);

      const updatedReq1 = engine.registry.getRequest(req1.id);
      expect(updatedReq1?.resolved).toBe(true);
      expect(updatedReq1?.decision).toBe('deny');
      expect(updatedReq1?.decidedBy).toBe('abort');
    });
  });
});
