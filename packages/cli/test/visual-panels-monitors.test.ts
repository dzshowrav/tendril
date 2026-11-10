import { describe, it, expect } from 'vitest';
import { VisualPanels } from '../src/components/panels/visual-panels.js';
import { VisualWorkflowMonitors } from '../src/components/workflow/visual-monitors.js';
import { VisualReviewScreen } from '../src/components/review/visual-review.js';
import { PermanentNoticePipeline } from '../src/render/notices/permanent-notice.js';
import { stripAnsi, visibleWidth } from '../src/ui/layout-calc.js';
import { ASCII_GLYPHS } from '../src/ui/glyphs.js';

describe('Overlay Panels (Section 11)', () => {
  const panels = new VisualPanels();

  it('renders Context Panel with 30-character progress bar and breakdown table', () => {
    const lines = panels.renderContextPanel({
      usedTokens: 42000,
      limitTokens: 200000,
      breakdown: [
        { source: 'System prompt', tokens: 4000, sharePercent: 2 },
        { source: 'Conversation', tokens: 30000, sharePercent: 15 },
        { source: 'Attached files', tokens: 8000, sharePercent: 4 },
      ],
      width: 76,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('Context');
    expect(clean).toContain('Window');
    expect(clean).toContain('21%  42,000 / 200,000 tok');
    expect(clean).toContain('System prompt');
    expect(clean).toContain('Conversation');
    expect(clean).toContain('a add · r remove · c clear · esc close');
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(76);
    }
  });

  it('renders Model Panel with effort adjuster ‹ low [medium] high ›', () => {
    const lines = panels.renderModelPanel({
      models: [
        { id: 'm1', displayName: 'Claude 3.5 Sonnet', isCurrent: true, isAvailable: true },
        { id: 'm2', displayName: 'Claude 3.5 Haiku', isAvailable: false },
      ],
      selectedIndex: 0,
      effort: 'medium',
      fallbackModel: 'Claude 3.5 Haiku',
      thinkingEnabled: true,
      width: 76,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('Model');
    expect(clean).toContain('Claude 3.5 Sonnet');
    expect(clean).toContain('current');
    expect(clean).toContain('(unavailable)');
    expect(clean).toContain('Effort');
    expect(clean).toContain('[medium]');
    expect(clean).toContain('Fallback    Claude 3.5 Haiku');
    expect(clean).toContain('Thinking    on');
  });
});

describe('Activity Tray & Workflow Monitors (Sections 13, 14, 15)', () => {
  const monitors = new VisualWorkflowMonitors();

  it('renders Activity Tray with task checklist and queued messages', () => {
    const lines = monitors.renderActivityTray({
      tasks: [
        { id: 't1', label: 'Inspect requirements', status: 'done' },
        { id: 't2', label: 'Write unit tests', status: 'in_progress' },
        { id: 't3', label: 'Refactor components', status: 'pending' },
      ],
      queuedMessages: ['Remember to check NO_COLOR mode'],
      width: 76,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('Activity');
    expect(clean).toContain('☒ Inspect requirements');
    expect(clean).toContain('Write unit tests');
    expect(clean).toContain('☐ Refactor components');
    expect(clean).toContain('Queued messages (1)');
    expect(clean).toContain('Remember to check NO_COLOR mode');
  });

  it('renders 2-pane Crew Monitor on >=60 column terminals', () => {
    const lines = monitors.renderCrewMonitor({
      agents: [
        { id: 'a1', name: 'researcher', status: 'running', recentActivity: ['Search(files: "test")'] },
        { id: 'a2', name: 'coder', status: 'success', recentActivity: ['Wrote 2 files'] },
      ],
      selectedAgentIndex: 0,
      width: 76,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('Crew monitor');
    expect(clean).toContain('Agents');
    expect(clean).toContain('Activity: researcher');
    expect(clean).toContain('researcher');
    expect(clean).toContain('Search(files: "test")');
  });

  it('handles 2-step stop arming logic correctly', () => {
    expect(monitors.isStopArmed()).toBe(false);

    // Step 1: Arm
    const first = monitors.armStop();
    expect(first.armed).toBe(true);
    expect(first.message).toContain('Press ctrl+x again to stop');
    expect(monitors.isStopArmed()).toBe(true);

    // Step 2: Confirm
    const second = monitors.armStop();
    expect(second.armed).toBe(false);
    expect(second.message).toContain('stop confirmed');
    expect(monitors.isStopArmed()).toBe(false);
  });
});

describe('Document Review Screen (Section 16)', () => {
  const review = new VisualReviewScreen();

  it('renders review screen with line numbers, gutter, and ▌ staged comments', () => {
    const lines = review.render({
      documentName: 'API_SPEC.md',
      sectionIndex: 1,
      totalSections: 4,
      lines: ['# API Specification', '', 'The endpoint accepts JSON.'],
      startLineNumber: 10,
      stagedComments: [{ lineNumber: 12, text: 'Must validate schema' }],
      width: 76,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('Review: API_SPEC.md   section 1 of 4');
    expect(clean).toContain('10 │ # API Specification');
    expect(clean).toContain('12 │ The endpoint accepts JSON.');
    expect(clean).toContain('│▌ comment: "Must validate schema"');
    expect(clean).toContain('Comments staged: 1');
  });
});

describe('Permanent Notice Pipeline (Section 18)', () => {
  const notices = new PermanentNoticePipeline();

  it('renders info notice with marker i and muted text', () => {
    const lines = notices.renderInfo('Showing source: diagram is wider than terminal');
    expect(stripAnsi(lines[0])).toBe('  i Showing source: diagram is wider than terminal');
  });

  it('renders warning notice with marker ! and details', () => {
    const lines = notices.renderWarning('Model claude-3-5 is unavailable', ['Using claude-3-haiku for this turn']);
    expect(stripAnsi(lines[0])).toBe('  ! Model claude-3-5 is unavailable');
    expect(stripAnsi(lines[1])).toBe('    Using claude-3-haiku for this turn');
  });

  it('renders error notice with marker x and details', () => {
    const lines = notices.renderError('No model could answer this turn', ['Tried: model-a, model-b']);
    expect(stripAnsi(lines[0])).toBe('  x No model could answer this turn');
    expect(stripAnsi(lines[1])).toBe('    Tried: model-a, model-b');
  });

  it('renders interrupted notice: ✗ Interrupted by user', () => {
    const lines = notices.renderInterrupted();
    expect(stripAnsi(lines[0])).toBe('  ✗ Interrupted by user');
  });
});
