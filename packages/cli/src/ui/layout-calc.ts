/**
 * Layout & Width Calculation Helpers.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md).
 *
 * Implements ANSI-safe width calculation, wcwidth-aware Unicode sizing,
 * visible truncation with ANSI preservation, word wrapping, and hanging indents.
 */

// Regular expression to match ANSI escape codes (CSI, OSC, and 2-byte sequences)
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

/**
 * Remove all ANSI escape sequences from a string.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

/**
 * Returns the column width of a single Unicode code point.
 * Follows POSIX wcwidth conventions for CJK and wide symbols.
 */
export function charWidth(codePoint: number): number {
  // Non-printing and control characters
  if (codePoint === 0 || codePoint < 32 || (codePoint >= 0x7f && codePoint < 0xa0)) {
    return 0;
  }

  // Zero-width characters & combining marks
  if (
    (codePoint >= 0x0300 && codePoint <= 0x036f) || // Combining Diacritical Marks
    (codePoint >= 0x1dc0 && codePoint <= 0x1dff) || // Combining Diacritical Marks Supplement
    (codePoint >= 0x200b && codePoint <= 0x200f) || // Zero-width spaces & direction marks
    (codePoint >= 0x202a && codePoint <= 0x202e) || // BiDi marks
    (codePoint >= 0x2060 && codePoint <= 0x206f) || // Invisible formatting
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) || // Variation Selectors
    (codePoint >= 0xe0100 && codePoint <= 0xe01ef)  // Variation Selectors Supplement
  ) {
    return 0;
  }

  // Fullwidth and Wide characters (East Asian Wide / CJK / Emojis)
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    codePoint === 0x2329 || codePoint === 0x232a ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) || // CJK Radicals / Kangxi / Symbols
    (codePoint >= 0x3040 && codePoint <= 0xa4cf) || // Hiragana / Katakana / Bopomofo / CJK Unified
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul Syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK Compatibility Ideographs
    (codePoint >= 0xfe10 && codePoint <= 0xfe19) || // Vertical forms
    (codePoint >= 0xfe30 && codePoint <= 0xfe6f) || // CJK Compatibility Forms
    (codePoint >= 0xff01 && codePoint <= 0xff60) || // Fullwidth Forms
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1f64f) || // Miscellaneous Symbols and Pictographs
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) || // Supplemental Symbols
    (codePoint >= 0x20000 && codePoint <= 0x2fffd) || // CJK Extension B
    (codePoint >= 0x30000 && codePoint <= 0x3fffd)    // CJK Extension C
  ) {
    return 2;
  }

  return 1;
}

/**
 * Calculates the visible column width of a string, ignoring ANSI codes
 * and properly accounting for fullwidth / wide characters.
 */
export function visibleWidth(str: string): number {
  if (!str) return 0;
  const clean = stripAnsi(str);
  let width = 0;
  for (const char of clean) {
    const cp = char.codePointAt(0);
    if (cp !== undefined) {
      width += charWidth(cp);
    }
  }
  return width;
}

/**
 * Truncates a string to a maximum visible column width,
 * taking ANSI escapes into account and appending an ellipsis.
 */
export function truncateVisible(str: string, maxWidth: number, ellipsis = '…'): string {
  if (maxWidth <= 0) return '';
  const currentWidth = visibleWidth(str);
  if (currentWidth <= maxWidth) {
    return str;
  }

  const ellipsisWidth = visibleWidth(ellipsis);
  const targetWidth = Math.max(0, maxWidth - ellipsisWidth);

  let accumulatedWidth = 0;
  let result = '';
  let inEscape = false;
  let hasOpenedAnsi = false;

  for (let i = 0; i < str.length; i++) {
    // Check for ANSI escape start
    if (str.charCodeAt(i) === 27) { // '\x1B'
      inEscape = true;
      hasOpenedAnsi = true;
      result += str[i];
      continue;
    }

    if (inEscape) {
      result += str[i];
      // Escape ends at character within [@-~]
      if (/[a-zA-Z~]/.test(str[i])) {
        inEscape = false;
      }
      continue;
    }

    const cp = str.codePointAt(i);
    const char = String.fromCodePoint(cp!);
    const w = charWidth(cp!);

    if (accumulatedWidth + w > targetWidth) {
      break;
    }

    accumulatedWidth += w;
    result += char;

    // Advance index if surrogate pair
    if (char.length > 1) {
      i += char.length - 1;
    }
  }

  // If ANSI styling was applied, append reset before ellipsis
  if (hasOpenedAnsi) {
    result += '\x1B[0m';
  }

  return result + ellipsis;
}

