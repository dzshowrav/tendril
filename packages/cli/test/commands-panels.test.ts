import { describe, it, expect, vi } from 'vitest';
import { SlashCommandRegistry } from '../src/commands/registry.js';
import {
  createDefaultCommandRegistry,
  copyToTerminalClipboard,
} from '../src/commands/defaults.js';
import {
  createPanelState,
  filterPanelItems,
  movePanelCursor,
  renderPanel,
} from '../src/components/panels/framework.js';
import { createHelpPanelState, renderHelpPanel } from '../src/components/panels/help-panel.js';
import {
  createSessionPanelState,
  filterSessionsByWorkspace,
  formatSessionTimestamp,
  renderSessionPanel,
} from '../src/components/panels/session-panel.js';
import { createModelPanelState, renderModelPanel } from '../src/components/panels/model-panel.js';
import { createContextPanelState, renderContextPanel, formatProgressBar } from '../src/components/panels/context-panel.js';
import { createUsagePanelState, renderUsagePanel } from '../src/components/panels/usage-panel.js';
import { createToolsPanelState, renderToolsPanel } from '../src/components/panels/tools-panel.js';
import { createSettingsPanelState, renderSettingsPanel } from '../src/components/panels/settings-panel.js';
import { resolveActiveTheme } from '../src/theme/loader.js';

