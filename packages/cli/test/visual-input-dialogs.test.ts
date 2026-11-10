import { describe, it, expect } from 'vitest';
import { VisualInputBox } from '../src/components/input/box.js';
import { AutocompletePopup } from '../src/components/autocomplete/popup.js';
import { VisualApprovalDialog } from '../src/components/approval-bar/dialog.js';
import { stripAnsi, visibleWidth } from '../src/ui/layout-calc.js';
import { ASCII_GLYPHS } from '../src/ui/glyphs.js';

describe('Upward Expanding Input Box (Section 4)', () => {
  const inputBox = new VisualInputBox();

  it('renders empty input with prompt > and dim placeholder', () => {
    const lines = inputBox.render({ value: '', width: 76 });
    expect(lines.length).toBe(3); // top border, prompt row, bottom border
    expect(stripAnsi(lines[0])).toContain('╭');
    expect(stripAnsi(lines[1])).toContain('> Ask anything');
    expect(stripAnsi(lines[2])).toContain('╰');
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(76);
    }
  });

  it('switches prompt to ! and activates shell mode accent when command starts with !', () => {
    const lines = inputBox.render({ value: '!git status', width: 76 });
    expect(stripAnsi(lines[1])).toContain('! git status');
  });

  it('renders pasted text chips gracefully inside input box', () => {
    const lines = inputBox.render({
      value: 'Please review this',
      chips: [{ id: 'paste-1', lineCount: 42 }],
      width: 76,
    });
    expect(stripAnsi(lines[1])).toContain('[pasted text 42 lines]');
    expect(stripAnsi(lines[1])).toContain('Please review this');
  });

  it('grows multi-line input upward and caps at 10 rows', () => {
    const longMulti = Array.from({ length: 15 }, (_, i) => `Line ${i + 1}`).join('\n');
    const lines = inputBox.render({ value: longMulti, maxRows: 10, width: 76 });

    // 10 content rows + top border + bottom border = 12 lines
    expect(lines.length).toBe(12);
    // Should display the bottom lines (scrolled to bottom)
    expect(stripAnsi(lines[lines.length - 2])).toContain('Line 15');
  });
});

describe('Autocomplete Popup (Section 10)', () => {
  const popup = new AutocompletePopup();

  it('renders command popup with category title, ▸ caret, and matching highlights', () => {
    const lines = popup.render({
      categoryTitle: 'Commands',
      items: [
        { name: '/help', description: 'list all commands' },
        { name: '/context', description: 'context window usage' },
        { name: '/model', description: 'change model and effort' },
      ],
      selectedIndex: 1,
      query: '/co',
      width: 60,
    });

    expect(stripAnsi(lines[0])).toContain('Commands');
    // Row 0 has space
    expect(stripAnsi(lines[1])).toContain('/help');
    // Row 1 has focus caret ▸
    expect(stripAnsi(lines[2])).toContain('▸ /context');
    expect(stripAnsi(lines[2])).toContain('context window usage');
    for (const line of lines) {
      expect(visibleWidth(line)).toBe(60);
    }
  });

  it('displays scroll down indicator when items exceed maxRows', () => {
    const manyItems = Array.from({ length: 12 }, (_, i) => ({
      name: `/cmd-${i + 1}`,
      description: `Command ${i + 1}`,
    }));

    const lines = popup.render({
      categoryTitle: 'Commands',
      items: manyItems,
      selectedIndex: 0,
      maxRows: 5,
      width: 60,
    });

    // Contains scroll down indicator: "7 more   ▼"
    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('7 more   ▼');
  });

  it('supports ASCII fallback for popup borders and carets', () => {
    popup.setGlyphs(ASCII_GLYPHS);
    const lines = popup.render({
      categoryTitle: 'Commands',
      items: [{ name: '/help', description: 'help' }],
      selectedIndex: 0,
      width: 40,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('+');
    expect(clean).toContain('>');
  });
});

describe('Permission Dialog & Trust Hierarchy (Section 9)', () => {
  const dialog = new VisualApprovalDialog();

  it('renders command permission dialog with 3-tier trust hierarchy', () => {
    const lines = dialog.render({
      type: 'command',
      target: 'npm test',
      description: 'Run unit test suite',
      options: [
        { key: '1', label: 'Yes, once', isDefault: true },
        { key: '2', label: 'Yes, and trust exactly: npm test' },
        { key: '3', label: 'Yes, and trust prefix:  npm *' },
        { key: '4', label: 'No, and tell the agent what to do differently' },
      ],
      selectedIndex: 0,
      width: 76,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('Run command');
    expect(clean).toContain('npm test');
    expect(clean).toContain('Allow this command?');
    expect(clean).toContain('▸ 1. Yes, once');
    expect(clean).toContain('2. Yes, and trust exactly: npm test');
    expect(clean).toContain('enter select · tab add note · esc cancel');
  });

  it('renders queue indicator (1 of 3 pending) in title when multiple approvals exist', () => {
    const lines = dialog.render({
      type: 'command',
      target: 'git pull',
      queueInfo: { current: 1, total: 3 },
      options: [
        { key: '1', label: 'Yes, once' },
        { key: '2', label: 'No' },
      ],
      selectedIndex: 0,
      width: 76,
    });

    const clean = stripAnsi(lines[0]);
    expect(clean).toContain('Run command  (1 of 3 pending)');
  });

  it('displays inline note input area when isNoteOpen is true', () => {
    const lines = dialog.render({
      type: 'command',
      target: 'rm -rf node_modules',
      options: [
        { key: '1', label: 'Yes' },
        { key: '2', label: 'No' },
      ],
      selectedIndex: 1,
      isNoteOpen: true,
      noteText: 'Please run npm clean instead',
      width: 76,
    });

    const clean = stripAnsi(lines.join('\n'));
    expect(clean).toContain('Note: Please run npm clean instead_');
  });
});
