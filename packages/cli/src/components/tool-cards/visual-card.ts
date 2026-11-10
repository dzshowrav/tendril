/**
 * 8-State Dedicated Tool Card Component.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 7).
 *
 * Implements the 8 distinct lifecycle states:
 * 1. needs_approval
 * 2. running
 * 3. success (collapsed)
 * 4. expanded (head + tail)
 * 5. error
 * 6. denied
 * 7. interrupted
 * 8. mcp_progress (16-char progress bar)
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';
import { visibleWidth, truncateVisible } from '../../ui/layout-calc.js';

export type ToolCardState =
  | 'needs_approval'
  | 'running'
  | 'success'
  | 'expanded'
  | 'error'
  | 'denied'
  | 'interrupted'
  | 'mcp_progress';

export interface VisualToolCardProps {
  tool: string;
  args?: Record<string, unknown>;
  state: ToolCardState;
  summary?: string;
  outputLines?: string[];
  elapsedSeconds?: number;
  exitCode?: number;
  userNote?: string;
  mcpProgress?: {
    current: number;
    total: number;
    percent: number;
  };
  spinnerFrame?: string;
  width?: number;
}

export class VisualToolCard {
  private activeTheme: ActiveTheme;
  private glyphs: GlyphSet;

  constructor(theme?: ActiveTheme, glyphs?: GlyphSet) {
    this.activeTheme = theme || resolveActiveTheme();
    this.glyphs = glyphs || getGlyphs();
  }

  public setTheme(theme: ActiveTheme): void {
    this.activeTheme = theme;
  }

  public setGlyphs(glyphs: GlyphSet): void {
    this.glyphs = glyphs;
  }

  /**
   * Formats tool call title according to § 7.8 naming convention.
   */
  public formatToolTitle(tool: string, args: Record<string, unknown> = {}, maxWidth = 76): string {
    let title = '';
    const norm = tool.toLowerCase();

    if (norm === 'bash' || norm === 'execute_command' || norm === 'run_command') {
      const cmd = (args.command || args.CommandLine || '') as string;
      const cleanCmd = cmd.replace(/\s+/g, ' ').trim();
      title = `Bash(${cleanCmd})`;
    } else if (norm === 'read_file' || norm === 'read') {
      const path = (args.path || args.Path || args.file || '') as string;
      title = `Read(${path})`;
    } else if (norm === 'write_file' || norm === 'write') {
      const path = (args.path || args.Path || args.file || '') as string;
      title = `Write(${path})`;
    } else if (norm === 'edit_file' || norm === 'update') {
      const path = (args.path || args.Path || args.file || '') as string;
      title = `Update(${path})`;
    } else if (norm === 'search_files' || norm === 'grep' || norm === 'search') {
      const p = (args.pattern || args.query || '') as string;
      const d = (args.path || args.dir || '.') as string;
      title = `Search(pattern: "${p}", path: "${d}")`;
    } else if (norm === 'find_files' || norm === 'glob' || norm === 'find') {
      const p = (args.pattern || '') as string;
      title = `Find(${p})`;
    } else if (tool.includes(':')) {
      // MCP format: server:tool(param1: val1, ...)
      const params = Object.entries(args)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ');
      title = `${tool}(${params})`;
    } else if (norm.includes('agent') || norm === 'invoke_subagent') {
      const name = (args.role || args.name || args.TypeName || 'agent') as string;
      const prompt = (args.prompt || args.Prompt || '') as string;
      const preview = prompt.length > 30 ? prompt.slice(0, 27) + '…' : prompt;
      title = `Agent(${name})  "${preview}"`;
    } else if (norm === 'web_search') {
      const q = (args.query || '') as string;
      title = `WebSearch("${q}")`;
    } else if (norm === 'fetch' || norm === 'web_fetch') {
      const u = (args.url || '') as string;
      title = `Fetch(${u})`;
    } else {
      const params = Object.entries(args)
        .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
        .join(', ');
      title = `${tool}(${params})`;
    }

    const available = Math.max(20, maxWidth - 2);
    return truncateVisible(title, available);
  }

  /**
   * Generates a 16-character progress bar: `[██████░░░░░░░░░░]`
   */
  public renderProgressBar(percent: number, totalSlots = 16): string {
    const clamped = Math.max(0, Math.min(100, percent));
    const fillCount = Math.round((clamped / 100) * totalSlots);
    const emptyCount = totalSlots - fillCount;
    const filled = this.glyphs.progressFill.repeat(fillCount);
    const empty = this.glyphs.progressEmpty.repeat(emptyCount);
    return `[${filled}${empty}]`;
  }

  /**
   * Renders the complete Tool Card lines for the given state.
   */
  public render(props: VisualToolCardProps): string[] {
    const noColor = isNoColor();
    const g = this.glyphs;
    const width = props.width || (process.stdout.columns || 76);
    const bullet = noColor ? g.bullet : this.activeTheme.tokens.status.info(g.bullet);
    const conn = noColor ? g.connector : this.activeTheme.tokens.text.muted(g.connector);

    const titleText = this.formatToolTitle(props.tool, props.args, width);
    const headerLine = `${bullet} ${titleText}`;

    const lines: string[] = [headerLine];
    const indentPrefix = `  ${conn}  `;
    const bodyIndent = '     ';

    switch (props.state) {
      case 'needs_approval': {
        const marker = noColor ? g.waiting : this.activeTheme.tokens.status.waiting(g.waiting);
        lines.push(`${indentPrefix}${marker} Waiting for approval`);
        break;
      }

      case 'running': {
        const spinner = props.spinnerFrame || g.spinnerFrames[0];
        const spColored = noColor ? spinner : this.activeTheme.tokens.status.info(spinner);
        const elapsed = props.elapsedSeconds !== undefined ? `(${props.elapsedSeconds}s · ctrl+o to expand)` : '(ctrl+o to expand)';
        const elapsedColored = noColor ? elapsed : this.activeTheme.tokens.text.muted(elapsed);
        lines.push(`${indentPrefix}${spColored} Running…  ${elapsedColored}`);

        if (props.outputLines && props.outputLines.length > 0) {
          const recent = props.outputLines.slice(-3);
          for (const ol of recent) {
            const coloredOl = noColor ? ol : this.activeTheme.tokens.text.muted(ol);
            lines.push(`${bodyIndent}${truncateVisible(coloredOl, width - 6)}`);
          }
        }
        break;
      }

      case 'success': {
        const check = noColor ? g.success : this.activeTheme.tokens.status.success(g.success);
        const summary = props.summary || (props.exitCode === 0 ? 'Done (exit 0)' : 'Success');
        const hint = noColor ? '(ctrl+o to expand)' : this.activeTheme.tokens.text.muted('(ctrl+o to expand)');
        lines.push(`${indentPrefix}${check} ${summary}  ${hint}`);
        break;
      }

      case 'expanded': {
        const check = noColor ? g.success : this.activeTheme.tokens.status.success(g.success);
        const summary = props.summary || (props.exitCode === 0 ? 'Done (exit 0)' : 'Success');
        lines.push(`${indentPrefix}${check} ${summary}`);

        const out = props.outputLines || [];
        if (out.length <= 8) {
          for (const l of out) {
            lines.push(`${bodyIndent}${truncateVisible(l, width - 6)}`);
          }
        } else {
          // Head 3 lines
          for (let i = 0; i < 3; i++) {
            lines.push(`${bodyIndent}${truncateVisible(out[i], width - 6)}`);
          }
          const hiddenCount = out.length - 6;
          const hiddenText = `… +${hiddenCount} lines hidden (ctrl+o to show all)`;
          lines.push(`${bodyIndent}${noColor ? hiddenText : this.activeTheme.tokens.text.muted(hiddenText)}`);
          // Tail 3 lines
          for (let i = out.length - 3; i < out.length; i++) {
            lines.push(`${bodyIndent}${truncateVisible(out[i], width - 6)}`);
          }
        }
        break;
      }

      case 'error': {
        const cross = noColor ? g.error : this.activeTheme.tokens.status.error(g.error);
        const codeText = props.exitCode !== undefined ? ` (exit ${props.exitCode})` : '';
        const msg = props.summary || `Failed${codeText}`;
        const coloredMsg = noColor ? msg : this.activeTheme.tokens.status.error(msg);
        lines.push(`${indentPrefix}${cross} ${coloredMsg}`);

        if (props.outputLines && props.outputLines.length > 0) {
          const recent = props.outputLines.slice(-3);
          for (const ol of recent) {
            const coloredOl = noColor ? ol : this.activeTheme.tokens.status.error(ol);
            lines.push(`${bodyIndent}${truncateVisible(coloredOl, width - 6)}`);
          }
        }
        break;
      }

      case 'denied': {
        const cross = noColor ? g.error : this.activeTheme.tokens.status.error(g.error);
        const deniedText = noColor ? 'Denied by user' : this.activeTheme.tokens.status.error('Denied by user');
        lines.push(`${indentPrefix}${cross} ${deniedText}`);
        if (props.userNote) {
          const noteText = noColor ? props.userNote : this.activeTheme.tokens.text.muted(props.userNote);
          lines.push(`${bodyIndent}${truncateVisible(noteText, width - 6)}`);
        }
        break;
      }

      case 'interrupted': {
        const cross = noColor ? g.error : this.activeTheme.tokens.status.error(g.error);
        const intText = noColor ? 'Interrupted' : this.activeTheme.tokens.status.error('Interrupted');
        lines.push(`${indentPrefix}${cross} ${intText}`);
        break;
      }

      case 'mcp_progress': {
        const spinner = props.spinnerFrame || g.spinnerFrames[0];
        const spColored = noColor ? spinner : this.activeTheme.tokens.status.info(spinner);
        const p = props.mcpProgress || { current: 0, total: 10, percent: 0 };
        const bar = this.renderProgressBar(p.percent);
        const elapsed = props.elapsedSeconds !== undefined ? `  (${props.elapsedSeconds}s)` : '';
        const stepText = p.total > 0 ? `  ${p.current} of ${p.total}` : '';
        const progressLine = `${bar} ${p.percent}%${stepText}${elapsed}`;
        lines.push(`${indentPrefix}${spColored} ${progressLine}`);
        break;
      }
    }

    return lines;
  }
}
