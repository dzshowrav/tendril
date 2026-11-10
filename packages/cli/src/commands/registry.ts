/**
 * Unified Slash Command Registry.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 15, § 21).
 *
 * Requirements:
 * - All commands originate from this registry.
 * - Help panel, autocomplete, and fuzzy picker all query this registry.
 * - Each command defines name, aliases, description, argument schema, and category.
 */

import { TendrilClient } from '../client.js';
import { ActiveTheme } from '../theme/loader.js';

export type CommandCategory =
  | 'help'
  | 'session'
  | 'context'
  | 'model'
  | 'agent'
  | 'tools'
  | 'ui'
  | 'input'
  | 'workflow'
  | 'utility';

export interface CommandContext {
  client: TendrilClient;
  currentSession: any;
  setSession: (session: any) => void;
  theme: ActiveTheme;
  reconnectStream: () => void;
  promptLine: (query: string) => Promise<string>;
  printHeader: () => void;
  exit: () => void;
  output: (text: string) => void;
  customData?: Record<string, any>;
}

export interface CommandResult {
  success: boolean;
  message?: string;
  data?: any;
}

export interface SlashCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  category: CommandCategory;
  argumentSchema?: string;
  harnessVersion?: string;
  execute: (ctx: CommandContext, args: string) => Promise<CommandResult | void>;
}

export class SlashCommandRegistry {
  private commands = new Map<string, SlashCommandDefinition>();
  private aliasMap = new Map<string, string>();

  /**
   * Registers a slash command definition.
   */
  public register(cmd: SlashCommandDefinition): void {
    const primaryName = cmd.name.toLowerCase().replace(/^\//, '');
    this.commands.set(primaryName, cmd);

    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        const cleanAlias = alias.toLowerCase().replace(/^\//, '');
        this.aliasMap.set(cleanAlias, primaryName);
      }
    }
  }

  /**
   * Resolves a command by its name or alias.
   */
  public get(nameOrAlias: string): SlashCommandDefinition | undefined {
    const clean = nameOrAlias.toLowerCase().replace(/^\//, '').trim();
    if (this.commands.has(clean)) {
      return this.commands.get(clean);
    }
    const resolvedName = this.aliasMap.get(clean);
    if (resolvedName && this.commands.has(resolvedName)) {
      return this.commands.get(resolvedName);
    }
    return undefined;
  }

  /**
   * Returns all registered commands.
   */
  public list(): SlashCommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /**
   * Returns commands filtered by category.
   */
  public listByCategory(category: CommandCategory): SlashCommandDefinition[] {
    return this.list().filter((cmd) => cmd.category === category);
  }

  /**
   * Autocompletes a given prefix against command names and aliases.
   */
  public autocomplete(prefix: string): SlashCommandDefinition[] {
    const clean = prefix.toLowerCase().replace(/^\//, '').trim();
    const results = new Set<SlashCommandDefinition>();

    for (const [name, cmd] of this.commands.entries()) {
      if (name.startsWith(clean)) {
        results.add(cmd);
      }
    }

    for (const [alias, primaryName] of this.aliasMap.entries()) {
      if (alias.startsWith(clean)) {
        const cmd = this.commands.get(primaryName);
        if (cmd) results.add(cmd);
      }
    }

    return Array.from(results);
  }

  /**
   * Fuzzy matches commands based on query string.
   */
  public fuzzySearch(query: string): SlashCommandDefinition[] {
    const q = query.toLowerCase().replace(/^\//, '').trim();
    if (!q) return this.list();

    return this.list().filter((cmd) => {
      if (cmd.name.toLowerCase().includes(q)) return true;
      if (cmd.description.toLowerCase().includes(q)) return true;
      if (cmd.category.toLowerCase().includes(q)) return true;
      if (cmd.aliases?.some((a) => a.toLowerCase().includes(q))) return true;
      return false;
    });
  }

  /**
   * Executes a slash command string (e.g. "/model claude-3-5-sonnet").
   */
  public async execute(
    input: string,
    ctx: CommandContext,
  ): Promise<CommandResult | void> {
    const trimmed = input.trim();
    if (!trimmed.startsWith('/')) {
      return { success: false, message: 'Not a slash command' };
    }

    const parts = trimmed.slice(1).split(/\s+/);
    const cmdName = parts[0];
    const args = parts.slice(1).join(' ');

    const cmd = this.get(cmdName);
    if (!cmd) {
      ctx.output(
        `${ctx.theme.colors.textError('Unknown command:')} /${cmdName}. Type ${ctx.theme.colors.textAccent('/help')} for available commands.\n`,
      );
      return { success: false, message: `Unknown command: /${cmdName}` };
    }

    try {
      return await cmd.execute(ctx, args);
    } catch (err: any) {
      ctx.output(
        `${ctx.theme.colors.textError('Command error:')} ${err.message || String(err)}\n`,
      );
      return { success: false, message: err.message };
    }
  }
}
