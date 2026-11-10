export type ShellTrustScope = 'exact' | 'prefix' | 'base';

export interface TrustScopeOptions {
  command: string;
  scope?: ShellTrustScope;
}

export interface TrustScopeRule {
  scope: ShellTrustScope;
  pattern: string;
  description: string;
}

/**
 * Calculates 3-tier shell command trust scopes:
 * 1. Exact command: Exactly this command string (narrowest, default)
 * 2. Command prefix: Commands starting with this prefix (e.g., git checkout *)
 * 3. Base command: Command base binary with all arguments (e.g., npm)
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 7.2).
 */
export function calculateShellTrustScopes(command: string): TrustScopeRule[] {
  const trimmed = (command || '').trim();
  if (!trimmed) {
    return [];
  }

  const tokens = trimmed.split(/\s+/);
  const base = tokens[0];

  // Exact rule
  const exactRule: TrustScopeRule = {
    scope: 'exact',
    pattern: trimmed,
    description: `Exact: Only "${trimmed}"`,
  };

  // Prefix rule (if command has arguments)
  const rules: TrustScopeRule[] = [exactRule];

  if (tokens.length >= 2) {
    const prefix = `${tokens[0]} ${tokens[1]}`;
    rules.push({
      scope: 'prefix',
      pattern: `${prefix}*`,
      description: `Prefix: "${prefix} ..."`,
    });
  }

  // Base command rule
  rules.push({
    scope: 'base',
    pattern: `${base}*`,
    description: `Base: Any "${base}" command`,
  });

  return rules;
}

/**
 * Security confirmation check before enabling all-permission mode (trust-all).
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 7.3).
 */
export interface AllPermissionConfirmation {
  warning: string;
  requiresExplicitAck: boolean;
  confirmed: boolean;
}

export function createAllPermissionWarning(): AllPermissionConfirmation {
  return {
    warning:
      'WARNING: All-permission mode permits executing any command or filesystem modification without approval prompts. This may lead to accidental data loss or security exposure.',
    requiresExplicitAck: true,
    confirmed: false,
  };
}
