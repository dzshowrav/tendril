import { ActiveTheme } from '../../theme/loader.js';

export type ToolCardLifecycle =
  | 'pending'
  | 'awaiting_approval'
  | 'running'
  | 'success'
  | 'error'
  | 'denied';

export interface ToolCardProps {
  tool: string;
  lifecycle: ToolCardLifecycle;
  input: Record<string, unknown>;
  outputLines?: string[];
  summary?: string;
  elapsedMs?: number;
  isExpanded?: boolean;
  theme?: ActiveTheme;
  progressPercent?: number; // For long-running MCP ops
}

export interface ToolCardRenderer {
  renderStart(props: ToolCardProps): string;
  renderRunning(props: ToolCardProps): string;
  renderEnd(props: ToolCardProps): string;
}
