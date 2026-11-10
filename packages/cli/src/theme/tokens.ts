/**
 * Semantic Theme Token Definitions.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 13.3).
 */

export interface ColorFormatters {
  // Text
  textPrimary: (str: string) => string;
  textMuted: (str: string) => string;
  textError: (str: string) => string;
  textSuccess: (str: string) => string;
  textWarning: (str: string) => string;
  textAccent: (str: string) => string;

  // Surface & Borders
  surfaceDefault: (str: string) => string;
  surfaceRaised: (str: string) => string;
  borderDefault: (str: string) => string;
  borderFocus: (str: string) => string;

  // Prompt & Response
  promptAccent: (str: string) => string;
  responseAccent: (str: string) => string;

  // Status
  statusSuccess: (str: string) => string;
  statusError: (str: string) => string;
  statusWaiting: (str: string) => string;
  statusRunning: (str: string) => string;

  // Diagram classes
  diagramFunction: (str: string) => string;
  diagramClass: (str: string) => string;
  diagramFile: (str: string) => string;
  diagramDirectory: (str: string) => string;
  diagramExternal: (str: string) => string;
  diagramFocal: (str: string) => string;

  // Code syntax highlighting
  codeKeyword: (str: string) => string;
  codeString: (str: string) => string;
  codeNumber: (str: string) => string;
  codeComment: (str: string) => string;
  codePunctuation: (str: string) => string;

  // Styles
  bold: (str: string) => string;
  italic: (str: string) => string;
  dim: (str: string) => string;
}

export interface ThemeSymbols {
  success: string;
  error: string;
  waiting: string;
  running: string;
  prompt: string;
  shield: string;
  boxTopLeft: string;
  boxTopRight: string;
  boxBottomLeft: string;
  boxBottomRight: string;
  boxHorizontal: string;
  boxVertical: string;
  boxDividerLeft: string;
  boxDividerRight: string;
}
