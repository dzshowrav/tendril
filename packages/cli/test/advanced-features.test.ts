import { describe, it, expect } from 'vitest';
import { parseDiagram, detectDiagramType } from '../src/diagram/parser.js';
import { paintDiagram } from '../src/diagram/painter.js';
import { renderActivityTray } from '../src/components/activity-tray/tray.js';
import {
  handleMonitorAction,
  renderWorkflowMonitor,
  WorkflowRunState,
} from '../src/components/workflow/monitor.js';
import {
  createReviewState,
  stageComment,
  deleteComment,
  handleReviewNavigation,
  buildRevisionBundle,
  renderDocumentReview,
} from '../src/components/review/document-review.js';
import {
  evaluateModelAvailability,
  createFallbackNotice,
  formatFallbackNotice,
} from '../src/components/model/fallback.js';
import { runUIDoctor, formatDoctorReport } from '../src/commands/doctor.js';
import { resolveActiveTheme } from '../src/theme/loader.js';

describe('Phase 5: Advanced Features (new-ins.md § 5, § 8, § 11, § 12, § 20, § 21)', () => {
  const theme = resolveActiveTheme({ themeName: 'dark' });

  describe('Diagram Parser & Painter (§ 5)', () => {
    it('detects diagram type and ignores classDef/style lines', () => {
      const src = `
graph TD
  A[Start Process] --> B{Is Valid?}
  B -->|Yes| C([Success State])
  B -->|No| D[Error Handler]
  classDef special fill:#f9f
  style A stroke:#333
  class C focal
`;
      expect(detectDiagramType(src)).toBe('flowchart');

      const parsed = parseDiagram(src);
      expect(parsed.isValid).toBe(true);
      expect(parsed.nodes.length).toBe(4);
      expect(parsed.edges.length).toBe(3);

      const nodeB = parsed.nodes.find((n) => n.id === 'B');
      expect(nodeB?.shape).toBe('diamond');

      const nodeC = parsed.nodes.find((n) => n.id === 'C');
      expect(nodeC?.shape).toBe('stadium');
      expect(nodeC?.styleClass).toBe('focal');
    });

    it('handles <br/> tags in node labels', () => {
      const src = `
flowchart LR
  NodeA[Line 1<br/>Line 2<br>Line 3] --> NodeB
`;
      const parsed = parseDiagram(src);
      const nodeA = parsed.nodes.find((n) => n.id === 'NodeA');
      expect(nodeA?.label).toBe('Line 1\nLine 2\nLine 3');
    });

    it('paints diagram with theme tokens and respects fallback rules (§ 5.3)', () => {
      const src = `
graph TD
  A[Step 1] --> B[Step 2]
`;
      const parsed = parseDiagram(src);
      const output = paintDiagram(parsed, theme);
      expect(output).toContain('Step 1');
      expect(output).toContain('Step 2');
      expect(output).toContain('↓');

      // Fallback 1: streaming/incomplete
      const streaming = paintDiagram(parsed, theme, { isStreaming: true });
      expect(streaming).toContain('Drawing diagram...');

      // Fallback 2: ASCII mode active
      const ascii = paintDiagram(parsed, theme, { forceAsciiMode: true });
      expect(ascii).toContain('[Diagram notice: ASCII mode active (TENDRIL_ASCII_MODE)]');
      expect(ascii).toContain('```mermaid');

      // Fallback 3: terminal width too narrow
      const narrow = paintDiagram(parsed, theme, { terminalWidth: 10 });
      expect(narrow).toContain('[Diagram notice: Diagram content exceeds terminal width (10 columns)]');

      // Fallback 4: unsupported syntax
      const unsupported = parseDiagram('unsupportedDiagram\nfoo -> bar');
      const unsupportedOutput = paintDiagram(unsupported, theme);
      expect(unsupportedOutput).toContain('[Diagram notice: Unsupported diagram syntax');
    });
  });

  describe('Activity Tray (§ 11.1)', () => {
    it('renders at-a-glance task progress and queued inputs', () => {
      const rendered = renderActivityTray(
        {
          status: 'working',
          elapsedWorkMs: 4200,
          currentTool: 'read_file',
          queuedMessages: ['Next task step', 'Follow up query'],
          activeSubagents: [{ name: 'researcher', task: 'Searching files' }],
        },
        theme,
      );

      expect(rendered).toContain('Activity Tray (Ctrl+X)');
      expect(rendered).toContain('WORKING');
      expect(rendered).toContain('4.2s');
      expect(rendered).toContain('read_file');
      expect(rendered).toContain('Queued Messages: 2');
      expect(rendered).toContain('Next task step');
      expect(rendered).toContain('researcher: Searching files');
    });
  });

  describe('Workflow Monitor & Two-Step Stop (§ 11.3)', () => {
    const initialRun: WorkflowRunState = {
      runId: 'run_101',
      title: 'Code Refactor Pipeline',
      status: 'running',
      steps: [
        { id: 's1', name: 'Lint Check', status: 'completed', creditCost: 0.05 },
        { id: 's2', name: 'Execute Tests', status: 'running', outputPreview: 'Running vitest suite...' },
      ],
      activeStepId: 's2',
      isStopArmed: false,
    };

    it('enforces two-step stop contract (first press arms, second confirms)', () => {
      // First press: arm stop
      const step1 = handleMonitorAction(initialRun, 's');
      expect(step1.actionTaken).toBe('armed');
      expect(step1.newState.isStopArmed).toBe(true);
      expect(step1.newState.status).toBe('running'); // not stopped yet!

      const armedRender = renderWorkflowMonitor(step1.newState, theme);
      expect(armedRender).toContain('STOP ARMED');

      // Esc disarms stop
      const step1Esc = handleMonitorAction(step1.newState, 'esc');
      expect(step1Esc.actionTaken).toBe('disarmed');
      expect(step1Esc.newState.isStopArmed).toBe(false);

      // Re-arm and confirm
      const rearmed = handleMonitorAction(initialRun, 's');
      const step2 = handleMonitorAction(rearmed.newState, 's');
      expect(step2.actionTaken).toBe('stopped');
      expect(step2.newState.status).toBe('failed');
      expect(step2.newState.steps.find((s) => s.id === 's2')?.status).toBe('cancelled');
    });

    it('supports cooperative pause and resume', () => {
      const paused = handleMonitorAction(initialRun, 'p');
      expect(paused.actionTaken).toBe('paused');
      expect(paused.newState.status).toBe('paused');

      const resumed = handleMonitorAction(paused.newState, 'r');
      expect(resumed.actionTaken).toBe('resumed');
      expect(resumed.newState.status).toBe('running');
    });
  });

  describe('Document Review Screen (§ 12)', () => {
    const docContent = 'line 1: import modules\nline 2: export function init()\nline 3: const x = 42;';

    it('stages comments and bundles them into unified revision request', () => {
      let state = createReviewState({
        title: 'config.ts',
        content: docContent,
      });

      // Stage comments
      state = stageComment(state, 1, 'Rename function to setup()');
      state = stageComment(state, 2, 'Make this constant configurable');

      expect(state.stagedComments.size).toBe(2);

      // Re-entering checkpoint preserves comments
      const restored = createReviewState({
        title: 'config.ts',
        content: docContent,
        existingComments: Array.from(state.stagedComments.values()),
      });
      expect(restored.stagedComments.size).toBe(2);

      // Unified revision bundle
      const bundle = buildRevisionBundle(restored);
      expect(bundle).toContain('Revision Feedback for config.ts (2 comments):');
      expect(bundle).toContain('Line 2 ["line 2: export function init()"]: Rename function to setup()');
      expect(bundle).toContain('Line 3 ["line 3: const x = 42;"]: Make this constant configurable');

      // Delete comment
      const deleted = deleteComment(restored, 1);
      expect(deleted.stagedComments.size).toBe(1);
    });

    it('supports vim-style navigation and help toggle', () => {
      let state = createReviewState({
        title: 'test.ts',
        content: docContent,
      });

      state = handleReviewNavigation(state, 'j');
      expect(state.currentLine).toBe(1);

      state = handleReviewNavigation(state, 'G');
      expect(state.currentLine).toBe(2);

      state = handleReviewNavigation(state, 'g');
      expect(state.currentLine).toBe(0);

      // Toggle help
      state = handleReviewNavigation(state, '?');
      expect(state.showHelp).toBe(true);

      const rendered = renderDocumentReview(state, theme);
      expect(rendered).toContain('Shortcut Reference:');
      expect(rendered).toContain('j/k or ↑/↓');
    });
  });

  describe('Model Fallback & Availability (§ 8.1, § 8.2)', () => {
    it('evaluates model availability without silently overriding user choice', () => {
      // User explicitly requested model that is unavailable
      const evalExplicit = evaluateModelAvailability({
        requestedModel: 'unsupported-model',
        availableModels: ['gemini-2.5-flash', 'claude-3-5-sonnet'],
        serviceDefault: 'gemini-2.5-flash',
      });
      expect(evalExplicit.selectedModel).toBe('unsupported-model');
      expect(evalExplicit.willFail).toBe(true);
      expect(evalExplicit.notice).toContain("Requested model 'unsupported-model' is unavailable");

      // Valid requested model
      const evalValid = evaluateModelAvailability({
        requestedModel: 'gemini-2.5-flash',
        availableModels: ['gemini-2.5-flash'],
        serviceDefault: 'gemini-2.5-flash',
      });
      expect(evalValid.willFail).toBe(false);
    });

    it('formats fallback notice for turn-level failover and chain exhaustion', () => {
      const successNotice = createFallbackNotice({
        rejectedModel: 'claude-3-opus',
        reason: 'Rate limit exceeded (HTTP 429)',
        fallbackChain: ['gemini-2.5-flash'],
        attemptResults: [
          { model: 'claude-3-opus', success: false, error: 'HTTP 429' },
          { model: 'gemini-2.5-flash', success: true },
        ],
      });
      expect(successNotice.allFailed).toBe(false);
      expect(successNotice.activeModel).toBe('gemini-2.5-flash');

      const renderedSuccess = formatFallbackNotice(successNotice, theme);
      expect(renderedSuccess).toContain("Model 'claude-3-opus' was unavailable or rejected turn");
      expect(renderedSuccess).toContain('Turn answered by fallback model: gemini-2.5-flash');

      // All models failed
      const failNotice = createFallbackNotice({
        rejectedModel: 'model-a',
        reason: 'Network timeout',
        fallbackChain: ['model-b'],
        attemptResults: [
          { model: 'model-a', success: false, error: 'Timeout' },
          { model: 'model-b', success: false, error: 'Connection refused' },
        ],
      });
      expect(failNotice.allFailed).toBe(true);
      const renderedFail = formatFallbackNotice(failNotice, theme);
      expect(renderedFail).toContain('Model Fallback Chain Exhausted:');
      expect(renderedFail).toContain('Please switch model using /model <name>');
    });
  });

  describe('Doctor Diagnostic Command (§ 14, § 20)', () => {
    it('runs UI diagnostic checks and generates formatted report', () => {
      const report = runUIDoctor();
      expect(report.checks.length).toBeGreaterThanOrEqual(4);
      expect(report.checks.some((c) => c.name === 'Color Support')).toBe(true);
      expect(report.checks.some((c) => c.name === 'Synchronized Output')).toBe(true);
      expect(report.checks.some((c) => c.name === 'Opt-Out Variables')).toBe(true);

      const rendered = formatDoctorReport(report, theme);
      expect(rendered).toContain('Tendril Terminal Capability Doctor');
      expect(rendered).toContain('Color Support:');
      expect(rendered).toContain('Troubleshooting Advice:');
    });
  });
});
