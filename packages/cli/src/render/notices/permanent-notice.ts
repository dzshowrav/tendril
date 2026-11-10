/**
 * Permanent Notice & Fallback Message Pipeline.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md § 18).
 *
 * Implements:
 * - Info notice: i <message> (text.muted)
 * - Warning notice: ! <title> (status.waiting, bold first line)
 * - Error notice: x <title> (status.error, bold first line)
 * - Interrupted notice: ✗ Interrupted by user
 */

import { getGlyphs, GlyphSet } from '../../ui/glyphs.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { isNoColor } from '../../ui/theme.js';
import { truncateVisible } from '../../ui/layout-calc.js';

export class PermanentNoticePipeline {
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
   * Info notice: i <message>
   */
  public renderInfo(message: string, details?: string[]): string[] {
    const noColor = isNoColor();
    const g = this.glyphs;
    const marker = noColor ? g.noticeInfo : this.activeTheme.tokens.text.muted(g.noticeInfo);
    const text = noColor ? message : this.activeTheme.tokens.text.muted(message);

    const lines: string[] = [`  ${marker} ${text}`];
    if (details) {
      for (const d of details) {
        lines.push(`    ${noColor ? d : this.activeTheme.tokens.text.muted(d)}`);
      }
    }
    return lines;
  }

  /**
   * Warning notice: ! <title> (bold first line)
   */
  public renderWarning(title: string, details?: string[]): string[] {
    const noColor = isNoColor();
    const g = this.glyphs;
    const marker = noColor ? g.noticeWarn : this.activeTheme.tokens.status.waiting(g.noticeWarn);
    const head = noColor ? title : this.activeTheme.tokens.status.waiting(title);

    const lines: string[] = [`  ${marker} ${head}`];
    if (details) {
      for (const d of details) {
        lines.push(`    ${noColor ? d : this.activeTheme.tokens.text.muted(d)}`);
      }
    }
    return lines;
  }

  /**
   * Error notice: x <title> (bold first line)
   */
  public renderError(title: string, details?: string[]): string[] {
    const noColor = isNoColor();
    const g = this.glyphs;
    const marker = noColor ? g.noticeError : this.activeTheme.tokens.status.error(g.noticeError);
    const head = noColor ? title : this.activeTheme.tokens.status.error(title);

    const lines: string[] = [`  ${marker} ${head}`];
    if (details) {
      for (const d of details) {
        lines.push(`    ${noColor ? d : this.activeTheme.tokens.text.muted(d)}`);
      }
    }
    return lines;
  }

  /**
   * Interrupted turn: ✗ Interrupted by user
   */
  public renderInterrupted(): string[] {
    const noColor = isNoColor();
    const g = this.glyphs;
    const cross = noColor ? g.error : this.activeTheme.tokens.status.error(g.error);
    const msg = noColor ? 'Interrupted by user' : this.activeTheme.tokens.status.error('Interrupted by user');
    return [`  ${cross} ${msg}`];
  }
}
