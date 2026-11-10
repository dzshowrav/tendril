import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { calculateShellTrustScopes, ShellTrustScope, TrustScopeRule } from './trust-scope.js';

export interface PendingApprovalItem {
  id: string;
  tool: string;
  target: string;
  canAllowAlways?: boolean;
  disallowReason?: string;
  command?: string;
}

/**
 * Approval Bar with queue and drill-in feedback.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 7.1).
 */
export class ApprovalBar {
  private queue: PendingApprovalItem[] = [];
  private theme: ActiveTheme;

  constructor(theme?: ActiveTheme) {
    this.theme = theme || resolveActiveTheme();
  }

  public enqueue(item: PendingApprovalItem): void {
    this.queue.push(item);
  }

  public current(): PendingApprovalItem | undefined {
    return this.queue[0];
  }

  public dequeue(): PendingApprovalItem | undefined {
    return this.queue.shift();
  }

  public remainingCount(): number {
    return this.queue.length;
  }

  public render(item: PendingApprovalItem, selectedScope: ShellTrustScope = 'exact'): string {
    const { colors, symbols } = this.theme;
    const scopes: TrustScopeRule[] =
      item.tool === 'bash' && item.command ? calculateShellTrustScopes(item.command) : [];

    const queueNote =
      this.queue.length > 1
        ? ` ${colors.textWarning(`[1 of ${this.queue.length} approvals]`)}`
        : '';

    const width = 64;
    const title = ` ${symbols.shield} Permission Required${queueNote} `;
    const topBar = symbols.boxHorizontal.repeat(Math.max(2, width - title.length));
    const divBar = symbols.boxHorizontal.repeat(width);
    const botBar = symbols.boxHorizontal.repeat(width);

    const out: string[] = [
      colors.textWarning(`${symbols.boxTopLeft}─${title}${topBar}${symbols.boxTopRight}`),
      `${colors.textWarning(symbols.boxVertical)}  Tool:   ${colors.promptAccent(item.tool)}`,
      `${colors.textWarning(symbols.boxVertical)}  Target: ${colors.bold(item.target)}`,
    ];

    if (item.disallowReason) {
      out.push(
        `${colors.textWarning(symbols.boxVertical)}  Reason: ${colors.textMuted(item.disallowReason)}`,
      );
    }

    // Display trust scopes if shell command
    if (scopes.length > 0 && item.canAllowAlways !== false) {
      out.push(colors.textWarning(`${symbols.boxDividerLeft}${divBar}${symbols.boxDividerRight}`));
      out.push(`${colors.textWarning(symbols.boxVertical)}  Trust Scope (Permanent Rule):`);
      for (const s of scopes) {
        const marker = s.scope === selectedScope ? colors.statusSuccess('●') : colors.textMuted('○');
        out.push(
          `${colors.textWarning(symbols.boxVertical)}    ${marker} ${colors.bold(s.scope)}: ${colors.textMuted(s.description)}`,
        );
      }
    }

    out.push(colors.textWarning(`${symbols.boxDividerLeft}${divBar}${symbols.boxDividerRight}`));

    const canAlways = item.canAllowAlways !== false;
    const actions = canAlways
      ? `  ${colors.statusSuccess('[y]')} Once  ${colors.promptAccent('[a]')} Trust  ${colors.statusError('[n]')} Deny  ${colors.textWarning('[d]')} Diff`
      : `  ${colors.statusSuccess('[y]')} Once  ${colors.statusError('[n]')} Deny  ${colors.textWarning('[d]')} Diff  ${colors.textMuted('(Trust disabled for compound cmd)')}`;

    out.push(`${colors.textWarning(symbols.boxVertical)}${actions}`);
    out.push(colors.textWarning(`${symbols.boxBottomLeft}${botBar}${symbols.boxBottomRight}`));
    out.push(colors.textWarning(`Decision ${symbols.prompt} `));

    return out.join('\n');
  }
}
