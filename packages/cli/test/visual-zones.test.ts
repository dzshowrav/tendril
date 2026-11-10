import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScreenOrchestrator } from '../src/render/layout/orchestrator.js';
import { StatusBar, FOOTER_HINTS } from '../src/components/footer/status-bar.js';
import { ASCII_GLYPHS } from '../src/ui/glyphs.js';
import { stripAnsi, visibleWidth } from '../src/ui/layout-calc.js';

describe('Screen Zones Stack & Layout Orchestrator', () => {
  let outputs: string[] = [];
  const mockWrite = (text: string) => {
    outputs.push(text);
  };

  beforeEach(() => {
    outputs = [];
  });

  it('renders Welcome Banner for 76-column terminal', () => {
    const orchestrator = new ScreenOrchestrator(mockWrite);
    const banner = orchestrator.renderBanner({
      version: '0.1.0',
      model: 'claude-3-5-sonnet',
      cwd: '~/src/tendril',
      permissionMode: 'plan',
      accountLabel: 'Pro Member',
      width: 76,
    });

    const lines = banner.split('\n');
    expect(lines.length).toBe(8); // Top, blank, row1, row2, blank, commands, blank, bottom
    expect(stripAnsi(lines[0])).toContain('Agent Harness v0.1.0');
    expect(stripAnsi(lines[2])).toContain('claude-3-5-sonnet');
    expect(stripAnsi(lines[2])).toContain('cwd   ~/src/tendril');
    expect(stripAnsi(lines[3])).toContain('mode  plan');
    expect(stripAnsi(lines[5])).toContain('/help  commands');

    for (const line of lines) {
      expect(visibleWidth(line)).toBe(76);
    }
  });

  it('renders compact Welcome Banner for narrow (<50 cols) terminal', () => {
    const orchestrator = new ScreenOrchestrator(mockWrite);
    const banner = orchestrator.renderBanner({
      version: '0.1.0',
      model: 'claude-3-5-sonnet',
      cwd: '~/src/tendril',
      permissionMode: 'plan',
      width: 44,
    });

    const lines = banner.split('\n');
    expect(stripAnsi(lines[0])).toContain('Agent Harness v0.1.0');
    expect(stripAnsi(lines[1])).toContain('claude-3-5-sonnet');
    expect(stripAnsi(lines[2])).toContain('~/src/tendril');
    expect(stripAnsi(lines[3])).toContain('/help   @file   !shell');
  });

  it('renders Welcome Banner with ASCII glyphs in ASCII mode', () => {
    const orchestrator = new ScreenOrchestrator(mockWrite);
    orchestrator.setGlyphs(ASCII_GLYPHS);
    const banner = orchestrator.renderBanner({
      version: '0.1.0',
      model: 'claude-3-5-sonnet',
      cwd: '~/src/tendril',
      permissionMode: 'plan',
      width: 76,
    });

    const clean = stripAnsi(banner);
    expect(clean.startsWith('+')).toBe(true);
    expect(clean.includes('-')).toBe(true);
    expect(clean.includes('|')).toBe(true);
  });

  it('manages Live Region frame clearing and line counting', () => {
    const orchestrator = new ScreenOrchestrator(mockWrite);

    // Frame 1: 3 lines
    orchestrator.renderLiveFrame({
      zoneC: ['● Thinking...'],
      zoneE: ['╭───╮', '╰───╯'],
      zoneF: '  ? for shortcuts',
    });

    expect(orchestrator.getLastLineCount()).toBe(4);
    expect(outputs.length).toBe(1);

    // Frame 2: redrawing clears previous lines and prints new lines
    orchestrator.renderLiveFrame({
      zoneC: ['● Thinking... (2s)'],
      zoneE: ['╭───╮', '╰───╯'],
      zoneF: '  ? for shortcuts',
    });

    expect(orchestrator.getLastLineCount()).toBe(4);
    // Should contain escape sequence to move up 4 lines and clear
    expect(outputs[1]).toContain('\x1B[4A\r\x1B[J');

    // Ending live turn clears cleanly
    orchestrator.clearLiveRegion();
    expect(orchestrator.getLastLineCount()).toBe(0);
    expect(outputs[2]).toContain('\x1B[4A\r\x1B[J');
  });

  it('clears live region before appending history lines to scrollback', () => {
    const orchestrator = new ScreenOrchestrator(mockWrite);
    orchestrator.renderLiveFrame({
      zoneC: ['● Working...'],
    });

    expect(orchestrator.getLastLineCount()).toBe(1);

    orchestrator.appendHistory(['> User message', '● Assistant reply']);
    expect(orchestrator.getLastLineCount()).toBe(0);
    expect(outputs.some((o) => o.includes('> User message\n'))).toBe(true);
    expect(outputs.some((o) => o.includes('● Assistant reply\n'))).toBe(true);
  });
});

describe('Dynamic Context-Aware Footer (Status Bar)', () => {
  const statusBar = new StatusBar();

  it('displays accurate context hints across all states', () => {
    const idleFooter = statusBar.render({
      state: 'idle',
      mode: 'plan',
      model: 'claude-3-5',
      contextPercent: 12,
      width: 76,
    });
    expect(stripAnsi(idleFooter)).toContain(FOOTER_HINTS.idle);
    expect(stripAnsi(idleFooter)).toContain('plan | claude-3-5 | ctx 12%');

    const typingFooter = statusBar.render({
      state: 'typing',
      mode: 'plan',
      model: 'claude-3-5',
      contextPercent: 12,
      width: 76,
    });
    expect(stripAnsi(typingFooter)).toContain(FOOTER_HINTS.typing);

    const approvalFooter = statusBar.render({
      state: 'approval',
      mode: 'plan',
      model: 'claude-3-5',
      width: 76,
    });
    expect(stripAnsi(approvalFooter)).toContain(FOOTER_HINTS.approval);

    const runningFooter = statusBar.render({
      state: 'running',
      mode: 'auto-edit',
      model: 'claude-3-5',
      width: 76,
    });
    expect(stripAnsi(runningFooter)).toContain(FOOTER_HINTS.running);

    const autocompleteFooter = statusBar.render({
      state: 'autocomplete',
      mode: 'plan',
      model: 'claude-3-5',
      width: 76,
    });
    expect(stripAnsi(autocompleteFooter)).toContain(FOOTER_HINTS.autocomplete);
  });

  it('prunes right status gracefully on narrow terminals', () => {
    // Narrow terminal (< 50 cols): hint hidden, compact status only
    const narrow = statusBar.render({
      state: 'idle',
      mode: 'plan',
      model: 'claude-3-5-sonnet',
      contextPercent: 25,
      width: 44,
    });

    const cleanNarrow = stripAnsi(narrow);
    expect(cleanNarrow).not.toContain('? for shortcuts');
    expect(cleanNarrow).toContain('ctx 25%');

    // Medium terminal (50-59 cols): hint hidden, status shown
    const medium = statusBar.render({
      state: 'idle',
      mode: 'plan',
      model: 'claude-3-5',
      contextPercent: 25,
      width: 55,
    });

    const cleanMedium = stripAnsi(medium);
    expect(cleanMedium).not.toContain('? for shortcuts');
    expect(cleanMedium).toContain('plan | claude-3-5 | ctx 25%');
  });
});
