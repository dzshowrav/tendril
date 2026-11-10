import { describe, it, expect } from 'vitest';
import { ToolCardRegistry } from '../src/components/tool-cards/registry.js';
import { BashCard } from '../src/components/tool-cards/bash-card.js';
import { FileCard } from '../src/components/tool-cards/file-card.js';
import { McpCard } from '../src/components/tool-cards/mcp-card.js';
import { SubAgentCard } from '../src/components/tool-cards/subagent-card.js';
import { FallbackCard } from '../src/components/tool-cards/fallback-card.js';
import { formatHeadTailOutput } from '../src/components/tool-cards/collapsible.js';
import { ThinkingBlock } from '../src/components/thinking/block.js';
import { calculateShellTrustScopes, createAllPermissionWarning } from '../src/components/approval-bar/trust-scope.js';
import { ApprovalBar } from '../src/components/approval-bar/bar.js';
import { resolveActiveTheme } from '../src/theme/loader.js';

describe('Phase 3 Tools & Permissions UX', () => {
  const theme = resolveActiveTheme({ themeName: 'safe' });

  describe('ToolCardRegistry', () => {
    it('resolves dedicated card classes for known tools and fallback for unknown', () => {
      const reg = new ToolCardRegistry();
      expect(reg.get('bash')).toBeInstanceOf(BashCard);
      expect(reg.get('write_file')).toBeInstanceOf(FileCard);
      expect(reg.get('read_file')).toBeInstanceOf(FileCard);
      expect(reg.get('mcp:fetch_page')).toBeInstanceOf(McpCard);
      expect(reg.get('subagent:researcher')).toBeInstanceOf(SubAgentCard);
      expect(reg.get('custom_unknown_tool')).toBeInstanceOf(FallbackCard);
    });
  });

  describe('Collapsible Output (Head + Tail View)', () => {
    it('collapses output when line count exceeds thresholds', () => {
      const lines = Array.from({ length: 25 }, (_, i) => `Line ${i + 1}`);
      const collapsed = formatHeadTailOutput(lines, { maxHead: 3, maxTail: 3, isExpanded: false, theme });

      expect(collapsed.length).toBe(7); // 3 head + 1 collapse note + 3 tail
      expect(collapsed[0]).toContain('Line 1');
      expect(collapsed[3]).toContain('19 lines collapsed · Ctrl+O to expand');
      expect(collapsed[6]).toContain('Line 25');

      // Fully expanded
      const expanded = formatHeadTailOutput(lines, { maxHead: 3, maxTail: 3, isExpanded: true, theme });
      expect(expanded.length).toBe(25);
    });
  });

  describe('Dedicated Cards: McpCard & SubAgentCard', () => {
    it('McpCard renders all parameters inline in summary without expand', () => {
      const mcp = new McpCard();
      const output = mcp.renderStart({
        tool: 'weather_fetch',
        lifecycle: 'running',
        input: { city: 'Dhaka', units: 'celsius' },
        theme,
      });

      expect(output).toContain('weather_fetch');
      expect(output).toContain('city=');
      expect(output).toContain('"Dhaka"');
      expect(output).toContain('units=');
      expect(output).toContain('"celsius"');
    });

    it('SubAgentCard displays 1-line prompt preview and expands to full prompt', () => {
      const sub = new SubAgentCard();
      const longPrompt = 'Please analyze the entire codebase for security vulnerabilities in all endpoints';
      const startOut = sub.renderStart({
        tool: 'auditor',
        lifecycle: 'running',
        input: { prompt: longPrompt },
        theme,
      });

      expect(startOut).toContain('sub-agent:auditor');
      expect(startOut).toContain('Please analyze');

      // Expanded output
      const expandedOut = sub.renderRunning({
        tool: 'auditor',
        lifecycle: 'running',
        input: { prompt: longPrompt },
        isExpanded: true,
        theme,
      });
      expect(expandedOut).toContain(longPrompt);
    });
  });

  describe('ThinkingBlock Component', () => {
    it('streams and collapses reasoning traces', () => {
      const block = new ThinkingBlock({ theme, maxTailLines: 2 });
      block.append('First thought\nSecond thought\nThird thought\nFourth thought\nFifth thought');

      const collapsed = block.render();
      expect(collapsed).toContain('Thinking trace (5 lines)');
      expect(collapsed).toContain('3 lines collapsed · Ctrl+O to expand');
      expect(collapsed).toContain('Fourth thought');
      expect(collapsed).toContain('Fifth thought');

      block.toggleExpand();
      const expanded = block.render();
      expect(expanded).toContain('First thought');
      expect(expanded).toContain('Fifth thought');
      expect(expanded).not.toContain('collapsed');
    });

    it('emits nothing when showThinking is false', () => {
      const block = new ThinkingBlock({ showThinking: false });
      block.append('Some reasoning');
      expect(block.render()).toBe('');
    });
  });

  describe('ApprovalBar & 3-Tier Shell Trust Scope', () => {
    it('calculates 3 tiers of trust scopes for bash commands', () => {
      const scopes = calculateShellTrustScopes('git checkout -b feature/xyz');
      expect(scopes.length).toBe(3);

      expect(scopes[0].scope).toBe('exact');
      expect(scopes[0].pattern).toBe('git checkout -b feature/xyz');

      expect(scopes[1].scope).toBe('prefix');
      expect(scopes[1].pattern).toBe('git checkout*');

      expect(scopes[2].scope).toBe('base');
      expect(scopes[2].pattern).toBe('git*');
    });

    it('creates all-permission warning requiring explicit acknowledgement', () => {
      const warn = createAllPermissionWarning();
      expect(warn.requiresExplicitAck).toBe(true);
      expect(warn.warning).toContain('WARNING: All-permission mode');
    });

    it('renders queued permissions and presents active item cleanly', () => {
      const bar = new ApprovalBar(theme);
      bar.enqueue({
        id: 'req1',
        tool: 'bash',
        target: 'npm test',
        command: 'npm test',
      });
      bar.enqueue({
        id: 'req2',
        tool: 'write_file',
        target: 'src/main.ts',
      });

      expect(bar.remainingCount()).toBe(2);

      const rendered = bar.render(bar.current()!);
      expect(rendered).toContain('Permission Required');
      expect(rendered).toContain('[1 of 2 approvals]');
      expect(rendered).toContain('npm test');
      expect(rendered).toContain('Trust Scope');

      // Dequeue first
      bar.dequeue();
      expect(bar.remainingCount()).toBe(1);
    });
  });
});
