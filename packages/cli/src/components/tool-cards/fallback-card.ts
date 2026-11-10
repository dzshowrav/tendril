import { resolveActiveTheme } from '../../theme/loader.js';
import { ToolCardProps, ToolCardRenderer } from './types.js';

export class FallbackCard implements ToolCardRenderer {
  public renderStart(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    return `\n${theme.colors.borderFocus(`🔧 ${props.tool}`)} ${theme.colors.textMuted(JSON.stringify(props.input))}\n`;
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
      return `  ${icon} ${colors.textError(props.summary || 'Operation failed')}${colors.textMuted(timeStr)}\n`;
    }

    const icon = colors.statusSuccess(symbols.success);
    return `  ${icon} ${colors.textMuted(`${props.summary || 'Done'}${timeStr}`)}\n`;
  }
}
