import { detectTerminalCapabilities, TerminalCapabilities } from '../../capabilities/detector.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';
import { highlightCode } from '../code/highlighter.js';

/**
 * Terminal-aware Markdown Parser & Renderer.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 4.2).
 */
export class TerminalMarkdownRenderer {
  private theme: ActiveTheme;
  private caps: TerminalCapabilities;

  constructor(theme?: ActiveTheme, caps?: TerminalCapabilities) {
    this.theme = theme || resolveActiveTheme();
    this.caps = caps || detectTerminalCapabilities();
  }

  public render(markdown: string): string {
    const lines = markdown.split('\n');
    const output: string[] = [];
    let inCodeBlock = false;
    let codeLang = '';
    let codeBuffer: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Code block start / end
      if (line.trim().startsWith('```')) {
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeLang = line.trim().slice(3).trim();
          codeBuffer = [];
        } else {
          inCodeBlock = false;
          output.push(this.formatCodeBlock(codeBuffer.join('\n'), codeLang));
          codeBuffer = [];
        }
        continue;
      }

      if (inCodeBlock) {
        codeBuffer.push(line);
        continue;
      }

      // Blockquote
      if (line.trim().startsWith('>')) {
        const text = line.replace(/^\s*>\s?/, '');
        output.push(`  ${this.theme.colors.borderDefault('│')} ${this.formatInline(text)}`);
        continue;
      }

      // Unordered list
      if (/^\s*[-*+]\s/.test(line)) {
        const indentMatch = line.match(/^(\s*)/);
        const indent = indentMatch ? indentMatch[1] : '';
        const text = line.replace(/^\s*[-*+]\s/, '');
        output.push(`${indent}  • ${this.formatInline(text)}`);
        continue;
      }

      // Ordered list
      if (/^\s*\d+\.\s/.test(line)) {
        const match = line.match(/^(\s*)(\d+\.)\s(.*)/);
        if (match) {
          const [, indent, num, text] = match;
          output.push(`${indent}  ${this.theme.colors.textMuted(num)} ${this.formatInline(text)}`);
          continue;
        }
      }

      // Headings
      if (/^#{1,6}\s/.test(line)) {
        const text = line.replace(/^#{1,6}\s/, '');
        output.push(`\n${this.theme.colors.bold(this.theme.colors.promptAccent(text))}`);
        continue;
      }

      // Tables
      if (line.includes('|') && lines[i + 1]?.includes('|') && /[-:]{3,}/.test(lines[i + 1])) {
        const tableLines: string[] = [line, lines[i + 1]];
        let j = i + 2;
        while (j < lines.length && lines[j].includes('|')) {
          tableLines.push(lines[j]);
          j++;
        }
        output.push(this.formatTable(tableLines));
        i = j - 1;
        continue;
      }

      // Normal text with inline formatting
      output.push(this.formatInline(line));
    }

    // Unclosed code block recovery
    if (inCodeBlock && codeBuffer.length > 0) {
      output.push(this.formatCodeBlock(codeBuffer.join('\n'), codeLang));
    }

    return output.join('\n');
  }

  public formatInline(text: string): string {
    const { colors } = this.theme;

    // Links: [label](url)
    let res = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, label, url) => {
      if (this.caps.hyperlinks) {
        // OSC 8 hyperlink escape sequence: \x1b]8;;URL\x1b\TEXT\x1b]8;;\x1b\
        return `\x1b]8;;${url}\x1b\\${colors.textAccent(label)}\x1b]8;;\x1b\\`;
      }
      return `${colors.textAccent(label)} (${colors.textMuted(url)})`;
    });

    // Inline code: `code`
    res = res.replace(/`([^`]+)`/g, (_match, code) => colors.codeString(code));

    // Bold: **text** or __text__
    res = res.replace(/(\*\*|__)(.*?)\1/g, (_match, _del, bold) => colors.bold(bold));

    // Italic: *text* or _text_
    res = res.replace(/(\*|_)(.*?)\1/g, (_match, _del, it) => colors.italic(it));

    return res;
  }

  public formatCodeBlock(code: string, lang: string): string {
    const { colors, symbols } = this.theme;
    const highlighted = highlightCode(code, lang, this.theme);
    const langLabel = lang ? ` ${lang} ` : '';
    const topBar = symbols.boxHorizontal.repeat(Math.max(2, 40 - langLabel.length));

    const lines = highlighted.split('\n');
    const body = lines.map((l) => `  ${l}`).join('\n');

    return [
      colors.borderDefault(`  ${symbols.boxTopLeft}${langLabel}${topBar}${symbols.boxTopRight}`),
      body,
      colors.borderDefault(`  ${symbols.boxBottomLeft}${symbols.boxHorizontal.repeat(42)}${symbols.boxBottomRight}`),
    ].join('\n');
  }

  public formatTable(tableLines: string[]): string {
    const rows = tableLines
      .filter((l) => !/^\s*\|?\s*[-:]+[-| :]*\s*\|?\s*$/.test(l))
      .map((l) =>
        l
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim()),
      );

    if (rows.length === 0) return '';

    const colWidths: number[] = [];
    for (const r of rows) {
      r.forEach((cell, idx) => {
        colWidths[idx] = Math.max(colWidths[idx] || 4, cell.length);
      });
    }

    const { colors } = this.theme;
    return rows
      .map((row, idx) => {
        const line = row
          .map((cell, cIdx) => cell.padEnd(colWidths[cIdx] || 8))
          .join('  │  ');
        if (idx === 0) {
          return `  ${colors.bold(line)}\n  ${colors.borderDefault('─'.repeat(line.length))}`;
        }
        return `  ${line}`;
      })
      .join('\n');
  }
}
