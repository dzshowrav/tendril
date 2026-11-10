import { describe, it, expect } from 'vitest';
import { StreamBuffer } from '../src/render/stream/buffer.js';
import { TerminalMarkdownRenderer } from '../src/render/markdown/parser.js';
import { BusyIndicator } from '../src/components/status/busy-indicator.js';
import { InputQueue } from '../src/components/input/queue.js';
import { PromptHistory } from '../src/components/input/history.js';
import { PasteChipManager } from '../src/components/input/chips.js';
import { resolveActiveTheme } from '../src/theme/loader.js';

describe('Phase 2 Core Chat: Stream, Markdown, Busy State & Input', () => {
  const theme = resolveActiveTheme({ themeName: 'safe' });

  describe('StreamBuffer & Synchronized Output', () => {
    it('flushes incremental deltas correctly', () => {
      const buffer = new StreamBuffer({
        caps: {
          synchronizedOutput: false,
          hyperlinks: false,
          progressIndicator: false,
          colorDepth: '16',
          hasColor: true,
          supportsStatus: false,
          asciiOnly: false,
          isTTY: true,
          columns: 80,
          rows: 24,
        },
      });

      const firstFlush = buffer.append('Hello ');
      expect(firstFlush).toBe('Hello ');

      const secondFlush = buffer.append('World!');
      expect(secondFlush).toBe('World!');

      expect(buffer.getRawContent()).toBe('Hello World!');
    });

    it('wraps output in Mode 2026 sequences when synchronizedOutput is true', () => {
      const buffer = new StreamBuffer({
        caps: {
          synchronizedOutput: true,
          hyperlinks: false,
          progressIndicator: false,
          colorDepth: '16',
          hasColor: true,
          supportsStatus: false,
          asciiOnly: false,
          isTTY: true,
          columns: 80,
          rows: 24,
        },
      });

      const flushed = buffer.append('Test Frame');
      expect(flushed).toBe('\x1b[?2026hTest Frame\x1b[?2026l');
    });

    it('detects unclosed code fences and provides safe preview', () => {
      const buffer = new StreamBuffer();
      buffer.append('Here is code:\n```typescript\nconst x = 1;');
      expect(buffer.hasUnclosedCodeFence()).toBe(true);

      const preview = buffer.getSafePreviewContent();
      expect(preview).toContain('```');
      expect(preview.endsWith('```')).toBe(true);
    });
  });

  describe('Terminal Markdown Renderer', () => {
    it('renders code blocks, blockquotes, lists, and headings safely', () => {
      const renderer = new TerminalMarkdownRenderer(theme);
      const md = [
        '# Title Heading',
        '> Important note',
        '- First item',
        '- Second item',
        '```javascript',
        'function add(a, b) { return a + b; }',
        '```',
      ].join('\n');

      const rendered = renderer.render(md);
      expect(rendered).toContain('Title Heading');
      expect(rendered).toContain('│');
      expect(rendered).toContain('• First item');
      expect(rendered).toContain('function add');
    });

    it('handles tables and aligns column cells', () => {
      const renderer = new TerminalMarkdownRenderer(theme);
      const table = [
        '| Name | Role |',
        '| --- | --- |',
        '| Alice | Admin |',
        '| Bob | Member |',
      ].join('\n');

      const rendered = renderer.render(table);
      expect(rendered).toContain('Alice');
      expect(rendered).toContain('Admin');
      expect(rendered).toContain('Bob');
    });

    it('formats hyperlinks with OSC 8 when supported or text fallback otherwise', () => {
      const rendererNoLink = new TerminalMarkdownRenderer(theme, {
        synchronizedOutput: false,
        hyperlinks: false,
        progressIndicator: false,
        colorDepth: '16',
        hasColor: true,
        supportsStatus: false,
        asciiOnly: false,
        isTTY: true,
        columns: 80,
        rows: 24,
      });
      const outFallback = rendererNoLink.render('[Tendril](https://tendril.dev)');
      expect(outFallback).toContain('Tendril');
      expect(outFallback).toContain('(https://tendril.dev)');

      const rendererWithLink = new TerminalMarkdownRenderer(theme, {
        synchronizedOutput: false,
        hyperlinks: true,
        progressIndicator: false,
        colorDepth: '16',
        hasColor: true,
        supportsStatus: false,
        asciiOnly: false,
        isTTY: true,
        columns: 80,
        rows: 24,
      });
      const outOsc8 = rendererWithLink.render('[Tendril](https://tendril.dev)');
      expect(outOsc8).toContain('\x1b]8;;https://tendril.dev\x1b\\');
    });
  });

  describe('BusyIndicator State Machine & Timer Freeze', () => {
    it('freezes active elapsed time during waiting_for_user state', async () => {
      const indicator = new BusyIndicator(theme);
      expect(indicator.getState()).toBe('idle');

      // 1. Start working
      indicator.startWorking('Processing...');
      expect(indicator.getState()).toBe('working');
      await new Promise((r) => setTimeout(r, 60));

      const work1Ms = indicator.getActiveElapsedMs();
      expect(work1Ms).toBeGreaterThan(40);

      // 2. Pause for user (timer should freeze!)
      indicator.pauseForUser('Awaiting user permission...');
      expect(indicator.getState()).toBe('waiting_for_user');
      const frozenMs = indicator.getActiveElapsedMs();

      // Wait during user prompt
      await new Promise((r) => setTimeout(r, 80));
      // Elapsed work time must remain frozen!
      expect(indicator.getActiveElapsedMs()).toBe(frozenMs);

      // 3. User responds -> resume working
      indicator.startWorking('Executing command...');
      expect(indicator.getState()).toBe('working');
      await new Promise((r) => setTimeout(r, 60));

      const finalMs = indicator.getActiveElapsedMs();
      expect(finalMs).toBeGreaterThan(frozenMs);

      // 4. Finish
      indicator.finish('done');
      expect(indicator.getState()).toBe('done');
    });
  });

  describe('Non-blocking Input Queue', () => {
    it('enqueues, dequeues, updates, and clears messages', () => {
      const queue = new InputQueue();
      expect(queue.isEmpty()).toBe(true);

      const m1 = queue.enqueue('npm test');
      const m2 = queue.enqueue('git status');
      expect(queue.size()).toBe(2);
      expect(queue.peek()?.id).toBe(m1.id);

      // Edit queued item before dispatch
      queue.updateMessage(m2.id, 'git status --short');
      expect(queue.getAll()[1].text).toBe('git status --short');

      // Dequeue first
      const dequeued = queue.dequeue();
      expect(dequeued?.id).toBe(m1.id);
      expect(queue.size()).toBe(1);

      queue.clear();
      expect(queue.isEmpty()).toBe(true);
    });
  });

  describe('Prompt History & Reverse Search (Ctrl+R)', () => {
    it('navigates history and matches reverse incremental search', () => {
      const history = new PromptHistory({ mode: 'session' });
      history.add('create file index.html');
      history.add('npm run build');
      history.add('npm test');

      // Up navigation
      expect(history.getPrevious()).toBe('npm test');
      expect(history.getPrevious()).toBe('npm run build');

      // Down navigation
      expect(history.getNext()).toBe('npm test');

      // Reverse search (Ctrl+R)
      expect(history.reverseSearch('build')).toBe('npm run build');
      expect(history.reverseSearch('file')).toBe('create file index.html');
      expect(history.reverseSearch('nonexistent')).toBeNull();
    });
  });

  describe('PasteChipManager', () => {
    it('detects long pastes and creates collapsible chip', () => {
      const chipMgr = new PasteChipManager(theme);
      const shortText = 'hello world';
      expect(chipMgr.isLongPaste(shortText)).toBe(false);

      const multiLineText = 'line1\nline2\nline3\nline4';
      expect(chipMgr.isLongPaste(multiLineText)).toBe(true);

      const chip = chipMgr.createChip(multiLineText);
      const collapsedRender = chipMgr.renderChip(chip);
      expect(collapsedRender).toContain('[Paste: 4 lines');

      // Expand chip
      chipMgr.toggleExpand(chip);
      const expandedRender = chipMgr.renderChip(chip);
      expect(expandedRender).toBe(multiLineText);
    });
  });
});
