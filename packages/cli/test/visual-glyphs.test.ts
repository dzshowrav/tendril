import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getGlyphs, UNICODE_GLYPHS, ASCII_GLYPHS } from '../src/ui/glyphs.js';
import {
  stripAnsi,
  visibleWidth,
  truncateVisible,
  wrapLines,
  formatHangingIndent,
  padLine,
} from '../src/ui/layout-calc.js';
import { ENV_VARS } from '../src/config/constants.js';

describe('Glyphs & Visual Vocabulary', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[ENV_VARS.TENDRIL_ASCII_MODE];
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('provides default Unicode glyphs matching Section 1 spec', () => {
    const glyphs = UNICODE_GLYPHS;
    expect(glyphs.bullet).toBe('●');
    expect(glyphs.connector).toBe('⎿');
    expect(glyphs.prompt).toBe('>');
    expect(glyphs.success).toBe('✓');
    expect(glyphs.error).toBe('✗');
    expect(glyphs.waiting).toBe('…');
    expect(glyphs.thinking).toBe('✻');
    expect(glyphs.taskOpen).toBe('☐');
    expect(glyphs.taskDone).toBe('☒');
    expect(glyphs.focusCaret).toBe('▸');
    expect(glyphs.boxTopLeft).toBe('╭');
    expect(glyphs.dashedDivider).toBe('┄');
    expect(glyphs.progressFill).toBe('█');
    expect(glyphs.progressEmpty).toBe('░');
    expect(glyphs.hunkDivider).toBe('···');
    expect(glyphs.scrollbarThumb).toBe('┃');
    expect(glyphs.commentMarker).toBe('▌');
    expect(glyphs.isAscii).toBe(false);
  });

  it('provides ASCII fallback glyphs matching Section 1 spec', () => {
    const glyphs = ASCII_GLYPHS;
    expect(glyphs.bullet).toBe('*');
    expect(glyphs.connector).toBe('\\_');
    expect(glyphs.prompt).toBe('>');
    expect(glyphs.success).toBe('[ok]');
    expect(glyphs.error).toBe('[x]');
    expect(glyphs.waiting).toBe('...');
    expect(glyphs.thinking).toBe('~');
    expect(glyphs.taskOpen).toBe('[ ]');
    expect(glyphs.taskDone).toBe('[x]');
    expect(glyphs.focusCaret).toBe('>');
    expect(glyphs.boxTopLeft).toBe('+');
    expect(glyphs.dashedDivider).toBe('-');
    expect(glyphs.progressFill).toBe('#');
    expect(glyphs.progressEmpty).toBe('.');
    expect(glyphs.hunkDivider).toBe('...');
    expect(glyphs.scrollbarThumb).toBe('|');
    expect(glyphs.commentMarker).toBe('|');
    expect(glyphs.isAscii).toBe(true);
  });

  it('switches to ASCII when forceAscii option or env var is set', () => {
    expect(getGlyphs({ forceAscii: true }).isAscii).toBe(true);

    process.env[ENV_VARS.TENDRIL_ASCII_MODE] = '1';
    expect(getGlyphs().isAscii).toBe(true);
  });
});

describe('Layout Calculations & String Widths', () => {
  it('strips ANSI codes cleanly', () => {
    const colored = '\x1B[32mhello\x1B[0m \x1B[1mworld\x1B[22m';
    expect(stripAnsi(colored)).toBe('hello world');
  });

  it('calculates visible width correctly with ANSI and wide chars', () => {
    expect(visibleWidth('hello')).toBe(5);
    expect(visibleWidth('\x1B[31mhello\x1B[0m')).toBe(5);
    // CJK characters take 2 columns
    expect(visibleWidth('你好')).toBe(4);
    expect(visibleWidth('● bullet')).toBe(8); // '●' is 1 col + ' bullet' is 7 = 8
  });

  it('truncates text at visible column width with ANSI preservation', () => {
    const text = 'abcdefghij';
    expect(truncateVisible(text, 5, '…')).toBe('abcd…');
    expect(visibleWidth(truncateVisible(text, 5, '…'))).toBe(5);

    const ansiText = '\x1B[32mabcdefghij\x1B[0m';
    const truncated = truncateVisible(ansiText, 6, '…');
    expect(visibleWidth(truncated)).toBe(6);
    expect(truncated).toContain('\x1B[0m'); // Must close styling
  });

  it('pads lines to exact target width', () => {
    const line = 'Hello';
    const padded = padLine(line, 10, 'left');
    expect(padded).toBe('Hello     ');
    expect(visibleWidth(padded)).toBe(10);

    const rightPadded = padLine(line, 10, 'right');
    expect(rightPadded).toBe('     Hello');

    const centerPadded = padLine(line, 10, 'center');
    expect(centerPadded).toBe('  Hello   ');
    expect(visibleWidth(centerPadded)).toBe(10);
  });

  it('wraps lines based on word boundaries', () => {
    const longText = 'the quick brown fox jumps over the lazy dog';
    const wrapped = wrapLines(longText, 15);
    expect(wrapped.length).toBeGreaterThan(1);
    for (const line of wrapped) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(15);
    }
  });

  it('formats hanging indents for multi-line messages', () => {
    const prefix = '●  '; // 3 cols
    const text = 'The quick brown fox jumps over the lazy dog and runs away fast into the deep woods.';
    const lines = formatHangingIndent(prefix, text, 3, 30);

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0].startsWith('●  ')).toBe(true);
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startsWith('   ')).toBe(true);
    }
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(30);
    }
  });
});
