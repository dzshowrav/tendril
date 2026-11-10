/**
 * Document Review Screen Component.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 12).
 *
 * Requirements:
 * - Line-by-line reading with vim keys: j, k, g, G, Ctrl+U, Ctrl+D, n, N, ], [.
 * - Staging comments per line. Comments persist across returning to checkpoint.
 * - Single revision request bundling all staged comments upon submit.
 * - Help overlay showing all shortcuts on '?'.
 */

import { ActiveTheme, stripAnsi } from '../../theme/loader.js';

export interface StagedComment {
  lineIndex: number;
  text: string;
  createdAt: number;
}

export interface DocumentReviewState {
  documentTitle: string;
  lines: string[];
  currentLine: number;
  scrollOffset: number;
  pageSize: number;
  stagedComments: Map<number, StagedComment>;
  showHelp: boolean;
}

export function createReviewState(options: {
  title: string;
  content: string;
  existingComments?: StagedComment[];
  pageSize?: number;
}): DocumentReviewState {
  const lines = options.content.split('\n');
  const commentMap = new Map<number, StagedComment>();
  if (options.existingComments) {
    for (const c of options.existingComments) {
      commentMap.set(c.lineIndex, c);
    }
  }

  return {
    documentTitle: options.title,
    lines,
    currentLine: 0,
    scrollOffset: 0,
    pageSize: options.pageSize || 12,
    stagedComments: commentMap,
    showHelp: false,
  };
}

export function stageComment(
  state: DocumentReviewState,
  lineIndex: number,
  commentText: string,
): DocumentReviewState {
  const newMap = new Map(state.stagedComments);
  newMap.set(lineIndex, {
    lineIndex,
    text: commentText.trim(),
    createdAt: Date.now(),
  });
  return { ...state, stagedComments: newMap };
}

export function deleteComment(
  state: DocumentReviewState,
  lineIndex: number,
): DocumentReviewState {
  const newMap = new Map(state.stagedComments);
  newMap.delete(lineIndex);
  return { ...state, stagedComments: newMap };
}

export function handleReviewNavigation(
  state: DocumentReviewState,
  key: string,
): DocumentReviewState {
  const total = state.lines.length;
  if (total === 0) return state;

  let newLine = state.currentLine;

  switch (key) {
    case 'j':
    case 'down':
      newLine = Math.min(total - 1, newLine + 1);
      break;

    case 'k':
    case 'up':
      newLine = Math.max(0, newLine - 1);
      break;

    case 'g':
    case 'home':
      newLine = 0;
      break;

    case 'G':
    case 'end':
      newLine = total - 1;
      break;

    case 'ctrl+d':
    case 'pagedown':
      newLine = Math.min(total - 1, newLine + Math.floor(state.pageSize / 2));
      break;

    case 'ctrl+u':
    case 'pageup':
      newLine = Math.max(0, newLine - Math.floor(state.pageSize / 2));
      break;

    case ']': {
      // Jump to next comment
      const commentLines = Array.from(state.stagedComments.keys()).sort((a, b) => a - b);
      const next = commentLines.find((l) => l > state.currentLine);
      if (next !== undefined) newLine = next;
      break;
    }

    case '[': {
      // Jump to previous comment
      const commentLines = Array.from(state.stagedComments.keys()).sort((a, b) => b - a);
      const prev = commentLines.find((l) => l < state.currentLine);
      if (prev !== undefined) newLine = prev;
      break;
    }

    case '?':
      return { ...state, showHelp: !state.showHelp };
  }

  // Adjust scroll offset
  let newOffset = state.scrollOffset;
  if (newLine < newOffset) {
    newOffset = newLine;
  } else if (newLine >= newOffset + state.pageSize) {
    newOffset = newLine - state.pageSize + 1;
  }

  return {
    ...state,
    currentLine: newLine,
    scrollOffset: newOffset,
  };
}

/**
 * Bundles all staged comments into a unified revision feedback string.
 * Fulfills Acceptance Criterion (§ 12): "সব comment একটি অনুরোধে পাঠানো হয়।"
 */
export function buildRevisionBundle(state: DocumentReviewState): string {
  const comments = Array.from(state.stagedComments.values()).sort(
    (a, b) => a.lineIndex - b.lineIndex,
  );

  if (comments.length === 0) return '';

  const header = `Revision Feedback for ${state.documentTitle} (${comments.length} comments):`;
  const items = comments.map(
    (c) => `• Line ${c.lineIndex + 1} ["${state.lines[c.lineIndex]?.trim() || ''}"]: ${c.text}`,
  );

  return `${header}\n${items.join('\n')}`;
}

