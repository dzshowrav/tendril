import { KeyContext, KeyBindingAction } from './context.js';
import { BASELINE_ACTIONS } from './default-map.js';

export class KeybindingResolver {
  private customOverrides: Map<string, string[]> = new Map();
  private lastSuspendTime = 0;

  constructor(userConfigOverrides?: Record<string, string | string[]>) {
    if (userConfigOverrides) {
      this.loadOverrides(userConfigOverrides);
    }
  }

  public loadOverrides(overrides: Record<string, string | string[]>): void {
    for (const [actionId, val] of Object.entries(overrides)) {
      if (typeof val === 'string') {
        const norm = this.normalizeKey(val);
        if (norm) this.customOverrides.set(actionId, [norm]);
      } else if (Array.isArray(val)) {
        const validKeys = val.map((k) => this.normalizeKey(String(k))).filter(Boolean) as string[];
        if (validKeys.length > 0) {
          this.customOverrides.set(actionId, validKeys);
        }
      }
    }
  }

  public normalizeKey(input: string): string | null {
    if (!input || typeof input !== 'string') return null;
    const clean = input.trim().toLowerCase();
    // Validate key pattern (optional modifiers: ctrl+, shift+, alt+, meta+)
    const validPattern = /^(?:(?:ctrl|shift|alt|meta)\+)*[a-z0-9_?+\-[\]\\/`~!=;:'",.<>|]+$|^escape$|^enter$|^pageup$|^pagedown$|^delete$|^backspace$|^tab$/i;
    return validPattern.test(clean) ? clean : null;
  }

  /**
   * Resolves which action matches a pressed key combination in the given context.
   * Priority: Active context first, then global context.
   */
  public resolveKey(rawKey: string, activeContext: KeyContext = 'global'): KeyBindingAction | null {
    const key = this.normalizeKey(rawKey);
    if (!key) return null;

    // 1. Evaluate active context custom overrides first
    if (activeContext !== 'global') {
      for (const [actionId, keys] of this.customOverrides.entries()) {
        if (keys.includes(key)) {
          const action = BASELINE_ACTIONS.find((a) => a.id === actionId && a.context === activeContext);
          if (action) return action;
        }
      }

      // Check remaining matches in active context
      const matchInContext = BASELINE_ACTIONS.filter((a) => a.context === activeContext).find(
        (action) => this.isMatch(action, key),
      );
      if (matchInContext) {
        return matchInContext;
      }
    }

    // 2. Evaluate global custom overrides
    for (const [actionId, keys] of this.customOverrides.entries()) {
      if (keys.includes(key)) {
        const action = BASELINE_ACTIONS.find((a) => a.id === actionId && a.context === 'global');
        if (action) return action;
      }
    }

    // 3. Evaluate default global actions
    const matchGlobal = BASELINE_ACTIONS.filter((a) => a.context === 'global').find((action) =>
      this.isMatch(action, key),
    );

    return matchGlobal || null;
  }

  private isMatch(action: KeyBindingAction, key: string): boolean {
    const override = this.customOverrides.get(action.id);
    const keysToCheck = override && override.length > 0 ? override : action.defaultKeys;
    return keysToCheck.includes(key);
  }

  /**
   * Checks if Ctrl+Z was pressed twice within 1500ms to allow safe suspend.
   */
  public checkDoubleSuspend(): boolean {
    const now = Date.now();
    if (now - this.lastSuspendTime < 1500) {
      this.lastSuspendTime = 0;
      return true;
    }
    this.lastSuspendTime = now;
    return false;
  }

  /**
   * Lists all keybindings active in the current context (useful for footer or '?' shortcut help).
   */
  public getActiveBindings(context: KeyContext): Array<{ name: string; key: string; description: string }> {
    const actions = [
      ...BASELINE_ACTIONS.filter((a) => a.context === context),
      ...(context !== 'global' ? BASELINE_ACTIONS.filter((a) => a.context === 'global') : []),
    ];

    const seen = new Set<string>();
    const result: Array<{ name: string; key: string; description: string }> = [];

    for (const a of actions) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      const keys = this.customOverrides.get(a.id) || a.defaultKeys;
      result.push({
        name: a.name,
        key: keys.join(' / '),
        description: a.description,
      });
    }

    return result;
  }
}
