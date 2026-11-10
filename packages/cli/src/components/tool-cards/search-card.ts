import { resolveActiveTheme } from '../../theme/loader.js';
import { ToolCardProps, ToolCardRenderer } from './types.js';

export class SearchCard implements ToolCardRenderer {
  public renderStart(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    const target = String(props.input.pattern || props.input.path || '.');
    return `\n${theme.colors.diagramFunction(`🔍 ${props.tool}`)} ${theme.colors.textPrimary(target)}\n`;
  }

  public renderRunning(_props: ToolCardProps): string {
    return '';
  }

  public renderEnd(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    const { colors, symbols } = theme;
    const timeStr = props.elapsedMs ? ` (${props.elapsedMs}ms)` : '';

    if (props.lifecycle === 'error') {
      const icon = colors.statusError(symbols.error);
      return `  ${icon} ${colors.textError(props.summary || 'Search failed')}${colors.textMuted(timeStr)}\n`;
    }

    const icon = colors.statusSuccess(symbols.success);
    return `  ${icon} ${colors.textMuted(`${props.summary || 'Matches found'}${timeStr}`)}\n`;
  }
}
