/**
 * Pattern normalization and validation for permission rules.
 */

const COMPOUND_COMMAND_REGEX = /[;&|\n\r]|&&|\|\||\||\$\(|\`|[<>]|>>|<<|\b\$\(/;

export interface NormalizedPatternInfo {
  tool: string;
  pattern: string | null;
  canAllowAlways: boolean;
  disallowAlwaysReason?: string;
}

/**
 * Checks whether a shell command contains compound constructs (pipes, redirects, &&, ||, ;, $(), backticks, newlines).
 */
export function isCompoundBashCommand(command: string): boolean {
  if (!command || typeof command !== 'string') return false;
  return COMPOUND_COMMAND_REGEX.test(command);
}

/**
 * Normalizes a bash command for "allow always" rules.
 * Rules store the first command word plus its subcommand when simple (e.g. 'npm test', 'git status').
 * Refuses allow always for compound commands.
 */
export function normalizeBashCommand(command: string): NormalizedPatternInfo {
  if (!command || typeof command !== 'string') {
    return {
      tool: 'bash',
      pattern: null,
      canAllowAlways: false,
      disallowAlwaysReason: 'Empty command',
    };
  }

  const trimmed = command.trim();
  if (!trimmed) {
    return {
      tool: 'bash',
      pattern: null,
      canAllowAlways: false,
      disallowAlwaysReason: 'Empty command',
    };
  }

  if (isCompoundBashCommand(trimmed)) {
    return {
      tool: 'bash',
      pattern: null,
      canAllowAlways: false,
      disallowAlwaysReason:
        'Compound commands (pipes, redirects, &&, ||, ;, $(), backticks, newlines) cannot be saved as permanent rules',
    };
  }

  const tokens = trimmed.split(/\s+/);
  const first = tokens[0];

  let pattern: string;
  // If there is a subcommand and it is not a flag (e.g. "npm test", "git status")
  if (tokens.length >= 2 && !tokens[1].startsWith('-')) {
    pattern = `${first} ${tokens[1]}`;
  } else {
    pattern = first;
  }

  return {
    tool: 'bash',
    pattern,
    canAllowAlways: true,
  };
}

/**
 * Normalizes tool pattern and checks if "allow always" can be permitted.
 */
export function normalizeToolPattern(toolName: string, input: Record<string, unknown>): NormalizedPatternInfo {
  if (toolName === 'bash') {
    const cmd = (input.command as string) || '';
    return normalizeBashCommand(cmd);
  }

  if (toolName === 'write_file' || toolName === 'edit_file') {
    return {
      tool: 'edit',
      pattern: '*',
      canAllowAlways: true,
    };
  }

  if (toolName === 'web_fetch') {
    try {
      const url = new URL(input.url as string);
      return {
        tool: 'web_fetch',
        pattern: url.hostname,
        canAllowAlways: true,
      };
    } catch {
      return {
        tool: 'web_fetch',
        pattern: null,
        canAllowAlways: false,
        disallowAlwaysReason: 'Invalid URL',
      };
    }
  }

  if (toolName === 'termux_api') {
    const cmd = (input.command as string) || '';
    return {
      tool: 'termux_api',
      pattern: cmd.trim() || null,
      canAllowAlways: Boolean(cmd.trim()),
      disallowAlwaysReason: cmd.trim() ? undefined : 'Missing sub-command',
    };
  }

  // Default fallback for any other tool
  return {
    tool: toolName,
    pattern: '*',
    canAllowAlways: true,
  };
}

/**
 * Checks if a given tool execution matches a stored permission rule.
 */
export function matchesPermissionRule(
  ruleTool: string,
  rulePattern: string,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  if (ruleTool === 'bash' && toolName === 'bash') {
    const command = ((input.command as string) || '').trim();
    if (!command) return false;
    // Prefix match: exact or followed by space
    return command === rulePattern || command.startsWith(`${rulePattern} `);
  }

  if (ruleTool === 'edit' && (toolName === 'write_file' || toolName === 'edit_file')) {
    return rulePattern === '*' || rulePattern === input.path;
  }

  if (ruleTool === 'web_fetch' && toolName === 'web_fetch') {
    try {
      const url = new URL(input.url as string);
      return url.hostname === rulePattern || url.hostname.endsWith(`.${rulePattern}`);
    } catch {
      return false;
    }
  }

  if (ruleTool === 'termux_api' && toolName === 'termux_api') {
    const cmd = ((input.command as string) || '').trim();
    return rulePattern === cmd;
  }

  return ruleTool === toolName && (rulePattern === '*' || rulePattern === JSON.stringify(input));
}
