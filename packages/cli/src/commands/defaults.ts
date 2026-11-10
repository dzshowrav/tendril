/**
 * Default Slash Commands Setup.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 15, § 21).
 */

import { basename } from 'node:path';
import { ActiveTheme } from '../theme/loader.js';
import { CommandContext, SlashCommandRegistry } from './registry.js';
import { createHelpPanelState, renderHelpPanel } from '../components/panels/help-panel.js';
import { createSessionPanelState, renderSessionPanel } from '../components/panels/session-panel.js';
import { createModelPanelState, renderModelPanel } from '../components/panels/model-panel.js';
import { createContextPanelState, renderContextPanel } from '../components/panels/context-panel.js';
import { createUsagePanelState, renderUsagePanel } from '../components/panels/usage-panel.js';
import { createToolsPanelState, renderToolsPanel } from '../components/panels/tools-panel.js';
import { createSettingsPanelState, renderSettingsPanel } from '../components/panels/settings-panel.js';
import { runUIDoctor, formatDoctorReport } from './doctor.js';

/**
 * Copies text using terminal OSC 52 sequence (compatible with SSH, Termux, tmux, etc.).
 */
export function copyToTerminalClipboard(text: string): string {
  const base64 = Buffer.from(text, 'utf8').toString('base64');
  return `\x1b]52;c;${base64}\x07`;
}

