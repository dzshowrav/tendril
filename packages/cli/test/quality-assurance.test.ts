import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { resolveActiveTheme, stripAnsi } from '../src/theme/loader.js';
import { renderPanel, createPanelState } from '../src/components/panels/framework.js';
import { renderActivityTray } from '../src/components/activity-tray/tray.js';
import { parseDiagram } from '../src/diagram/parser.js';
import { paintDiagram } from '../src/diagram/painter.js';
import { KeybindingResolver } from '../src/keybindings/resolver.js';

describe('Phase 6: Quality Assurance & Architecture Verification (new-ins.md § 2, § 13, § 16, § 21, § 22)', () => {
  const rootDir = resolve('.');

  describe('Architectural Boundary Enforcement (§ 2: core/ UI-neutrality)', () => {
    it('ensures packages/core never imports from packages/cli or ui components', () => {
      const coreDir = join(rootDir, 'packages/core/src');

      function scanDir(dir: string): string[] {
        let files: string[] = [];
        for (const item of readdirSync(dir)) {
          const fullPath = join(dir, item);
          if (statSync(fullPath).isDirectory()) {
            files = files.concat(scanDir(fullPath));
          } else if (item.endsWith('.ts')) {
            files.push(fullPath);
          }
        }
        return files;
      }

      const coreFiles = scanDir(coreDir);
      expect(coreFiles.length).toBeGreaterThan(0);

      const illegalImports: Array<{ file: string; line: string }> = [];

      for (const f of coreFiles) {
        const content = readFileSync(f, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (
            (line.includes('import ') || line.includes('from ')) &&
            (line.includes('/cli/') ||
              line.includes('@tendril/cli') ||
              line.includes('/ui/') ||
              line.includes('/components/'))
          ) {
            illegalImports.push({ file: f, line: `Line ${i + 1}: ${line.trim()}` });
          }
        }
      }

      expect(illegalImports).toEqual([]);
    });

    it('ensures no UI components use hardcoded raw hex colors (§ 13.2)', () => {
      const componentsDir = join(rootDir, 'packages/cli/src/components');

      function scanComponents(dir: string): string[] {
        let files: string[] = [];
        for (const item of readdirSync(dir)) {
          const fullPath = join(dir, item);
          if (statSync(fullPath).isDirectory()) {
            files = files.concat(scanComponents(fullPath));
          } else if (item.endsWith('.ts')) {
            files.push(fullPath);
          }
        }
        return files;
      }

      const files = scanComponents(componentsDir);
      const hardcodedHexFound: Array<{ file: string; match: string }> = [];

      for (const f of files) {
        const content = readFileSync(f, 'utf8');
        const hexMatches = content.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g);
        if (hexMatches) {
          hardcodedHexFound.push({ file: f, match: hexMatches.join(', ') });
        }
      }

      expect(hardcodedHexFound).toEqual([]);
    });
  });

  describe('NO_COLOR & Safe Theme Degradation (§ 13, § 22)', () => {
    it('guarantees zero ANSI escape sequences emitted under NO_COLOR', () => {
      const noColorTheme = resolveActiveTheme({ forceNoColor: true });
      expect(noColorTheme.isNoColor).toBe(true);

      // 1. Panel under NO_COLOR
      const panelState = createPanelState({
        title: 'Safe Mode Panel',
        items: [{ id: '1', title: 'Monochrome item', description: 'No ANSI codes' }],
      });
      const renderedPanel = renderPanel(panelState, noColorTheme);
      // eslint-disable-next-line no-control-regex
      expect(renderedPanel).not.toMatch(/\x1b\[[0-9;]*m/);
      expect(renderedPanel).toContain('Safe Mode Panel');

      // 2. Activity tray under NO_COLOR
      const renderedTray = renderActivityTray(
        {
          status: 'working',
          elapsedWorkMs: 3500,
          queuedMessages: ['Test message'],
        },
        noColorTheme,
      );
      // eslint-disable-next-line no-control-regex
      expect(renderedTray).not.toMatch(/\x1b\[[0-9;]*m/);
      expect(renderedTray).toContain('Activity Tray');

      // 3. Diagram under NO_COLOR
      const parsed = parseDiagram('graph TD\nA[Start] --> B[Finish]');
      const renderedDiagram = paintDiagram(parsed, noColorTheme);
      // eslint-disable-next-line no-control-regex
      expect(renderedDiagram).not.toMatch(/\x1b\[[0-9;]*m/);
      expect(renderedDiagram).toContain('Start');
    });

    it('safe theme renders cleanly without crashing on 16-color terminals', () => {
      const safe = resolveActiveTheme({ themeName: 'safe' });
      expect(safe.name).toBe('safe');

      const testStr = safe.colors.textPrimary('Safe terminal test');
      expect(stripAnsi(testStr)).toBe('Safe terminal test');
    });
  });

  describe('Keybinding Conflict & Context Reuse Verification (§ 16.3)', () => {
    it('context-aware keymap resolves actions based on active context layer', () => {
      const resolver = new KeybindingResolver();

      // In global context: ctrl+x toggles activity tray
      const globalAction = resolver.resolveKey('ctrl+x', 'global');
      expect(globalAction?.id).toBe('global.toggle_tray');

      // In review context: ctrl+d scrolls half-page down
      const reviewAction = resolver.resolveKey('ctrl+d', 'review');
      expect(reviewAction?.id).toBe('review.scroll_half_down');

      // In monitor context: esc exits or disarms stop
      const monitorEsc = resolver.resolveKey('escape', 'monitor');
      expect(monitorEsc?.id).toBe('monitor.close');
    });

    it('enforces double Ctrl+Z suspend guard', () => {
      const resolver = new KeybindingResolver();

      // First Ctrl+Z: does not suspend immediately
      const first = resolver.checkDoubleSuspend();
      expect(first).toBe(false);

      // Second Ctrl+Z within window: confirms suspend
      const second = resolver.checkDoubleSuspend();
      expect(second).toBe(true);
    });

    it('handles invalid user custom keybindings gracefully without crashing', () => {
      const resolver = new KeybindingResolver({
        'global.cancel': 'not-a-valid-key-format-###',
      });

      // Invalid key ignored; defaults to escape
      const cancelAction = resolver.resolveKey('escape', 'global');
      expect(cancelAction?.id).toBe('global.cancel');
    });
  });
});
