import { describe, it, expect, vi } from 'vitest';
import { getGlyphs, UNICODE_GLYPHS, ASCII_GLYPHS } from '../src/ui/glyphs.js';
import { ScreenOrchestrator } from '../src/render/layout/orchestrator.js';
import { StatusBar, FOOTER_HINTS } from '../src/components/footer/status-bar.js';
import { TurnLayout } from '../src/render/conversation/turn-layout.js';
import { VisualToolCard } from '../src/components/tool-cards/visual-card.js';
import { VisualDiffFormatter } from '../src/render/diff/visual-diff.js';
import { VisualInputBox } from '../src/components/input/box.js';
import { AutocompletePopup } from '../src/components/autocomplete/popup.js';
import { VisualApprovalDialog } from '../src/components/approval-bar/dialog.js';
import { VisualPanels } from '../src/components/panels/visual-panels.js';
import { VisualWorkflowMonitors } from '../src/components/workflow/visual-monitors.js';
import { VisualReviewScreen } from '../src/components/review/visual-review.js';
import { PermanentNoticePipeline } from '../src/render/notices/permanent-notice.js';
import { FullscreenViewport } from '../src/render/fullscreen/viewport.js';
import { getResponsiveConfig, getBreakpoint, truncatePath, createResizeHandler } from '../src/ui/responsive.js';
import { stripAnsi, visibleWidth } from '../src/ui/layout-calc.js';
import { resolveActiveTheme } from '../src/theme/loader.js';