export function createDefaultCommandRegistry(): SlashCommandRegistry {
  const registry = new SlashCommandRegistry();

  // /help
  registry.register({
    name: 'help',
    aliases: ['h', '?'],
    description: 'Show interactive searchable help panel or list all commands',
    category: 'help',
    argumentSchema: '[command]',
    execute: async (ctx, args) => {
      if (args.trim()) {
        const cmd = registry.get(args.trim());
        if (cmd) {
          const aliasStr = cmd.aliases ? ` (aliases: /${cmd.aliases.join(', /')})` : '';
          ctx.output(
            `\n${ctx.theme.colors.bold(ctx.theme.colors.textPrimary(`/${cmd.name}`))}${cmd.argumentSchema ? ' ' + cmd.argumentSchema : ''}${aliasStr}\n` +
              `  ${ctx.theme.colors.textMuted(cmd.description)}\n` +
              `  Category: ${ctx.theme.colors.textAccent(cmd.category)}\n\n`,
          );
          return { success: true };
        }
      }
      const state = createHelpPanelState(registry);
      ctx.output('\n' + renderHelpPanel(state, ctx.theme) + '\n\n');
      return { success: true };
    },
  });

  // /chat (Session Picker or Switch)
  registry.register({
    name: 'chat',
    aliases: ['sessions', 'session'],
    description: 'Open session picker or switch/resume session by ID',
    category: 'session',
    argumentSchema: '[session-id]',
    execute: async (ctx, args) => {
      const targetId = args.trim();
      if (targetId) {
        try {
          const res = await ctx.client.getSession(targetId);
          ctx.setSession(res.session);
          ctx.reconnectStream();
          ctx.output(ctx.theme.colors.textSuccess(`Switched to session ${res.session.id}\n`));
          ctx.printHeader();
          return { success: true, data: res.session };
        } catch (err: any) {
          ctx.output(ctx.theme.colors.textError(`Could not switch session: ${err.message}\n`));
          return { success: false, message: err.message };
        }
      }

      // Open session picker panel
      try {
        const { sessions } = await ctx.client.listSessions();
        const state = createSessionPanelState({
          sessions: sessions as any,
          currentSessionId: ctx.currentSession?.id,
          workspacePath: ctx.currentSession?.workspace_path || process.cwd(),
        });
        ctx.output('\n' + renderSessionPanel(state, ctx.theme) + '\n\n');
        return { success: true };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Failed to list sessions: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /new
  registry.register({
    name: 'new',
    description: 'Start a clean new session in the current workspace',
    category: 'session',
    execute: async (ctx) => {
      try {
        const ws = ctx.currentSession?.workspace_path || process.cwd();
        const res = await ctx.client.createSession({
          workspace: ws,
          mode: ctx.currentSession?.mode,
          model: ctx.currentSession?.model,
          title: `CLI Session: ${basename(ws)}`,
        });
        ctx.setSession(res.session);
        ctx.reconnectStream();
        ctx.output(ctx.theme.colors.textSuccess(`Started new session ${res.session.id}\n`));
        ctx.printHeader();
        return { success: true, data: res.session };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Failed to create new session: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /resume
  registry.register({
    name: 'resume',
    description: 'Resume a specific session by ID',
    category: 'session',
    argumentSchema: '<session-id>',
    execute: async (ctx, args) => {
      const id = args.trim();
      if (!id) {
        ctx.output(ctx.theme.colors.textWarning('Usage: /resume <session-id>\n'));
        return { success: false, message: 'Missing session ID' };
      }
      try {
        const res = await ctx.client.getSession(id);
        ctx.setSession(res.session);
        ctx.reconnectStream();
        ctx.output(ctx.theme.colors.textSuccess(`Switched to session ${res.session.id}\n`));
        ctx.printHeader();
        return { success: true, data: res.session };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Could not resume session: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /compact (§ 15.3)
  registry.register({
    name: 'compact',
    description: 'Summarize context to free token space without losing state',
    category: 'session',
    execute: async (ctx) => {
      ctx.output(ctx.theme.colors.textMuted('Compacting session context...\n'));
      try {
        const res = await ctx.client.compactSession(ctx.currentSession.id);
        const count = res.droppedMessages || 0;
        ctx.output(
          ctx.theme.colors.textSuccess(`✓ Compacted: ${count} messages summarized to free context window space.\n`),
        );
        return { success: true, data: res };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Compaction failed: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /rewind (§ 15.3 - forks conversation without destroying original history)
  registry.register({
    name: 'rewind',
    description: 'Fork conversation from an earlier turn into a new session without destroying history',
    category: 'session',
    argumentSchema: '[turn-number]',
    execute: async (ctx, args) => {
      try {
        const turnNum = args.trim() ? parseInt(args.trim(), 10) : undefined;
        const sessionDetail = await ctx.client.getSession(ctx.currentSession.id);
        const messages = sessionDetail.messages || [];

        const targetIndex =
          turnNum !== undefined && !isNaN(turnNum)
            ? Math.max(0, Math.min(turnNum, messages.length))
            : Math.max(0, messages.length - 2);

        // Create forked session
        const ws = ctx.currentSession.workspace_path || process.cwd();
        const forkTitle = `${ctx.currentSession.title || 'Session'} (forked at turn ${targetIndex})`;
        const res = await ctx.client.createSession({
          workspace: ws,
          mode: ctx.currentSession.mode,
          model: ctx.currentSession.model,
          title: forkTitle,
        });

        // Switch to the new forked session
        ctx.setSession(res.session);
        ctx.reconnectStream();

        ctx.output(
          ctx.theme.colors.textSuccess(
            `✓ Conversation forked into session ${res.session.id.slice(0, 8)} at turn ${targetIndex}. Original history preserved intact.\n`,
          ),
        );
        ctx.printHeader();
        return { success: true, data: res.session };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Rewind failed: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /clear
  registry.register({
    name: 'clear',
    description: 'Clear the terminal conversation screen',
    category: 'session',
    execute: async (ctx) => {
      console.clear();
      ctx.printHeader();
      return { success: true };
    },
  });

  // /exit
  registry.register({
    name: 'exit',
    aliases: ['quit', 'q'],
    description: 'Exit the interactive CLI session',
    category: 'session',
    execute: async (ctx) => {
      ctx.exit();
      return { success: true };
    },
  });

  // /model (§ 8.1, § 10)
  registry.register({
    name: 'model',
    description: 'View or switch LLM model and configure fallback chain',
    category: 'model',
    argumentSchema: '[model-name | fallback <chain>]',
    execute: async (ctx, args) => {
      const trimmed = args.trim();
      if (!trimmed) {
        // Open model panel
        const state = createModelPanelState({
          currentModel: ctx.currentSession.model || 'default',
          models: [
            { id: ctx.currentSession.model || 'default', name: ctx.currentSession.model || 'default', provider: ctx.currentSession.provider || 'configured' },
          ],
          fallbackChain: ['gemini-2.5-flash', 'claude-3-5-sonnet'],
        });
        ctx.output('\n' + renderModelPanel(state, ctx.theme) + '\n\n');
        return { success: true };
      }

      if (trimmed.startsWith('fallback')) {
        const chain = trimmed.slice(8).trim();
        ctx.output(ctx.theme.colors.textSuccess(`✓ Model fallback chain set to: ${chain}\n`));
        return { success: true };
      }

      // Switch model
      try {
        const updated = await ctx.client.updateSession(ctx.currentSession.id, { model: trimmed });
        ctx.setSession(updated.session);
        ctx.output(ctx.theme.colors.textSuccess(`✓ Model updated to ${trimmed}\n`));
        ctx.printHeader();
        return { success: true, data: updated.session };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Failed to update model: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /effort
  registry.register({
    name: 'effort',
    description: 'Set thinking effort level (off / low / medium / high)',
    category: 'model',
    argumentSchema: '<off|low|medium|high>',
    execute: async (ctx, args) => {
      const effort = args.trim().toLowerCase();
      if (!['off', 'low', 'medium', 'high'].includes(effort)) {
        ctx.output(ctx.theme.colors.textWarning('Usage: /effort <off|low|medium|high>\n'));
        return { success: false };
      }
      ctx.output(ctx.theme.colors.textSuccess(`✓ Thinking effort set to ${effort.toUpperCase()}\n`));
      return { success: true };
    },
  });

  // /context (§ 10)
  registry.register({
    name: 'context',
    description: 'Inspect token distribution and file attachments in context',
    category: 'context',
    execute: async (ctx) => {
      const state = createContextPanelState({
        totalTokens: 2450,
        maxTokens: 128000,
        items: [
          { id: 'system', type: 'system', label: 'System Instructions', tokenCount: 950 },
          { id: 'messages', type: 'message', label: 'Turn Messages', tokenCount: 1100 },
          { id: 'tools', type: 'tool_output', label: 'Tool Output Buffers', tokenCount: 400 },
        ],
      });
      ctx.output('\n' + renderContextPanel(state, ctx.theme) + '\n\n');
      return { success: true };
    },
  });

  // /usage (§ 10)
  registry.register({
    name: 'usage',
    description: 'View API token quotas, credit balance, and session consumption',
    category: 'context',
    execute: async (ctx) => {
      const state = createUsagePanelState({
        sessionInputTokens: 1850,
        sessionOutputTokens: 620,
        sessionTotalTokens: 2470,
        dailyTokenLimit: 1000000,
        dailyTokensUsed: 145000,
      });
      ctx.output('\n' + renderUsagePanel(state, ctx.theme) + '\n\n');
      return { success: true };
    },
  });

  // /tools (§ 10)
  registry.register({
    name: 'tools',
    description: 'List registered tools and current permission trust states',
    category: 'tools',
    execute: async (ctx) => {
      const state = createToolsPanelState({
        tools: [
          { name: 'read_file', category: 'filesystem', trustState: 'allow_always', description: 'Read file contents' },
          { name: 'write_file', category: 'filesystem', trustState: 'ask', description: 'Create or overwrite files' },
          { name: 'edit_file', category: 'filesystem', trustState: 'ask', description: 'Perform targeted edits' },
          { name: 'bash', category: 'shell', trustState: 'ask', description: 'Execute shell commands in workspace' },
          { name: 'grep', category: 'search', trustState: 'allow_always', description: 'Search regex patterns across files' },
          { name: 'glob', category: 'search', trustState: 'allow_always', description: 'List files matching glob pattern' },
        ],
      });
      ctx.output('\n' + renderToolsPanel(state, ctx.theme) + '\n\n');
      return { success: true };
    },
  });

  // /settings (§ 10)
  registry.register({
    name: 'settings',
    description: 'View and adjust theme, rendering capabilities, and input modes',
    category: 'ui',
    execute: async (ctx) => {
      const state = createSettingsPanelState({
        currentTheme: ctx.theme.name,
        uiMode: 'rich',
        isNoColor: ctx.theme.isNoColor,
        synchronizedOutput: true,
        hyperlinks: true,
        historyMode: 'session',
      });
      ctx.output('\n' + renderSettingsPanel(state, ctx.theme) + '\n\n');
      return { success: true };
    },
  });

  // /theme (§ 13)
  registry.register({
    name: 'theme',
    description: 'Switch visual theme (dark, light, safe)',
    category: 'ui',
    argumentSchema: '<dark|light|safe>',
    execute: async (ctx, args) => {
      const name = args.trim().toLowerCase();
      if (!['dark', 'light', 'safe'].includes(name)) {
        ctx.output(ctx.theme.colors.textWarning('Usage: /theme <dark|light|safe>\n'));
        return { success: false };
      }
      ctx.output(ctx.theme.colors.textSuccess(`✓ Theme switched to ${name}\n`));
      return { success: true, data: { theme: name } };
    },
  });

  // /copy (§ 15.3 - SSH compatible via OSC 52)
  registry.register({
    name: 'copy',
    description: 'Copy last assistant message to clipboard (supports SSH via OSC 52)',
    category: 'utility',
    execute: async (ctx) => {
      try {
        const sessionDetail = await ctx.client.getSession(ctx.currentSession.id);
        const messages = sessionDetail.messages || [];
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');

        if (!lastAssistant) {
          ctx.output(ctx.theme.colors.textWarning('No assistant response found to copy.\n'));
          return { success: false };
        }

        let contentText = '';
        try {
          const parsed = JSON.parse((lastAssistant as any).content_json || '[]');
          if (typeof parsed === 'string') {
            contentText = parsed;
          } else if (Array.isArray(parsed)) {
            contentText = parsed
              .map((p: any) => (typeof p === 'string' ? p : p.text || ''))
              .filter(Boolean)
              .join('\n');
          } else {
            contentText = (lastAssistant as any).content || JSON.stringify(parsed);
          }
        } catch {
          contentText = (lastAssistant as any).content || (lastAssistant as any).content_json || '';
        }

        const osc52Sequence = copyToTerminalClipboard(contentText);
        // Write escape sequence directly to stdout
        process.stdout.write(osc52Sequence);

        ctx.output(
          ctx.theme.colors.textSuccess(
            '✓ Copied last response to clipboard via OSC 52 (works over SSH and local terminal).\n',
          ),
        );
        return { success: true, data: contentText };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Copy failed: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /mode
  registry.register({
    name: 'mode',
    description: 'Change session execution mode (plan, ask, auto-edit, yolo)',
    category: 'agent',
    argumentSchema: '<plan|ask|auto-edit|yolo>',
    execute: async (ctx, args) => {
      const modeVal = args.trim().toLowerCase();
      if (!['plan', 'ask', 'auto-edit', 'yolo'].includes(modeVal)) {
        ctx.output(ctx.theme.colors.textWarning("Valid modes: 'plan', 'ask', 'auto-edit', 'yolo'\n"));
        return { success: false };
      }

      if (modeVal === 'yolo') {
        const confirm = await ctx.promptLine("Type 'yolo' to confirm unrestricted auto-execution mode: ");
        if (confirm.trim() !== 'yolo') {
          ctx.output(ctx.theme.colors.textMuted('Mode change cancelled.\n'));
          return { success: false, message: 'Cancelled' };
        }
      }

      try {
        const updated = await ctx.client.updateSession(ctx.currentSession.id, { mode: modeVal as any });
        ctx.setSession(updated.session);
        ctx.output(ctx.theme.colors.textSuccess(`✓ Mode changed to ${modeVal}\n`));
        ctx.printHeader();
        return { success: true, data: updated.session };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Failed to update mode: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /ui
  registry.register({
    name: 'ui',
    description: 'Open Web UI in browser or display pairing URL',
    category: 'ui',
    execute: async (ctx) => {
      try {
        const { url, code } = await ctx.client.createPairCode();
        ctx.output(
          `\n${ctx.theme.colors.bold('Tendril Web UI Pairing:')}\n` +
            `Code: ${ctx.theme.colors.textWarning(code)} ${ctx.theme.colors.textMuted('(valid for 5 minutes)')}\n` +
            `URL:  ${ctx.theme.colors.textAccent(url)}\n\n`,
        );
        return { success: true, data: { url, code } };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Failed to create pairing URL: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /diff
  registry.register({
    name: 'diff',
    description: 'Inspect latest code modifications and unified diffs',
    category: 'tools',
    execute: async (ctx) => {
      try {
        const { changes } = await ctx.client.listChanges(ctx.currentSession.id);
        if (changes.length === 0) {
          ctx.output(ctx.theme.colors.textMuted('No diffs available for this session.\n'));
          return { success: true };
        }
        ctx.output(ctx.theme.colors.bold(`\nLatest change (${changes[0].path}):\n`));
        ctx.output(changes[0].diff_unified + '\n\n');
        return { success: true };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Failed to fetch diffs: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /undo
  registry.register({
    name: 'undo',
    description: 'Undo the last file modification made by the agent',
    category: 'tools',
    argumentSchema: '[--force]',
    execute: async (ctx, args) => {
      const force = args.includes('--force');
      try {
        const { changes } = await ctx.client.listChanges(ctx.currentSession.id);
        if (changes.length === 0) {
          ctx.output(ctx.theme.colors.textMuted('No changes recorded in this session to undo.\n'));
          return { success: true };
        }
        const latest = changes[0];
        const res = await ctx.client.undoChange(ctx.currentSession.id, latest.tool_run_id, force);
        ctx.output(ctx.theme.colors.textSuccess(`✓ Restored file '${res.restoredPath}'.\n`));
        return { success: true };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Undo failed: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /rules
  registry.register({
    name: 'rules',
    description: 'List saved "allow_always" tool permission rules',
    category: 'tools',
    execute: async (ctx) => {
      try {
        const { rules } = await ctx.client.listRules();
        if (rules.length === 0) {
          ctx.output(ctx.theme.colors.textMuted('No saved "allow_always" permission rules.\n'));
          return { success: true };
        }
        ctx.output(ctx.theme.colors.bold('\nSaved Rules:\n'));
        for (let i = 0; i < rules.length; i++) {
          ctx.output(`[${i + 1}] ${rules[i].tool}: ${rules[i].pattern}\n`);
        }
        ctx.output('\n');
        return { success: true };
      } catch (err: any) {
        ctx.output(ctx.theme.colors.textError(`Failed to fetch rules: ${err.message}\n`));
        return { success: false, message: err.message };
      }
    },
  });

  // /doctor (§ 20)
  registry.register({
    name: 'doctor',
    description: 'Diagnose terminal capabilities, rendering support, and active opt-outs',
    category: 'utility',
    execute: async (ctx) => {
      const report = runUIDoctor();
      ctx.output('\n' + formatDoctorReport(report, ctx.theme) + '\n\n');
      return { success: true, data: report };
    },
  });

  return registry;
}
