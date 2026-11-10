/**
 * Terminal Diagram Painter.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 5, § 21).
 *
 * Requirements:
 * - Renders flowcharts, sequences, and nodes with theme semantic tokens.
 * - Enforces fallback rules (§ 5.3):
 *   1. Streaming/incomplete -> "Drawing diagram..."
 *   2. Too wide -> source + reason
 *   3. Unsupported -> source + reason
 *   4. ASCII mode -> source + reason
 * - Separate from parser module.
 */

import { ENV_VARS } from '../config/constants.js';
import { ActiveTheme, stripAnsi } from '../theme/loader.js';
import { DiagramNode, ParsedDiagram } from './parser.js';

export interface PaintOptions {
  terminalWidth?: number;
  isStreaming?: boolean;
  forceAsciiMode?: boolean;
}

export function paintDiagram(
  parsed: ParsedDiagram,
  theme: ActiveTheme,
  options: PaintOptions = {},
): string {
  const { colors, symbols } = theme;
  const termWidth = options.terminalWidth || process.stdout.columns || 80;
  const isAsciiMode =
    options.forceAsciiMode || process.env[ENV_VARS.TENDRIL_ASCII_MODE] !== undefined;

  // Fallback 1: Streaming incomplete (§ 5.3)
  if (options.isStreaming) {
    return colors.textMuted('⏳ Drawing diagram...');
  }

  // Fallback 2: Unsupported syntax or parser error (§ 5.3)
  if (!parsed.isValid || parsed.type === 'unsupported') {
    return formatFallbackWithReason(
      parsed.rawSource,
      parsed.error || 'Unsupported diagram syntax',
      theme,
    );
  }

  // Fallback 3: Explicit ASCII mode opt-out (§ 5.3)
  if (isAsciiMode) {
    return formatFallbackWithReason(
      parsed.rawSource,
      'ASCII mode active (TENDRIL_ASCII_MODE)',
      theme,
    );
  }

  // Check if diagram is too wide (§ 5.3)
  const maxNodeLen = parsed.nodes.reduce(
    (max, n) => Math.max(max, stripAnsi(n.label).length),
    0,
  );
  if (maxNodeLen + 10 > termWidth) {
    return formatFallbackWithReason(
      parsed.rawSource,
      `Diagram content exceeds terminal width (${termWidth} columns)`,
      theme,
    );
  }

  // Render diagram based on type
  if (parsed.type === 'flowchart' || parsed.type === 'state') {
    return paintFlowchart(parsed, theme, termWidth);
  }

  if (parsed.type === 'sequence') {
    return paintSequence(parsed, theme, termWidth);
  }

  // Default clean render
  return formatFallbackWithReason(
    parsed.rawSource,
    'Rendered as structured source',
    theme,
  );
}

function formatFallbackWithReason(
  source: string,
  reason: string,
  theme: ActiveTheme,
): string {
  const { colors } = theme;
  const notice = colors.dim(`[Diagram notice: ${reason}]`);
  const fenced = `\`\`\`mermaid\n${source.trim()}\n\`\`\``;
  return `${notice}\n${fenced}`;
}

function getNodeColorFormatter(node: DiagramNode, theme: ActiveTheme): (s: string) => string {
  const { colors } = theme;
  switch (node.styleClass) {
    case 'function':
      return colors.diagramFunction;
    case 'class':
      return colors.diagramClass;
    case 'file':
      return colors.diagramFile;
    case 'directory':
      return colors.diagramDirectory;
    case 'external':
      return colors.diagramExternal;
    case 'focal':
      return colors.diagramFocal;
    default:
      return colors.borderDefault;
  }
}