export function renderDocumentReview(
  state: DocumentReviewState,
  theme: ActiveTheme,
  width = 76,
): string {
  const { colors, symbols } = theme;
  const innerW = width - 2;
  const lines: string[] = [];

  // Top border
  const title = ` Review: ${state.documentTitle} (Line ${state.currentLine + 1}/${state.lines.length}) `;
  lines.push(
    colors.borderFocus(symbols.boxTopLeft + symbols.boxHorizontal) +
      colors.bold(colors.textPrimary(title)) +
      colors.borderFocus(symbols.boxHorizontal.repeat(Math.max(0, innerW - stripAnsi(title).length - 1)) + symbols.boxTopRight),
  );

  // Help overlay if toggled (§ 12)
  if (state.showHelp) {
    lines.push(colors.borderDefault(symbols.boxVertical) + colors.bold(colors.textAccent('  Shortcut Reference:')) + ' '.repeat(Math.max(0, innerW - 22)) + colors.borderDefault(symbols.boxVertical));
    lines.push(colors.borderDefault(symbols.boxVertical) + colors.textMuted('  j/k or ↑/↓: Line  g/G: Top/Bottom  Ctrl+D/Ctrl+U: Half-Page') + ' '.repeat(Math.max(0, innerW - 61)) + colors.borderDefault(symbols.boxVertical));
    lines.push(colors.borderDefault(symbols.boxVertical) + colors.textMuted('  ]/[: Next/Prev Comment  Enter: Stage Comment  Del: Remove') + ' '.repeat(Math.max(0, innerW - 61)) + colors.borderDefault(symbols.boxVertical));
    lines.push(colors.borderDefault(symbols.boxVertical) + colors.textMuted('  ?: Toggle Help  Esc/q: Exit Review') + ' '.repeat(Math.max(0, innerW - 37)) + colors.borderDefault(symbols.boxVertical));
    lines.push(colors.borderDefault(symbols.boxDividerLeft + symbols.boxHorizontal.repeat(innerW) + symbols.boxDividerRight));
  }

  // Document lines
  const visible = state.lines.slice(
    state.scrollOffset,
    state.scrollOffset + state.pageSize,
  );

  for (let i = 0; i < visible.length; i++) {
    const actualLineIndex = state.scrollOffset + i;
    const isCurrent = actualLineIndex === state.currentLine;
    const lineText = visible[i];
    const hasComment = state.stagedComments.has(actualLineIndex);

    const cursor = isCurrent ? colors.promptAccent('❯ ') : '  ';
    const commentBadge = hasComment ? colors.statusWaiting(' [💬] ') : '      ';
    const lineNum = colors.dim(`${String(actualLineIndex + 1).padStart(4)} │ `);

    const content = isCurrent ? colors.bold(colors.textPrimary(lineText)) : colors.textMuted(lineText);
    const row = `${cursor}${commentBadge}${lineNum}${content}`;
    const rowVisible = stripAnsi(row).length;

    lines.push(
      colors.borderDefault(symbols.boxVertical) +
        row +
        ' '.repeat(Math.max(0, innerW - rowVisible)) +
        colors.borderDefault(symbols.boxVertical),
    );

    // If comment exists, render comment callout row
    if (hasComment) {
      const commentObj = state.stagedComments.get(actualLineIndex)!;
      const commentLine = `        ${colors.textAccent(`↳ Comment: "${commentObj.text}"`)}`;
      const commentLen = stripAnsi(commentLine).length;
      lines.push(
        colors.borderDefault(symbols.boxVertical) +
          commentLine +
          ' '.repeat(Math.max(0, innerW - commentLen)) +
          colors.borderDefault(symbols.boxVertical),
      );
    }
  }

  // Footer
  lines.push(
    colors.borderDefault(
      symbols.boxDividerLeft + symbols.boxHorizontal.repeat(innerW) + symbols.boxDividerRight,
    ),
  );

  const commentCount = state.stagedComments.size;
  const footerHelp = ` Staged Comments: ${commentCount} · Enter: Comment · ?: Help · Esc/q: Done `;
  const footerLen = stripAnsi(footerHelp).length;
  lines.push(
    colors.borderFocus(symbols.boxBottomLeft) +
      colors.textMuted(footerHelp) +
      colors.borderFocus(symbols.boxHorizontal.repeat(Math.max(0, innerW - footerLen)) + symbols.boxBottomRight),
  );

  return lines.join('\n');
}
