import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveSetting, resolveUIMode } from '../src/config/settings.js';
import { detectTerminalCapabilities } from '../src/capabilities/detector.js';
import { resolveActiveTheme, stripAnsi } from '../src/theme/loader.js';
import { KeybindingResolver } from '../src/keybindings/resolver.js';

describe('Phase 1 Foundation: Settings, Capabilities, Theme & Keybindings', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe('Settings Precedence & Retired Mode Handling', () => {
    it('respects flag > env > settings > default precedence', () => {
      // Flag wins over env & settings
      const r1 = resolveSetting('mode', 'flag-val', 'TEST_ENV', 'setting-val', 'default-val');
      expect(r1.value).toBe('flag-val');
      expect(r1.source).toBe('flag');

      // Env wins over settings & default
      process.env.TEST_ENV = 'env-val';
      const r2 = resolveSetting('mode', undefined, 'TEST_ENV', 'setting-val', 'default-val');
      expect(r2.value).toBe('env-val');
      expect(r2.source).toBe('env');

      // Settings wins over default
      delete process.env.TEST_ENV;
      const r3 = resolveSetting('mode', undefined, 'TEST_ENV', 'setting-val', 'default-val');
      expect(r3.value).toBe('setting-val');
      expect(r3.source).toBe('settings');

      // Falls back to default when nothing passed
      const r4 = resolveSetting('mode', undefined, 'TEST_ENV', undefined, 'default-val');
      expect(r4.value).toBe('default-val');
      expect(r4.source).toBe('default');
    });

    it('gracefully handles retired UI modes with explanatory notice', () => {
      const res = resolveUIMode({ flag: 'classic' });
      expect(res.value).toBe('repl');
      expect(res.source).toBe('default');
      expect(res.notice).toContain('is retired');
    });
  });

  describe('Terminal Capabilities & Opt-out Envs', () => {
    it('detects capabilities and respects opt-out env flags', () => {
      process.env.TENDRIL_NO_HYPERLINKS = '1';
      process.env.TENDRIL_NO_SYNCHRONIZED = '1';
      process.env.TENDRIL_ASCII_MODE = '1';

      const caps = detectTerminalCapabilities();
      expect(caps.hyperlinks).toBe(false);
      expect(caps.synchronizedOutput).toBe(false);
      expect(caps.asciiOnly).toBe(true);
    });

    it('respects NO_COLOR standard to disable colors', () => {
      process.env.NO_COLOR = '1';
      const caps = detectTerminalCapabilities();
      expect(caps.hasColor).toBe(false);
      expect(caps.colorDepth).toBe('none');
    });
  });

  describe('Theme Token System & NO_COLOR Enforcer', () => {
    it('loads dark, light, and safe themes properly', () => {
      const dark = resolveActiveTheme({ themeName: 'dark', forceNoColor: false });
      expect(dark.name).toBe('dark');
      expect(dark.symbols.success).toBe('✔');

      const light = resolveActiveTheme({ themeName: 'light', forceNoColor: false });
      expect(light.name).toBe('light');

      const safe = resolveActiveTheme({ themeName: 'safe' });
      expect(safe.name).toBe('safe');
      expect(safe.symbols.success).toBe('[OK]');
    });

    it('ensures ZERO ANSI escape codes are emitted when NO_COLOR is active', () => {
      const active = resolveActiveTheme({ forceNoColor: true });
      const renderedError = active.colors.textError('Critical failure');
      expect(renderedError).toBe(stripAnsi(renderedError));
      expect(renderedError).toContain('Critical failure');
    });
  });

  describe('Layered Keybinding Engine', () => {
    it('prioritizes active context keymap over global keymap (Ctrl+X context reuse)', () => {
      const resolver = new KeybindingResolver();

      // In global context, Ctrl+X toggles activity tray
      const globalAction = resolver.resolveKey('ctrl+x', 'global');
      expect(globalAction?.id).toBe('global.toggle_tray');

      // In monitor context, Ctrl+X arms stop
      const monitorAction = resolver.resolveKey('ctrl+x', 'monitor');
      expect(monitorAction?.id).toBe('monitor.stop_arm');
    });

    it('guards suspend with double Ctrl+Z check', () => {
      const resolver = new KeybindingResolver();
      // First press: records time, returns false
      expect(resolver.checkDoubleSuspend()).toBe(false);
      // Rapid second press: returns true
      expect(resolver.checkDoubleSuspend()).toBe(true);
      // Next press: resets and returns false
      expect(resolver.checkDoubleSuspend()).toBe(false);
    });

    it('supports custom overrides and falls back gracefully on invalid keys', () => {
      const resolver = new KeybindingResolver({
        'global.cancel': 'ctrl+x',
        'global.exit': 'invalid@@key',
      });

      // Valid override applied
      const action = resolver.resolveKey('ctrl+x', 'global');
      expect(action?.id).toBe('global.cancel');

      // Invalid override ignored, baseline retained
      const exitAction = resolver.resolveKey('ctrl+c', 'global');
      expect(exitAction?.id).toBe('global.exit');
    });
  });
});
