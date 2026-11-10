import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';

export interface PasteChip {
  id: string;
  originalText: string;
  lineCount: number;
  charCount: number;
  isExpanded: boolean;
}

/**
 * Long paste detection and expandable Chip manager.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 9).
 */
export class PasteChipManager {
  private theme: ActiveTheme;

  constructor(theme?: ActiveTheme) {
    this.theme = theme || resolveActiveTheme();
  }

  /**
   * Checks if incoming text qualifies as a long paste (> 3 lines or > 200 characters)
   */
  public isLongPaste(text: string): boolean {
    if (!text) return false;
    const lines = text.split('\n');
    return lines.length > 3 || text.length > 200;
  }

  public createChip(text: string): PasteChip {
    const lines = text.split('\n');
    return {
      id: `chip_${Date.now()}`,
      originalText: text,
      lineCount: lines.length,
      charCount: text.length,
      isExpanded: false,
    };
  }

  public renderChip(chip: PasteChip): string {
    const { colors } = this.theme;
    if (chip.isExpanded) {
      return chip.originalText;
    }
    const label = `[Paste: ${chip.lineCount} lines, ${chip.charCount} chars · Tab to expand]`;
    return colors.borderFocus(colors.bold(label));
  }

  public toggleExpand(chip: PasteChip): string {
    chip.isExpanded = !chip.isExpanded;
    return this.renderChip(chip);
  }
}
