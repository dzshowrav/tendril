/**
 * Reusable Overlay Panel Framework.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 10, § 14, § 21).
 *
 * Requirements:
 * - Searchable (fuzzy search)
 * - Scrollable
 * - Esc to dismiss
 * - Preserves conversation scroll state
 * - Clean semantic theme styling
 */

import { ActiveTheme, stripAnsi } from '../../theme/loader.js';

export interface PanelItem {
  id: string;
  title: string;
  description?: string;
  badge?: string;
  category?: string;
  details?: string | Record<string, any>;
  data?: any;
}

export interface PanelState {
  title: string;
  subtitle?: string;
  items: PanelItem[];
  filteredItems: PanelItem[];
  selectedIndex: number;
  scrollOffset: number;
  filterQuery: string;
  pageSize: number;
  width: number;
  isOpen: boolean;
}

export function createPanelState(options: {
  title: string;
  subtitle?: string;
  items: PanelItem[];
  pageSize?: number;
  width?: number;
}): PanelState {
  const pageSize = options.pageSize || 10;
  const width = options.width || 76;
  return {
    title: options.title,
    subtitle: options.subtitle,
    items: [...options.items],
    filteredItems: [...options.items],
    selectedIndex: 0,
    scrollOffset: 0,
    filterQuery: '',
    pageSize,
    width,
    isOpen: true,
  };
}

export function filterPanelItems(state: PanelState, query: string): PanelState {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? state.items.filter((item) => {
        const text = `${item.title} ${item.description || ''} ${item.badge || ''} ${item.category || ''}`.toLowerCase();
        return text.includes(q);
      })
    : [...state.items];

  return {
    ...state,
    filterQuery: query,
    filteredItems: filtered,
    selectedIndex: 0,
    scrollOffset: 0,
  };
}

export function movePanelCursor(state: PanelState, delta: number): PanelState {
  if (state.filteredItems.length === 0) return state;

  let newIndex = state.selectedIndex + delta;
  if (newIndex < 0) newIndex = 0;
  if (newIndex >= state.filteredItems.length) newIndex = state.filteredItems.length - 1;

  let newOffset = state.scrollOffset;
  if (newIndex < newOffset) {
    newOffset = newIndex;
  } else if (newIndex >= newOffset + state.pageSize) {
    newOffset = newIndex - state.pageSize + 1;
  }

  return {
    ...state,
    selectedIndex: newIndex,
    scrollOffset: newOffset,
  };
}

export function renderPanel(state: PanelState, theme: ActiveTheme): string {
  const { colors, symbols } = theme;
  const w = state.width;
  const innerW = w - 2;

  const lines: string[] = [];

  // Top border with title
  const titleText = ` ${colors.bold(colors.textPrimary(state.title))} `;
  const titleVisibleLen = stripAnsi(titleText).length;
  const topPadRight = Math.max(0, innerW - titleVisibleLen - 2);
  const topBorder =
    colors.borderFocus(symbols.boxTopLeft + symbols.boxHorizontal) +
    titleText +
    colors.borderFocus(symbols.boxHorizontal.repeat(topPadRight) + symbols.boxTopRight);
  lines.push(topBorder);

  // Subtitle / Search Bar
  const searchPrompt = colors.textMuted(' Search: ');
  const queryDisplay = state.filterQuery ? colors.textPrimary(state.filterQuery) : colors.textMuted('(type to filter)');
  const searchLine = searchPrompt + queryDisplay;
  const searchVisibleLen = stripAnsi(searchLine).length;
  const searchPad = Math.max(0, innerW - searchVisibleLen);
  lines.push(
    colors.borderFocus(symbols.boxVertical) +
      searchLine +
      ' '.repeat(searchPad) +
      colors.borderFocus(symbols.boxVertical),
  );

  // Divider
  lines.push(
    colors.borderDefault(
      symbols.boxDividerLeft + symbols.boxHorizontal.repeat(innerW) + symbols.boxDividerRight,
    ),
  );

  // Content items
  const visibleItems = state.filteredItems.slice(
    state.scrollOffset,
    state.scrollOffset + state.pageSize,
  );

  if (visibleItems.length === 0) {
    const emptyMsg = colors.textMuted('  No matching items found');
    const emptyPad = Math.max(0, innerW - stripAnsi(emptyMsg).length);
    lines.push(
      colors.borderDefault(symbols.boxVertical) +
        emptyMsg +
        ' '.repeat(emptyPad) +
        colors.borderDefault(symbols.boxVertical),
    );
  } else {
    for (let i = 0; i < visibleItems.length; i++) {
      const actualIndex = state.scrollOffset + i;
      const item = visibleItems[i];
      const isSelected = actualIndex === state.selectedIndex;

      const cursor = isSelected ? colors.promptAccent('❯ ') : '  ';
      const badgeStr = item.badge ? colors.dim(` [${item.badge}]`) : '';
      const categoryStr = item.category ? colors.textMuted(` (${item.category})`) : '';
      const titleStr = isSelected
        ? colors.bold(colors.textAccent(item.title))
        : colors.textPrimary(item.title);

      const descStr = item.description ? colors.textMuted(` - ${item.description}`) : '';

      let itemLine = `${cursor}${titleStr}${categoryStr}${badgeStr}${descStr}`;
      const itemVisibleLen = stripAnsi(itemLine).length;

      if (itemVisibleLen > innerW) {
        // Truncate cleanly
        itemLine = `${cursor}${titleStr}${categoryStr}${badgeStr}`;
        const shortLen = stripAnsi(itemLine).length;
        const available = innerW - shortLen - 3;
        if (available > 0 && item.description) {
          itemLine += colors.textMuted(` - ${item.description.slice(0, available)}...`);
        }
      }

      const curLen = stripAnsi(itemLine).length;
      const pad = Math.max(0, innerW - curLen);
      lines.push(
        colors.borderDefault(symbols.boxVertical) +
          itemLine +
          ' '.repeat(pad) +
          colors.borderDefault(symbols.boxVertical),
      );
    }
  }

  // Fill empty rows to keep panel height consistent
  const remainingRows = state.pageSize - visibleItems.length;
  for (let i = 0; i < Math.max(0, remainingRows); i++) {
    lines.push(
      colors.borderDefault(symbols.boxVertical) +
        ' '.repeat(innerW) +
        colors.borderDefault(symbols.boxVertical),
    );
  }

  // Divider above footer
  lines.push(
    colors.borderDefault(
      symbols.boxDividerLeft + symbols.boxHorizontal.repeat(innerW) + symbols.boxDividerRight,
    ),
  );

  // Footer navigation help
  const paginationInfo = state.filteredItems.length > 0
    ? ` ${state.selectedIndex + 1}/${state.filteredItems.length} `
    : ' 0/0 ';
  const shortcuts = ' ↑/↓: move  Enter: select  Esc: close ';
  const footerText = colors.textMuted(shortcuts) + colors.dim(paginationInfo);
  const footerVisibleLen = stripAnsi(footerText).length;
  const footerPad = Math.max(0, innerW - footerVisibleLen);

  const bottomBorder =
    colors.borderFocus(symbols.boxBottomLeft) +
    footerText +
    ' '.repeat(footerPad) +
    colors.borderFocus(symbols.boxBottomRight);
  lines.push(bottomBorder);

  return lines.join('\n');
}
