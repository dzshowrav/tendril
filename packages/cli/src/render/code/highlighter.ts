import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';

const KEYWORDS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'break', 'continue', 'default', 'import', 'export', 'from',
  'class', 'extends', 'super', 'new', 'this', 'async', 'await', 'try', 'catch',
  'finally', 'throw', 'typeof', 'instanceof', 'void', 'null', 'undefined', 'true',
  'false', 'def', 'elif', 'in', 'is', 'not', 'and', 'or', 'lambda', 'with', 'as',
  'echo', 'exit', 'then', 'fi', 'done', 'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE',
  'DELETE', 'CREATE', 'TABLE', 'JOIN', 'ON', 'GROUP', 'BY', 'ORDER',
]);

/**
 * Lightweight, zero-native syntax highlighter using theme tokens.
 */
export function highlightCode(
  code: string,
  _lang = '',
  theme: ActiveTheme = resolveActiveTheme(),
): string {
  const { colors } = theme;

  // Split lines to highlight line by line
  return code
    .split('\n')
    .map((line) => {
      // Comments
      if (line.trim().startsWith('//') || line.trim().startsWith('#')) {
        return colors.codeComment(line);
      }

      // Tokenize strings, numbers, and words
      return line.replace(
        /(["'`])(?:(?=(\\?))\2.)*?\1|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][A-Za-z0-9_$]*\b|[{}()[\].,;:+\-*/%=<>!&|^~]/g,
        (token) => {
          if (token.startsWith('"') || token.startsWith("'") || token.startsWith('`')) {
            return colors.codeString(token);
          }
          if (/^\d/.test(token)) {
            return colors.codeNumber(token);
          }
          if (KEYWORDS.has(token)) {
            return colors.codeKeyword(token);
          }
          if (/^[{}()[\].,;:+\-*/%=<>!&|^~]$/.test(token)) {
            return colors.codePunctuation(token);
          }
          return token;
        },
      );
    })
    .join('\n');
}