describe('Phase 4: Slash Commands & Overlay Panels (new-ins.md § 10, § 15, § 17, § 21)', () => {
  const theme = resolveActiveTheme({ themeName: 'dark' });

  describe('SlashCommandRegistry (§ 15.1)', () => {
    it('registers commands, aliases, and resolves them cleanly', () => {
      const reg = new SlashCommandRegistry();
      reg.register({
        name: 'test',
        aliases: ['t', 'check'],
        description: 'Test command description',
        category: 'utility',
        execute: async () => ({ success: true }),
      });

      expect(reg.get('test')?.name).toBe('test');
      expect(reg.get('t')?.name).toBe('test');
      expect(reg.get('/check')?.name).toBe('test');
      expect(reg.get('unknown')).toBeUndefined();
    });

    it('filters commands by category and performs autocomplete and fuzzy search', () => {
      const reg = createDefaultCommandRegistry();

      const sessionCmds = reg.listByCategory('session');
      expect(sessionCmds.some((c) => c.name === 'chat')).toBe(true);
      expect(sessionCmds.some((c) => c.name === 'compact')).toBe(true);
      expect(sessionCmds.some((c) => c.name === 'rewind')).toBe(true);

      const auto = reg.autocomplete('mo');
      expect(auto.some((c) => c.name === 'model')).toBe(true);
      expect(auto.some((c) => c.name === 'mode')).toBe(true);

      const fuzzy = reg.fuzzySearch('summarize');
      expect(fuzzy.some((c) => c.name === 'compact')).toBe(true);
    });

    it('executes command through registry with context', async () => {
      const reg = new SlashCommandRegistry();
      let executed = false;
      reg.register({
        name: 'ping',
        description: 'Ping test',
        category: 'utility',
        execute: async (ctx, args) => {
          executed = true;
          ctx.output(`pong ${args}`);
          return { success: true };
        },
      });

      let outputText = '';
      const mockCtx: any = {
        theme,
        output: (t: string) => { outputText += t; },
      };

      const res = await reg.execute('/ping hello', mockCtx);
      expect(executed).toBe(true);
      expect(outputText).toBe('pong hello');
      expect(res?.success).toBe(true);
    });
  });

  describe('Overlay Panel Framework (§ 10)', () => {
    it('creates panel state, filters with search query, and moves cursor', () => {
      const state = createPanelState({
        title: 'Test Panel',
        items: [
          { id: '1', title: 'Apple', description: 'Fruit', category: 'food' },
          { id: '2', title: 'Banana', description: 'Fruit', category: 'food' },
          { id: '3', title: 'Carrot', description: 'Vegetable', category: 'food' },
        ],
        pageSize: 2,
      });

      expect(state.items.length).toBe(3);
      expect(state.selectedIndex).toBe(0);

      // Move cursor down
      const next = movePanelCursor(state, 1);
      expect(next.selectedIndex).toBe(1);

      // Move past page boundary
      const next2 = movePanelCursor(next, 1);
      expect(next2.selectedIndex).toBe(2);
      expect(next2.scrollOffset).toBe(1);

      // Filter
      const filtered = filterPanelItems(state, 'Carrot');
      expect(filtered.filteredItems.length).toBe(1);
      expect(filtered.filteredItems[0].title).toBe('Carrot');
    });

    it('renders panel with borders, title, and shortcuts', () => {
      const state = createPanelState({
        title: 'Demo Panel',
        items: [{ id: '1', title: 'Item 1', description: 'Test' }],
      });

      const rendered = renderPanel(state, theme);
      expect(rendered).toContain('Demo Panel');
      expect(rendered).toContain('Search:');
      expect(rendered).toContain('Item 1');
      expect(rendered).toContain('Enter: select');
    });
  });

  describe('Dedicated Panels (§ 10, § 17, § 8.1)', () => {
    it('HelpPanel lists all commands from registry', () => {
      const reg = createDefaultCommandRegistry();
      const state = createHelpPanelState(reg);
      const rendered = renderHelpPanel(state, theme);

      expect(rendered).toContain('Command Help');
      expect(state.items.length).toBeGreaterThanOrEqual(10);
    });

    it('SessionPanel scopes to workspace and shows relative time and active marker', () => {
      const sessions = [
        { id: 'sess_1', title: 'My Work', workspace_path: '/home/project', updated_at: new Date().toISOString() },
        { id: 'sess_2', title: 'Other Work', workspace_path: '/other/path', updated_at: new Date().toISOString() },
      ];

      // Scoped filter
      const scoped = filterSessionsByWorkspace(sessions, '/home/project', true);
      expect(scoped.length).toBe(1);
      expect(scoped[0].id).toBe('sess_1');

      // Relative timestamp formatting
      expect(formatSessionTimestamp(new Date().toISOString())).toBe('just now');

      const state = createSessionPanelState({
        sessions,
        currentSessionId: 'sess_1',
        workspacePath: '/home/project',
      });
      const rendered = renderSessionPanel(state, theme);
      expect(rendered).toContain('CURRENT: My Work');
    });

    it('ModelPanel displays active model, thinking effort, and dedicated fallback row (§ 8.1)', () => {
      const state = createModelPanelState({
        currentModel: 'claude-3-5-sonnet',
        models: [
          { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
          { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
        ],
        fallbackChain: ['gemini-2.5-flash', 'gpt-4o'],
        thinkingEffort: 'high',
      });

      const rendered = renderModelPanel(state, theme);
      expect(rendered).toContain('Thinking / Effort');
      expect(rendered).toContain('HIGH');
      expect(rendered).toContain('Model Fallback Chain');
      expect(rendered).toContain('gemini-2.5-flash ➔ gpt-4o');
      expect(rendered).toContain('ACTIVE: Claude 3.5 Sonnet');
    });

    it('ContextPanel displays token breakdown and progress bar', () => {
      expect(formatProgressBar(50, 10, '■', '─')).toBe('■■■■■─────');

      const state = createContextPanelState({
        totalTokens: 1000,
        maxTokens: 10000,
        items: [
          { id: 'msg', type: 'message', label: 'User Messages', tokenCount: 800 },
          { id: 'sys', type: 'system', label: 'System Prompt', tokenCount: 200 },
        ],
      });

      const rendered = renderContextPanel(state, theme);
      expect(rendered).toContain('Total Context Usage');
      expect(rendered).toContain('User Messages');
      expect(rendered).toContain('Compact / Clear Context');
    });

    it('UsagePanel displays quotas, balance, and session metrics', () => {
      const state = createUsagePanelState({
        sessionInputTokens: 500,
        sessionOutputTokens: 250,
        sessionTotalTokens: 750,
        creditBalance: 25.50,
        dailyTokenLimit: 100000,
        dailyTokensUsed: 50000,
      });

      const rendered = renderUsagePanel(state, theme);
      expect(rendered).toContain('Current Session Tokens: 750');
      expect(rendered).toContain('Daily Quota:');
      expect(rendered).toContain('$25.50');
    });

    it('ToolsPanel lists registered tools and trust states', () => {
      const state = createToolsPanelState({
        tools: [
          { name: 'read_file', category: 'filesystem', trustState: 'allow_always' },
          { name: 'bash', category: 'shell', trustState: 'ask' },
        ],
        mcpServers: [{ name: 'filesystem', status: 'connected', toolCount: 5 }],
      });

      const rendered = renderToolsPanel(state, theme);
      expect(rendered).toContain('MCP Server: filesystem');
      expect(rendered).toContain('read_file (always allowed)');
      expect(rendered).toContain('bash (ask on use)');
    });

    it('SettingsPanel lists configurable preferences', () => {
      const state = createSettingsPanelState({
        currentTheme: 'dark',
        uiMode: 'rich',
        isNoColor: false,
        synchronizedOutput: true,
        hyperlinks: true,
        historyMode: 'session',
      });

      const rendered = renderSettingsPanel(state, theme);
      expect(rendered).toContain('Theme: dark');
      expect(rendered).toContain('Color Mode: Color Enabled');
      expect(rendered).toContain('Synchronized Output: ON');
    });
  });

  describe('Special Commands (§ 15.3)', () => {
    it('/copy generates valid OSC 52 sequence for SSH compatibility', () => {
      const text = 'Hello world from Tendril';
      const osc52 = copyToTerminalClipboard(text);
      expect(osc52).toMatch(/^\x1b\]52;c;[A-Za-z0-9+/=]+\x07$/);

      // Base64 decode to verify content matches
      const b64 = osc52.slice(7, -1);
      expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(text);
    });

    it('/rewind forks conversation at earlier turn without deleting original history', async () => {
      const reg = createDefaultCommandRegistry();
      const mockClient: any = {
        getSession: vi.fn().mockResolvedValue({
          session: { id: 'orig_sess', title: 'Original Task', workspace_path: '/project' },
          messages: [
            { role: 'user', content: 'Turn 1' },
            { role: 'assistant', content: 'Reply 1' },
            { role: 'user', content: 'Turn 2' },
            { role: 'assistant', content: 'Reply 2' },
          ],
        }),
        createSession: vi.fn().mockResolvedValue({
          session: { id: 'forked_sess', title: 'Original Task (forked at turn 2)', workspace_path: '/project' },
        }),
      };

      let output = '';
      let activeSession = { id: 'orig_sess', title: 'Original Task', workspace_path: '/project' };
      const ctx: any = {
        client: mockClient,
        currentSession: activeSession,
        setSession: (s: any) => { activeSession = s; },
        theme,
        reconnectStream: vi.fn(),
        printHeader: vi.fn(),
        output: (t: string) => { output += t; },
      };

      const res = await reg.execute('/rewind 2', ctx);
      expect(res?.success).toBe(true);
      expect(mockClient.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          workspace: '/project',
          title: expect.stringContaining('(forked at turn 2)'),
        }),
      );
      expect(activeSession.id).toBe('forked_sess');
      expect(output).toContain('Original history preserved intact');
    });

    it('/compact reports summarized message count to user', async () => {
      const reg = createDefaultCommandRegistry();
      const mockClient: any = {
        compactSession: vi.fn().mockResolvedValue({
          ok: true,
          droppedMessages: 6,
        }),
      };

      let output = '';
      const ctx: any = {
        client: mockClient,
        currentSession: { id: 'sess_1' },
        theme,
        output: (t: string) => { output += t; },
      };

      const res = await reg.execute('/compact', ctx);
      expect(res?.success).toBe(true);
      expect(mockClient.compactSession).toHaveBeenCalledWith('sess_1');
      expect(output).toContain('6 messages summarized to free context window space');
    });
  });
});
