import { resolveActiveTheme } from '../../theme/loader.js';
import { ToolCardProps, ToolCardRenderer } from './types.js';

export class SubAgentCard implements ToolCardRenderer {
  public renderStart(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    const prompt = String(props.input.prompt || props.input.task || '');
    const oneLinePreview = prompt.replace(/\s+/g, ' ').slice(0, 60);

    return `\n${theme.colors.diagramFocal(`🤖 sub-agent:${props.tool}`)} ${theme.colors.textPrimary(`"${oneLinePreview}${prompt.length > 60 ? '...' : ''}"`)}\n`;
  }

  public renderRunning(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    if (props.isExpanded) {
      const fullPrompt = String(props.input.prompt || props.input.task || '');
      return `  ${theme.colors.borderDefault('│')} ${theme.colors.textMuted(fullPrompt)}\n`;
    }
    return '';
  }

  public renderEnd(props: ToolCardProps): string {
    const theme = props.theme || resolveActiveTheme();
    const { colors, symbols } = theme;
    const timeStr = props.elapsedMs ? ` (${props.elapsedMs}ms)` : '';

    if (props.lifecycle === 'error') {
      const icon = colors.statusError(symbols.error);
      return `  ${icon} ${colors.textError(props.summary || 'Sub-agent failed')}${colors.textMuted(timeStr)}\n`;
    }

    const icon = colors.statusSuccess(symbols.success);
    return `  ${icon} ${colors.textMuted(`${props.summary || 'Sub-agent completed task'}${timeStr}`)}\n`;
  }
}