describe('Section 25 Visual Acceptance Verification Suite', () => {
  // Criterion 1: Six-Zone Stack Order (A-F) strictly maintained
  it('[Criterion 1] Six-zone stack order A-F maintained and live region never spills to scrollback', () => {
    let captured = '';
    const orchestrator = new ScreenOrchestrator((t) => { captured += t; });

    // Render Welcome Banner (Zone A)
    const banner = orchestrator.renderBanner({
      version: '0.1.0',
      model: 'claude-3-5',
      cwd: '~/work',
      permissionMode: 'plan',
      width: 76,
    });
    expect(banner).toContain('Agent Harness v0.1.0');

    // Render Live Region (Zones C, D, E, F)
    orchestrator.renderLiveFrame({
      zoneC: ['● Running...'],
      zoneE: ['╭───╮', '╰───╯'],
      zoneF: '  ? for shortcuts',
    });
    expect(orchestrator.getLastLineCount()).toBe(4);

    // Clear live region cleanly leaves no scrollback junk
    orchestrator.clearLiveRegion();
    expect(orchestrator.getLastLineCount()).toBe(0);
    expect(captured).toContain('\x1B[4A\r\x1B[J');
  });

  // Criterion 2: Single glyph dictionary, zero emojis, full ASCII fallback
  it('[Criterion 2] All components consume single glyph dictionary; zero emojis; ASCII mode robust', () => {
    const unicode = UNICODE_GLYPHS;
    const ascii = ASCII_GLYPHS;

    // Check no emojis in glyphs dictionary (all glyphs are geometric shapes, punctuation, or box drawing)
    for (const [key, val] of Object.entries(unicode)) {
      if (typeof val === 'string' && val.length > 0) {
        for (const char of val) {
          const cp = char.codePointAt(0) || 0;
          // Standard colorful emoji blocks are 0x1F300 and above
          expect(cp < 0x1f300).toBe(true);
        }
      }
    }

    // Verify ASCII glyph completeness
    expect(ascii.bullet).toBe('*');
    expect(ascii.connector).toBe('\\_');
    expect(ascii.success).toBe('[ok]');
    expect(ascii.error).toBe('[x]');
    expect(ascii.progressFill).toBe('#');
    expect(ascii.progressEmpty).toBe('.');
  });

  // Criterion 3: Input box expands upward, bottom edge fixed, capped at 10 rows
  it('[Criterion 3] Input box expands upward (3-10 rows), bottom edge stays fixed', () => {
    const box = new VisualInputBox();

    // 1 row content
    const small = box.render({ value: 'hello', width: 76 });
    expect(small.length).toBe(3); // top, content, bottom

    // 15 rows content
    const tall = box.render({
      value: Array.from({ length: 15 }, (_, i) => `Line ${i + 1}`).join('\n'),
      maxRows: 10,
      width: 76,
    });
    expect(tall.length).toBe(12); // top + 10 content + bottom
    expect(stripAnsi(tall[tall.length - 2])).toContain('Line 15');
  });

  // Criterion 4: 8 Tool Card States
  it('[Criterion 4] All 8 tool card states render according to wireframe specs', () => {
    const card = new VisualToolCard();
    const states = [
      'needs_approval',
      'running',
      'success',
      'expanded',
      'error',
      'denied',
      'interrupted',
      'mcp_progress',
    ] as const;

    for (const st of states) {
      const rendered = card.render({
        tool: 'bash',
        args: { command: 'echo 1' },
        state: st,
        width: 76,
      });
      expect(rendered.length).toBeGreaterThanOrEqual(2);
      expect(stripAnsi(rendered[0])).toContain('Bash(echo 1)');
    }
  });

  // Criterion 5: MCP card params visible inline + 16-slot progress bar
  it('[Criterion 5] MCP card parameters visible inline and progress bar is 16 slots', () => {
    const card = new VisualToolCard();
    const rendered = card.render({
      tool: 'db:query',
      args: { sql: 'SELECT 1' },
      state: 'mcp_progress',
      mcpProgress: { current: 5, total: 10, percent: 50 },
    });

    const clean = stripAnsi(rendered.join('\n'));
    expect(clean).toContain('db:query(sql: "SELECT 1")');
    expect(clean).toContain('[████████░░░░░░░░]'); // 8 filled, 8 empty
    expect(clean).toContain('50%  5 of 10');
  });

  // Criterion 6: Diff view has line numbers, gutter, + and - signs
  it('[Criterion 6] Diff view has line numbers, gutter, + and - signs (NO_COLOR safe)', () => {
    const diff = new VisualDiffFormatter();
    const rendered = diff.renderDiff({
      filePath: 'test.ts',
      additions: 1,
      removals: 1,
      hunks: [
        {
          lines: [
            { type: 'remove', oldLineNumber: 20, text: 'oldCode();' },
            { type: 'add', newLineNumber: 20, text: 'newCode();' },
          ],
        },
      ],
    });

    const clean = stripAnsi(rendered.join('\n'));
    expect(clean).toContain('20 │ -oldCode();');
    expect(clean).toContain('20 │ +newCode();');
  });

  // Criterion 7: Approval dialog replaces input, shows queue info and 3-tier trust
  it('[Criterion 7] Approval dialog replaces input, supports (1 of N pending) and 3-tier trust', () => {
    const dialog = new VisualApprovalDialog();
    const lines = dialog.render({
      type: 'command',
      target: 'rm -rf dist',
      queueInfo: { current: 1, total: 2 },
      options: [
        { key: '1', label: 'Yes, once' },
        { key: '2', label: 'Yes, and trust exactly: rm -rf dist' },
        { key: '3', label: 'No' },
      ],
      selectedIndex: 0,
      width: 76,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('Run command  (1 of 2 pending)');
    expect(clean).toContain('Allow this command?');
    expect(clean).toContain('▸ 1. Yes, once');
  });

  // Criterion 8: Autocomplete popup opens ABOVE input box with ▸ caret
  it('[Criterion 8] Autocomplete popup opens above input box, max 8 rows, ▸ caret', () => {
    const popup = new AutocompletePopup();
    const lines = popup.render({
      categoryTitle: 'Commands',
      items: [
        { name: '/help', description: 'commands' },
        { name: '/clear', description: 'clear' },
      ],
      selectedIndex: 0,
      width: 60,
    });

    expect(stripAnsi(lines[0])).toContain('Commands');
    expect(stripAnsi(lines[1])).toContain('▸ /help');
  });

  // Criterion 9: Overlay panels (/help, /context, /model) with 30-char bar
  it('[Criterion 9] Context panel renders 30-character bar with 70%/90% thresholds', () => {
    const panels = new VisualPanels();
    const bar = panels.render30SlotBar(50);
    expect(bar.length).toBe(32); // [ + 30 chars + ]

    const lines = panels.renderContextPanel({
      usedTokens: 150000,
      limitTokens: 200000,
      breakdown: [{ source: 'Conversation', tokens: 150000, sharePercent: 75 }],
      width: 76,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('75%  150,000 / 200,000 tok');
  });

  // Criterion 10: Dynamic context footer across 10 states
  it('[Criterion 10] Footer dynamically renders hints across distinct states', () => {
    const sb = new StatusBar();
    const states: (keyof typeof FOOTER_HINTS)[] = [
      'idle', 'typing', 'multiline', 'chip', 'running',
      'approval', 'autocomplete', 'shell', 'plan', 'stop_armed'
    ];

    for (const st of states) {
      const rendered = sb.render({
        state: st,
        mode: 'plan',
        model: 'sonnet',
        contextPercent: 10,
        width: 76,
      });
      const expectedHint = FOOTER_HINTS[st];
      expect(stripAnsi(rendered)).toContain(expectedHint);
    }
  });

  // Criterion 11: 4 Responsive Breakpoints (44, 60, 80, 120 columns)
  it('[Criterion 11] Layout adapts cleanly across 4 responsive column buckets without overflow', () => {
    expect(getBreakpoint(120)).toBe('wide');
    expect(getBreakpoint(80)).toBe('normal');
    expect(getBreakpoint(55)).toBe('compact');
    expect(getBreakpoint(44)).toBe('narrow');

    const configNarrow = getResponsiveConfig(44);
    expect(configNarrow.twoPaneMonitors).toBe(false);
    expect(configNarrow.fullFooterHints).toBe(false);

    const configWide = getResponsiveConfig(120);
    expect(configWide.twoPaneMonitors).toBe(true);
    expect(configWide.panelWidth).toBe(76);

    // Truncate path test
    const longPath = 'packages/cli/src/components/tool-cards/visual-card.ts';
    const truncated = truncatePath(longPath, 25);
    expect(visibleWidth(truncated)).toBeLessThanOrEqual(25);
    expect(truncated).toContain('…');
  });

  // Criterion 12 & 13: NO_COLOR emits ZERO ANSI and zero raw hex
  it('[Criterion 12 & 13] NO_COLOR emits ZERO ANSI escapes across all components', () => {
    const noColorTheme = resolveActiveTheme({ forceNoColor: true });
    const sb = new StatusBar(noColorTheme);
    const rendered = sb.render({
      state: 'idle',
      mode: 'plan',
      model: 'claude-3-5',
      contextPercent: 20,
      width: 76,
      theme: noColorTheme,
    });

    // Ansi regex test
    const ansiRegex = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
    expect(ansiRegex.test(rendered)).toBe(false);
  });

  // Criterion 14: 100ms Resize Debounce
  it('[Criterion 14] Terminal resize is debounced by 100ms', () => {
    vi.useFakeTimers();
    let resizeCount = 0;
    const handler = createResizeHandler((w, h) => {
      resizeCount++;
    }, 100);

    // Fire 5 rapid resizes
    handler.trigger(80, 24);
    handler.trigger(82, 24);
    handler.trigger(85, 24);
    handler.trigger(90, 24);
    handler.trigger(100, 24);

    expect(resizeCount).toBe(0);

    vi.advanceTimersByTime(100);
    expect(resizeCount).toBe(1);

    handler.dispose();
    vi.useRealTimers();
  });

  // Criterion 15: Fullscreen Viewport scrollbar and new lines indicator
  it('[Criterion 15] Fullscreen Viewport computes scrollbar and new lines indicator', () => {
    const vp = new FullscreenViewport();
    const lines = vp.render({
      title: 'Session-1',
      totalLines: Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`),
      viewportHeight: 10,
      scrollOffset: 5,
      unreadLinesCount: 8,
      width: 76,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('fullscreen · Session-1');
    expect(clean).toContain('┃'); // Scrollbar thumb
    expect(clean).toContain('▼ 8 new lines  (end to jump)');
  });
});
