import { describe, it, expect } from 'vitest';
import { TurnLayout } from '../src/render/conversation/turn-layout.js';
import { VisualToolCard } from '../src/components/tool-cards/visual-card.js';
import { VisualDiffFormatter } from '../src/render/diff/visual-diff.js';
import { stripAnsi, visibleWidth } from '../src/ui/layout-calc.js';
import { ASCII_GLYPHS } from '../src/ui/glyphs.js';

describe('Turn Formatting & Hanging Indents (Section 5)', () => {
  const layout = new TurnLayout();

  it('formats User Turn with prompt at col 0 and hanging indent at col 2', () => {
    const longText = 'This is a long user query that will definitely wrap across multiple terminal lines to test hanging indentation.';
    const lines = layout.formatUserTurn(longText, 40);

    expect(lines.length).toBeGreaterThan(1);
    expect(stripAnsi(lines[0]).startsWith('> ')).toBe(true);
    for (let i = 1; i < lines.length; i++) {
      expect(stripAnsi(lines[i]).startsWith('  ')).toBe(true);
    }
  });

  it('formats Assistant Turn with bullet at col 0 and hanging indent at col 2', () => {
    const text = 'Here is the assistant response explaining the architecture changes.';
    const lines = layout.formatAssistantTurn(text, 35);

    expect(lines.length).toBeGreaterThan(1);
    expect(stripAnsi(lines[0]).startsWith('● ')).toBe(true);
    for (let i = 1; i < lines.length; i++) {
      expect(stripAnsi(lines[i]).startsWith('  ')).toBe(true);
    }
  });

  it('formats Tool Result with connector at col 2 and text at col 5', () => {
    const text = 'Read 150 lines from packages/cli/src/render.ts';
    const lines = layout.formatToolResult(text, 76);

    expect(stripAnsi(lines[0]).startsWith('  ⎿  ')).toBe(true);
    expect(stripAnsi(lines[0])).toContain('Read 150 lines');
  });

  it('formats Thinking block with ✻ marker and expand hint', () => {
    const lines = layout.formatThinking('Reasoning about dependencies…', false);
    expect(stripAnsi(lines[0])).toContain('✻ Reasoning about dependencies…');
    expect(stripAnsi(lines[0])).toContain('(ctrl+o to expand)');

    const expanded = layout.formatThinking('Reasoning…', true, 'Step 1: Check inputs\nStep 2: Run build');
    expect(expanded.length).toBe(3);
    expect(stripAnsi(expanded[0])).toContain('(ctrl+o to collapse)');
    expect(stripAnsi(expanded[1])).toContain('Step 1: Check inputs');
  });
});

