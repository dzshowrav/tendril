import { resolveActiveTheme } from '../../theme/loader.js';
import { ToolCardProps, ToolCardRenderer } from './types.js';

export class McpCard implements ToolCardRenderer {
  public renderStart(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    // Section 6.3: summary shows all parameters sent to the tool inline without needing expand
    const paramEntries = Object.entries(props.input || {})
      .map(([k, v]) => `${theme.colors.bold(k)}=${theme.colors.textMuted(JSON.stringify(v))}`)
      .join('  ');

    return `\n${theme.colors.diagramClass(`🔌 mcp:${props.tool}`)} ${paramEntries || theme.colors.textMuted('(no params)')}\n`;
  }

  public renderRunning(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    if (props.progressPercent !== undefined) {
      const pct = Math.max(0, Math.min(100, props.progressPercent));
      const filled = Math.round(pct / 5);
      const bar = '█'.repeat(filled) + '░'.repeat(20 - filled);
      return `  ${theme.colors.statusRunning(`[${bar}] ${pct}%`)}\n`;
    }
    return '';
  }

  public renderEnd(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    const { colors, symbols } = theme;
    const timeStr = props.elapsedMs ? ` (${props.elapsedMs}ms)` : '';

    if (props.lifecycle === 'error') {
      const icon = colors.statusError(symbols.error);
      return `  ${icon} ${colors.textError(props.summary || 'MCP execution failed')}${colors.textMuted(timeStr)}\n`;
    }

    const icon = colors.statusSuccess(symbols.success);
    return `  ${icon} ${colors.textMuted(`${props.summary || 'MCP call finished'}${timeStr}`)}\n`;
  }
}
