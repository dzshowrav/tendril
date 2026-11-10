import { resolveActiveTheme } from '../../theme/loader.js';
import { formatHeadTailOutput } from './collapsible.js';
import { ToolCardProps, ToolCardRenderer } from './types.js';

export class BashCard implements ToolCardRenderer {
  public renderStart(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    const cmd = String(props.input.command || '');
    return `\n${theme.colors.statusRunning('⚙ bash')} ${theme.colors.textPrimary(cmd)}\n`;
  }

  public renderRunning(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    const lines = props.outputLines || [];
    if (lines.length === 0) return '';
    return formatHeadTailOutput(lines, { isExpanded: props.isExpanded, theme }).join('\n') + '\n';
  }

  public renderEnd(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    const { colors, symbols } = theme;
    const timeStr = props.elapsedMs ? ` (${props.elapsedMs}ms)` : '';

    if (props.lifecycle === 'error' || props.lifecycle === 'denied') {
      const icon = colors.statusError(symbols.error);
      const summary = props.summary || (props.lifecycle === 'denied' ? 'Execution denied' : 'Command failed');
      return `  ${icon} ${colors.textError(summary)}${colors.textMuted(timeStr)}\n`;
    }

    const icon = colors.statusSuccess(symbols.success);
    const summary = props.summary || 'Command finished';
    return `  ${icon} ${colors.textMuted(`${summary}${timeStr}`)}\n`;
  }
}
