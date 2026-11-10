import { resolveActiveTheme } from '../../theme/loader.js';
import { ToolCardProps, ToolCardRenderer } from './types.js';

export class FileCard implements ToolCardRenderer {
  public renderStart(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    const filePath = String(props.input.path || props.input.filePath || '');
    const actionLabel =
      props.tool === 'write_file' ? 'write' : props.tool === 'edit_file' ? 'edit' : 'read';

    return `\n${theme.colors.promptAccent(`⚡ ${props.tool}`)} ${theme.colors.bold(filePath)} ${theme.colors.textMuted(`[${actionLabel}]`)}\n`;
  }

  public renderRunning(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    if (props.lifecycle === 'awaiting_approval') {
      return `  ${theme.colors.statusWaiting('⏳')} ${theme.colors.textWarning('Waiting for permission...')}\n`;
    }
    return '';
  }

  public renderEnd(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    const { colors, symbols } = theme;
    const timeStr = props.elapsedMs ? ` (${props.elapsedMs}ms)` : '';

    if (props.lifecycle === 'error' || props.lifecycle === 'denied') {
      const icon = colors.statusError(symbols.error);
      const summary = props.summary || (props.lifecycle === 'denied' ? 'File action denied' : 'File operation failed');
      return `  ${icon} ${colors.textError(summary)}${colors.textMuted(timeStr)}\n`;
    }

    const icon = colors.statusSuccess(symbols.success);
    const summary = props.summary || 'File updated';
    return `  ${icon} ${colors.textMuted(`${summary}${timeStr}`)}\n`;
  }
}