/**
 * Pads a line to exact target column width with whitespace.
 */
export function padLine(text: string, targetWidth: number, align: 'left' | 'right' | 'center' = 'left'): string {
  const currentW = visibleWidth(text);
  const deficit = Math.max(0, targetWidth - currentW);
  if (deficit === 0) return text;

  if (align === 'right') {
    return ' '.repeat(deficit) + text;
  }
  if (align === 'center') {
    const leftPad = Math.floor(deficit / 2);
    const rightPad = deficit - leftPad;
    return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
  }
  return text + ' '.repeat(deficit);
}

/**
 * Wraps text to fit within a given column width, preserving existing newlines.
 * Does not break words unless a single word exceeds maxWidth.
 */
export function wrapLines(str: string, maxWidth: number): string[] {
  if (maxWidth <= 0) return [str];
  const inputLines = str.split('\n');
  const outputLines: string[] = [];

  for (const rawLine of inputLines) {
    if (visibleWidth(rawLine) <= maxWidth) {
      outputLines.push(rawLine);
      continue;
    }

    // Word-based wrap
    const words = rawLine.split(' ');
    let currentLine = '';

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      const testLine = currentLine.length === 0 ? word : currentLine + ' ' + word;

      if (visibleWidth(testLine) <= maxWidth) {
        currentLine = testLine;
      } else {
        if (currentLine.length > 0) {
          outputLines.push(currentLine);
          currentLine = '';
        }

        // If the single word exceeds maxWidth, break it into chunks
        if (visibleWidth(word) > maxWidth) {
          let chunk = '';
          for (const char of word) {
            if (visibleWidth(chunk + char) <= maxWidth) {
              chunk += char;
            } else {
              outputLines.push(chunk);
              chunk = char;
            }
          }
          currentLine = chunk;
        } else {
          currentLine = word;
        }
      }
    }

    if (currentLine.length > 0) {
      outputLines.push(currentLine);
    }
  }

  return outputLines;
}

/**
 * Formats a message with hanging indentation:
 * First line starts with `firstLinePrefix`.
 * Continuation lines start with `indentWidth` spaces.
 * All lines wrapped to `maxWidth` (default 76).
 */
export function formatHangingIndent(
  firstLinePrefix: string,
  text: string,
  indentWidth = 2,
  maxWidth = 76
): string[] {
  const prefixW = visibleWidth(firstLinePrefix);
  const firstLineAvail = Math.max(10, maxWidth - prefixW);
  const contIndent = ' '.repeat(indentWidth);
  const contAvail = Math.max(10, maxWidth - indentWidth);

  // Wrap the text
  const words = text.split(/\s+/);
  if (words.length === 0 || (words.length === 1 && words[0] === '')) {
    return [firstLinePrefix];
  }

  const lines: string[] = [];
  let currentLine = '';
  let isFirstLine = true;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const avail = isFirstLine ? firstLineAvail : contAvail;
    const testLine = currentLine.length === 0 ? word : currentLine + ' ' + word;

    if (visibleWidth(testLine) <= avail) {
      currentLine = testLine;
    } else {
      if (currentLine.length > 0) {
        lines.push(isFirstLine ? firstLinePrefix + currentLine : contIndent + currentLine);
        isFirstLine = false;
        currentLine = '';
      }

      // If word is bigger than available line width
      if (visibleWidth(word) > contAvail) {
        let chunk = '';
        for (const char of word) {
          const cap = isFirstLine ? firstLineAvail : contAvail;
          if (visibleWidth(chunk + char) <= cap) {
            chunk += char;
          } else {
            lines.push(isFirstLine ? firstLinePrefix + chunk : contIndent + chunk);
            isFirstLine = false;
            chunk = char;
          }
        }
        currentLine = chunk;
      } else {
        currentLine = word;
      }
    }
  }

  if (currentLine.length > 0) {
    lines.push(isFirstLine ? firstLinePrefix + currentLine : contIndent + currentLine);
  }

  return lines;
}