describe('8-State Dedicated Tool Cards (Section 6 & 7)', () => {
  const card = new VisualToolCard();

  it('formats tool titles across different tool types (§ 7.8)', () => {
    expect(card.formatToolTitle('bash', { command: 'npm test' })).toBe('Bash(npm test)');
    expect(card.formatToolTitle('read_file', { path: 'src/index.ts' })).toBe('Read(src/index.ts)');
    expect(card.formatToolTitle('write_file', { path: 'src/index.ts' })).toBe('Write(src/index.ts)');
    expect(card.formatToolTitle('edit_file', { path: 'src/index.ts' })).toBe('Update(src/index.ts)');
    expect(card.formatToolTitle('search_files', { pattern: 'TODO', path: 'src' })).toBe('Search(pattern: "TODO", path: "src")');
    expect(card.formatToolTitle('github:create_issue', { title: 'Bug' })).toBe('github:create_issue(title: "Bug")');
    expect(card.formatToolTitle('subagent', { role: 'tester', prompt: 'Run all checks' })).toContain('Agent(tester)');
  });

  it('renders state 1: needs_approval', () => {
    const lines = card.render({
      tool: 'bash',
      args: { command: 'rm -rf dist' },
      state: 'needs_approval',
    });

    expect(stripAnsi(lines[0])).toBe('● Bash(rm -rf dist)');
    expect(stripAnsi(lines[1])).toBe('  ⎿  … Waiting for approval');
  });

  it('renders state 2: running with live output lines', () => {
    const lines = card.render({
      tool: 'bash',
      args: { command: 'npm test' },
      state: 'running',
      elapsedSeconds: 2,
      outputLines: ['Test 1 passed', 'Test 2 passed'],
    });

    expect(stripAnsi(lines[0])).toBe('● Bash(npm test)');
    expect(stripAnsi(lines[1])).toContain('Running…  (2s · ctrl+o to expand)');
    expect(stripAnsi(lines[2])).toContain('Test 1 passed');
    expect(stripAnsi(lines[3])).toContain('Test 2 passed');
  });

  it('renders state 3: success (collapsed)', () => {
    const lines = card.render({
      tool: 'bash',
      args: { command: 'npm test' },
      state: 'success',
      exitCode: 0,
      summary: '42 tests passed (1.2s)',
    });

    expect(stripAnsi(lines[0])).toBe('● Bash(npm test)');
    expect(stripAnsi(lines[1])).toContain('✓ 42 tests passed (1.2s)  (ctrl+o to expand)');
  });

  it('renders state 4: expanded (head + tail)', () => {
    const output = Array.from({ length: 20 }, (_, i) => `Output line ${i + 1}`);
    const lines = card.render({
      tool: 'bash',
      args: { command: 'npm test' },
      state: 'expanded',
      exitCode: 0,
      outputLines: output,
    });

    expect(stripAnsi(lines[0])).toBe('● Bash(npm test)');
    expect(stripAnsi(lines[1])).toContain('✓ Done (exit 0)');
    // Head 3 lines
    expect(stripAnsi(lines[2])).toContain('Output line 1');
    expect(stripAnsi(lines[3])).toContain('Output line 2');
    expect(stripAnsi(lines[4])).toContain('Output line 3');
    // Hidden indicator
    expect(stripAnsi(lines[5])).toContain('… +14 lines hidden (ctrl+o to show all)');
    // Tail 3 lines
    expect(stripAnsi(lines[6])).toContain('Output line 18');
    expect(stripAnsi(lines[7])).toContain('Output line 19');
    expect(stripAnsi(lines[8])).toContain('Output line 20');
  });

  it('renders state 5: error', () => {
    const lines = card.render({
      tool: 'bash',
      args: { command: 'npm test' },
      state: 'error',
      exitCode: 1,
      outputLines: ['Error: 1 test failed'],
    });

    expect(stripAnsi(lines[0])).toBe('● Bash(npm test)');
    expect(stripAnsi(lines[1])).toContain('✗ Failed (exit 1)');
    expect(stripAnsi(lines[2])).toContain('Error: 1 test failed');
  });

  it('renders state 6: denied', () => {
    const lines = card.render({
      tool: 'bash',
      args: { command: 'rm -rf /' },
      state: 'denied',
      userNote: 'Too dangerous',
    });

    expect(stripAnsi(lines[0])).toBe('● Bash(rm -rf /)');
    expect(stripAnsi(lines[1])).toContain('✗ Denied by user');
    expect(stripAnsi(lines[2])).toContain('Too dangerous');
  });

  it('renders state 7: interrupted', () => {
    const lines = card.render({
      tool: 'bash',
      args: { command: 'sleep 100' },
      state: 'interrupted',
    });

    expect(stripAnsi(lines[0])).toBe('● Bash(sleep 100)');
    expect(stripAnsi(lines[1])).toContain('✗ Interrupted');
  });

  it('renders state 8: mcp_progress with 16-slot progress bar', () => {
    const lines = card.render({
      tool: 'server:task',
      args: { id: 'sync' },
      state: 'mcp_progress',
      mcpProgress: { current: 4, total: 10, percent: 40 },
      elapsedSeconds: 3,
    });

    expect(stripAnsi(lines[0])).toContain('server:task');
    expect(stripAnsi(lines[1])).toContain('40%  4 of 10  (3s)');
    expect(stripAnsi(lines[1])).toContain('[██████░░░░░░░░░░]');
  });
});

describe('Visual Diff View (Section 8)', () => {
  const formatter = new VisualDiffFormatter();

  it('renders diff with right-aligned line numbers, gutter, additions, and removals', () => {
    const diff = formatter.renderDiff({
      filePath: 'src/config.ts',
      additions: 1,
      removals: 1,
      hunks: [
        {
          lines: [
            { type: 'context', oldLineNumber: 10, newLineNumber: 10, text: 'const a = 1;' },
            { type: 'remove', oldLineNumber: 11, text: 'const b = 2;' },
            { type: 'add', newLineNumber: 11, text: 'const b = 3;' },
            { type: 'context', oldLineNumber: 12, newLineNumber: 12, text: 'const c = 4;' },
          ],
        },
      ],
    });

    expect(stripAnsi(diff[0])).toBe('  ⎿  Updated src/config.ts with 1 addition and 1 removal');
    expect(stripAnsi(diff[1])).toContain('10 │  const a = 1;');
    expect(stripAnsi(diff[2])).toContain('11 │ -const b = 2;');
    expect(stripAnsi(diff[3])).toContain('11 │ +const b = 3;');
    expect(stripAnsi(diff[4])).toContain('12 │  const c = 4;');
  });

  it('renders hunk separators correctly between multiple hunks', () => {
    const diff = formatter.renderDiff({
      filePath: 'src/app.ts',
      additions: 2,
      removals: 0,
      hunks: [
        {
          lines: [{ type: 'add', newLineNumber: 5, text: 'import foo;' }],
        },
        {
          lines: [{ type: 'add', newLineNumber: 40, text: 'foo.run();' }],
        },
      ],
    });

    expect(stripAnsi(diff[2])).toContain('···');
    expect(stripAnsi(diff[3])).toContain('40 │ +foo.run();');
  });

  it('supports ASCII fallback for hunk separators and box gutters', () => {
    formatter.setGlyphs(ASCII_GLYPHS);
    const diff = formatter.renderDiff({
      filePath: 'src/app.ts',
      additions: 2,
      removals: 0,
      hunks: [
        {
          lines: [{ type: 'add', newLineNumber: 5, text: 'import foo;' }],
        },
        {
          lines: [{ type: 'add', newLineNumber: 40, text: 'foo.run();' }],
        },
      ],
    });

    const clean = stripAnsi(diff[2]);
    expect(clean).toContain('...');
    expect(stripAnsi(diff[1])).toContain('|');
  });
});