function paintNodeBox(node: DiagramNode, theme: ActiveTheme): string[] {
  const { colors, symbols } = theme;
  const colorFn = getNodeColorFormatter(node, theme);

  // Split label by newlines and limit to 4 lines (§ 5.2)
  const rawLines = node.label.split('\n');
  const lines = rawLines.slice(0, 4);
  if (rawLines.length > 4) {
    lines[3] += '...';
  }

  const maxLen = Math.max(...lines.map((l) => stripAnsi(l).length), node.id.length);
  const w = maxLen + 4;

  const result: string[] = [];

  if (node.shape === 'diamond') {
    // Decision Diamond: ◇ label ◇
    const border = colorFn('◇' + '─'.repeat(w - 2) + '◇');
    result.push(border);
    for (const l of lines) {
      const pad = w - 2 - stripAnsi(l).length;
      const leftPad = Math.floor(pad / 2);
      const rightPad = pad - leftPad;
      result.push(colorFn('│') + ' '.repeat(leftPad) + colors.textAccent(l) + ' '.repeat(rightPad) + colorFn('│'));
    }
    result.push(border);
  } else if (node.shape === 'stadium' || node.shape === 'rounded') {
    // Stadium / Rounded: ╭─────╮
    result.push(colorFn('╭' + '─'.repeat(w - 2) + '╮'));
    for (const l of lines) {
      const pad = w - 2 - stripAnsi(l).length;
      const leftPad = Math.floor(pad / 2);
      const rightPad = pad - leftPad;
      result.push(colorFn('│') + ' '.repeat(leftPad) + colors.textPrimary(l) + ' '.repeat(rightPad) + colorFn('│'));
    }
    result.push(colorFn('╰' + '─'.repeat(w - 2) + '╯'));
  } else {
    // Standard Box: ┌─────┐
    result.push(colorFn(symbols.boxTopLeft + symbols.boxHorizontal.repeat(w - 2) + symbols.boxTopRight));
    for (const l of lines) {
      const pad = w - 2 - stripAnsi(l).length;
      const leftPad = Math.floor(pad / 2);
      const rightPad = pad - leftPad;
      result.push(colorFn(symbols.boxVertical) + ' '.repeat(leftPad) + colors.textPrimary(l) + ' '.repeat(rightPad) + colorFn(symbols.boxVertical));
    }
    result.push(colorFn(symbols.boxBottomLeft + symbols.boxHorizontal.repeat(w - 2) + symbols.boxBottomRight));
  }

  return result;
}

function paintFlowchart(
  parsed: ParsedDiagram,
  theme: ActiveTheme,
  termWidth: number,
): string {
  const output: string[] = [];
  const { colors } = theme;

  // Render Subgraphs first if present
  for (const sg of parsed.subgraphs) {
    output.push(colors.bold(colors.diagramDirectory(`[Subgraph: ${sg.title}]`)));
  }

  // Render Nodes and Connections
  for (let i = 0; i < parsed.nodes.length; i++) {
    const node = parsed.nodes[i];
    const box = paintNodeBox(node, theme);
    output.push(...box);

    // Find outgoing edges
    const outgoing = parsed.edges.filter((e) => e.from === node.id);
    for (const edge of outgoing) {
      const edgeLabel = edge.label ? ` (${edge.label})` : '';
      const arrowChar = edge.style === 'dotted' ? ' ┊\n ▿' : edge.style === 'thick' ? ' ┃\n ▼' : ' │\n ↓';
      output.push(colors.textMuted(`${arrowChar}${edgeLabel}`));
    }

    if (i < parsed.nodes.length - 1 && outgoing.length === 0) {
      output.push('');
    }
  }

  return output.join('\n');
}

function paintSequence(
  parsed: ParsedDiagram,
  theme: ActiveTheme,
  termWidth: number,
): string {
  const { colors } = theme;
  const lines: string[] = [];

  // Participants
  const participants = parsed.nodes.map((n) => n.id);
  lines.push(colors.bold(colors.textPrimary('Sequence Flow: ' + participants.join(' ───> '))));

  for (const edge of parsed.edges) {
    const label = edge.label ? `: ${edge.label}` : '';
    lines.push(colors.textAccent(`  ${edge.from} ──────> ${edge.to}${label}`));
  }

  return lines.join('\n');
}
