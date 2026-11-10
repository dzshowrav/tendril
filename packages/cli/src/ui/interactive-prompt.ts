/**
 * Interactive Terminal Prompt Controller.
 * Follows Visual Layout Specification (agent-harness-cli-visual-layout-spec.md).
 *
 * Implements:
 * - Real-time terminal Raw-Mode keypress loop (process.stdin.setRawMode)
 * - Pinned 1-row Footer / Status Bar (Zone F) with dynamic context hints
 * - Fixed-bottom upward expanding Bordered Input Box (Zone E)
 * - Floating Autocomplete Popup strictly ABOVE the Input Box (Zone D)
 * - In-place Permission Dialog takeover during tool approval
 * - Seamless fallback to readline in non-TTY / CI environments
 */

import readline from 'node:readline';
import { ScreenOrchestrator } from '../render/layout/orchestrator.js';
import { VisualInputBox, PasteChip } from '../components/input/box.js';
import { StatusBar, FooterState } from '../components/footer/status-bar.js';
import { AutocompletePopup, AutocompleteItem } from '../components/autocomplete/popup.js';
import { VisualApprovalDialog, ApprovalOption } from '../components/approval-bar/dialog.js';
import { TurnLayout } from '../render/conversation/turn-layout.js';
import { PromptHistory } from '../components/input/history.js';
import { PasteChipManager } from '../components/input/chips.js';
import { ActiveTheme, resolveActiveTheme } from '../theme/loader.js';
import { isNoColor } from './theme.js';

export interface InteractivePromptOptions {
  theme?: ActiveTheme;
  history?: PromptHistory;
  chipManager?: PasteChipManager;
  slashCommands?: { name: string; description: string }[];
  getMode?: () => string;
  getModel?: () => string;
  getContextPercent?: () => number;
}

export interface PromptResult {
  text: string;
  isShell: boolean;
  chips: PasteChip[];
}

export class InteractivePrompt {
  private orchestrator: ScreenOrchestrator;
  private inputBox: VisualInputBox;
  private statusBar: StatusBar;
  private popup: AutocompletePopup;
  private approvalDialog: VisualApprovalDialog;
  private turnLayout: TurnLayout;
  private history: PromptHistory;
  private chipManager: PasteChipManager;
  private activeTheme: ActiveTheme;

  private buffer = '';
  private cursorPos = 0;
  private chips: PasteChip[] = [];
  private slashCommands: { name: string; description: string }[] = [];
  private getMode: () => string;
  private getModel: () => string;
  private getContextPercent: () => number;

  private isPopupOpen = false;
  private popupItems: AutocompleteItem[] = [];
  private popupSelectedIndex = 0;
  private popupQuery = '';
  private isTurnRunning = false;
  private isAwaitingApproval = false;
  private activeResolver?: (result: PromptResult | null) => void;

  constructor(options: InteractivePromptOptions = {}) {
    this.activeTheme = options.theme || resolveActiveTheme();
    this.orchestrator = new ScreenOrchestrator((t) => process.stdout.write(t), this.activeTheme);
    this.inputBox = new VisualInputBox(this.activeTheme);
    this.statusBar = new StatusBar(this.activeTheme);
    this.popup = new AutocompletePopup(this.activeTheme);
    this.approvalDialog = new VisualApprovalDialog(this.activeTheme);
    this.turnLayout = new TurnLayout(this.activeTheme);
    this.history = options.history || new PromptHistory({ mode: 'session' });
    this.chipManager = options.chipManager || new PasteChipManager();
    this.slashCommands = options.slashCommands || [];
    this.getMode = options.getMode || (() => 'ask');
    this.getModel = options.getModel || (() => 'default');
    this.getContextPercent = options.getContextPercent || (() => 0);
  }

  public setTurnRunning(running: boolean): void {
    this.isTurnRunning = running;
    this.redraw();
  }

  public setAwaitingApproval(awaiting: boolean): void {
    this.isAwaitingApproval = awaiting;
  }

  public getOrchestrator(): ScreenOrchestrator {
    return this.orchestrator;
  }

  public getTurnLayout(): TurnLayout {
    return this.turnLayout;
  }

  /**
   * Evaluates dynamic footer state based on input and harnesses status.
   */
  private computeFooterState(): FooterState {
    if (this.isAwaitingApproval) return 'approval';
    if (this.isPopupOpen) return 'autocomplete';
    if (this.buffer.startsWith('!')) return 'shell';
    if (this.getMode() === 'plan') return 'plan';
    if (this.isTurnRunning) return 'running';
    if (this.chips.length > 0) return 'chip';
    if (this.buffer.includes('\n')) return 'multiline';
    if (this.buffer.length > 0) return 'typing';
    return 'idle';
  }

  /**
   * Recomputes and redraws the atomic live frame (Zones C, D, E, F).
   */
  public redraw(): void {
    if (!process.stdin.isTTY) return;

    const width = process.stdout.columns || 76;
    const footerState = this.computeFooterState();

    // Zone F: Footer
    const footerLine = this.statusBar.render({
      state: footerState,
      mode: this.getMode(),
      model: this.getModel(),
      contextPercent: this.getContextPercent(),
      width,
      theme: this.activeTheme,
    });

    // Zone E: Input Box
    const isShell = this.buffer.startsWith('!');
    const inputBoxLines = this.inputBox.render({
      value: this.buffer,
      mode: isShell ? 'shell' : (this.getMode() === 'plan' ? 'plan' : 'normal'),
      chips: this.chips,
      width,
    });

    // Zone D: Autocomplete popup (floating ABOVE input box)
    let popupLines: string[] | undefined;
    if (this.isPopupOpen && this.popupItems.length > 0) {
      popupLines = this.popup.render({
        categoryTitle: 'Commands',
        items: this.popupItems,
        selectedIndex: this.popupSelectedIndex,
        query: this.popupQuery,
        width: Math.min(width, 60),
      });
    }

    this.orchestrator.renderLiveFrame({
      zoneD: popupLines,
      zoneE: inputBoxLines,
      zoneF: footerLine,
    });
  }

  /**
   * Prompts the user for input in raw mode, updating the dynamic UI in place.
   */
  public prompt(): Promise<PromptResult | null> {
    return new Promise((resolve) => {
      this.buffer = '';
      this.cursorPos = 0;
      this.chips = [];
      this.isPopupOpen = false;
      this.activeResolver = resolve;

      if (!process.stdin.isTTY) {
        // Fallback for non-TTY / pipe / CI
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        rl.once('line', (line) => {
          rl.close();
          resolve({
            text: line,
            isShell: line.startsWith('!'),
            chips: [],
          });
        });
        return;
      }

      this.setupRawMode();
      this.redraw();
    });
  }

  /**
   * In-place permission dialog takeover for tool approval.
   */
  public async promptPermission(props: {
    type: 'command' | 'file' | 'trust_all';
    target: string;
    description?: string;
    canAllowAlways?: boolean;
    diffLines?: string[];
    queueInfo?: { current: number; total: number };
  }): Promise<{ decision: 'allow_once' | 'allow_always' | 'deny'; note?: string }> {
    this.isAwaitingApproval = true;
    const canAlways = props.canAllowAlways !== false;

    const options: ApprovalOption[] = [
      { key: '1', label: 'Yes, once', isDefault: true },
    ];
    if (canAlways) {
      options.push({ key: '2', label: `Yes, and trust exactly: ${props.target}` });
      options.push({ key: '3', label: 'No, and tell the agent what to do differently' });
    } else {
      options.push({ key: '2', label: 'No, and tell the agent what to do differently' });
    }

    let selectedIndex = 0;
    let isNoteOpen = false;
    let noteText = '';

    return new Promise((resolve) => {
      const renderDialog = () => {
        const width = process.stdout.columns || 76;
        const dialogLines = this.approvalDialog.render({
          type: props.type,
          target: props.target,
          description: props.description,
          diffLines: props.diffLines,
          queueInfo: props.queueInfo,
          options,
          selectedIndex,
          isNoteOpen,
          noteText,
          width,
        });

        const footerLine = this.statusBar.render({
          state: 'approval',
          mode: this.getMode(),
          model: this.getModel(),
          contextPercent: this.getContextPercent(),
          width,
          theme: this.activeTheme,
        });

        this.orchestrator.renderLiveFrame({
          zoneD: dialogLines,
          zoneF: footerLine,
        });
      };

      const cleanup = () => {
        process.stdin.removeListener('keypress', onKeyPress);
        this.isAwaitingApproval = false;
        this.orchestrator.clearLiveRegion();
      };

      const onKeyPress = (_str: string, key: readline.Key) => {
        if (!key) return;

        if (isNoteOpen) {
          if (key.name === 'return') {
            cleanup();
            resolve({ decision: 'deny', note: noteText.trim() || undefined });
            return;
          }
          if (key.name === 'escape') {
            isNoteOpen = false;
            renderDialog();
            return;
          }
          if (key.name === 'backspace') {
            noteText = noteText.slice(0, -1);
            renderDialog();
            return;
          }
          if (_str && _str.length === 1 && !key.ctrl) {
            noteText += _str;
            renderDialog();
            return;
          }
          return;
        }

        // Fast shortcut keys: y, a, n, d
        if (key.name === 'y') {
          cleanup();
          resolve({ decision: 'allow_once' });
          return;
        }
        if (key.name === 'a' && canAlways) {
          cleanup();
          resolve({ decision: 'allow_always' });
          return;
        }
        if (key.name === 'n') {
          cleanup();
          resolve({ decision: 'deny' });
          return;
        }

        // Tab opens inline note field
        if (key.name === 'tab') {
          isNoteOpen = true;
          renderDialog();
          return;
        }

        // Up/down arrow navigation
        if (key.name === 'up') {
          selectedIndex = Math.max(0, selectedIndex - 1);
          renderDialog();
          return;
        }
        if (key.name === 'down') {
          selectedIndex = Math.min(options.length - 1, selectedIndex + 1);
          renderDialog();
          return;
        }

        // Enter selects the highlighted option
        if (key.name === 'return') {
          cleanup();
          if (selectedIndex === 0) {
            resolve({ decision: 'allow_once' });
          } else if (selectedIndex === 1 && canAlways) {
            resolve({ decision: 'allow_always' });
          } else {
            resolve({ decision: 'deny' });
          }
          return;
        }

        // Escape cancels/denies
        if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
          cleanup();
          resolve({ decision: 'deny' });
          return;
        }
      };

      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.on('keypress', onKeyPress);
      renderDialog();
    });
  }

  private setupRawMode(): void {
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeyPress = (_str: string, key: readline.Key) => {
      if (!this.activeResolver) return;

      // Handle Ctrl+C
      if (key && key.ctrl && key.name === 'c') {
        this.tearDown(onKeyPress);
        const resolver = this.activeResolver;
        this.activeResolver = undefined;
        resolver(null);
        return;
      }

      // Handle Autocomplete Popup Navigation
      if (this.isPopupOpen) {
        if (key && key.name === 'escape') {
          this.isPopupOpen = false;
          this.redraw();
          return;
        }
        if (key && key.name === 'up') {
          this.popupSelectedIndex = Math.max(0, this.popupSelectedIndex - 1);
          this.redraw();
          return;
        }
        if (key && key.name === 'down') {
          this.popupSelectedIndex = Math.min(this.popupItems.length - 1, this.popupSelectedIndex + 1);
          this.redraw();
          return;
        }
        if (key && (key.name === 'tab' || key.name === 'return')) {
          const selected = this.popupItems[this.popupSelectedIndex];
          if (selected) {
            this.buffer = selected.name + ' ';
            this.cursorPos = this.buffer.length;
          }
          this.isPopupOpen = false;
          this.redraw();
          return;
        }
      }

      // Enter / Return key submits the input
      if (key && key.name === 'return') {
        const fullText = this.buffer;
        const currentChips = [...this.chips];
        this.tearDown(onKeyPress);

        const resolver = this.activeResolver;
        this.activeResolver = undefined;
        resolver({
          text: fullText,
          isShell: fullText.startsWith('!'),
          chips: currentChips,
        });
        return;
      }

      // Backspace
      if (key && key.name === 'backspace') {
        if (this.buffer.length > 0) {
          this.buffer = this.buffer.slice(0, -1);
          this.cursorPos = Math.max(0, this.cursorPos - 1);
          this.checkAutocomplete();
          this.redraw();
        } else if (this.chips.length > 0) {
          // Remove last chip if input is empty
          this.chips.pop();
          this.redraw();
        }
        return;
      }

      // Escape key clears input buffer
      if (key && key.name === 'escape') {
        if (this.buffer.length > 0) {
          this.buffer = '';
          this.cursorPos = 0;
          this.isPopupOpen = false;
          this.redraw();
        }
        return;
      }

      // History navigation (Up/Down when autocomplete popup is closed)
      if (key && key.name === 'up') {
        const prev = this.history.getPrevious();
        if (prev !== null) {
          this.buffer = prev;
          this.cursorPos = this.buffer.length;
          this.redraw();
        }
        return;
      }
      if (key && key.name === 'down') {
        const next = this.history.getNext();
        if (next !== null) {
          this.buffer = next;
          this.cursorPos = this.buffer.length;
          this.redraw();
        }
        return;
      }

      // Normal typing: insert character
      if (_str && _str.length > 0 && !key.ctrl) {
        // Multi-line paste detection
        if (_str.includes('\n') || _str.includes('\r')) {
          const lines = _str.split(/\r?\n/).filter((l) => l.length > 0);
          if (lines.length > 5) {
            this.chips.push({ id: `chip-${Date.now()}`, lineCount: lines.length });
            this.redraw();
            return;
          }
        }

        this.buffer += _str;
        this.cursorPos += _str.length;
        this.checkAutocomplete();
        this.redraw();
      }
    };

    process.stdin.on('keypress', onKeyPress);
  }

  private checkAutocomplete(): void {
    if (this.buffer.startsWith('/')) {
      this.popupQuery = this.buffer;
      const clean = this.buffer.toLowerCase();
      this.popupItems = this.slashCommands
        .filter((c) => c.name.toLowerCase().startsWith(clean))
        .map((c) => ({ name: c.name, description: c.description, type: 'command' }));

      this.isPopupOpen = this.popupItems.length > 0;
      this.popupSelectedIndex = 0;
    } else {
      this.isPopupOpen = false;
    }
  }

  private tearDown(listener: (_str: string, key: readline.Key) => void): void {
    process.stdin.removeListener('keypress', listener);
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    this.orchestrator.clearLiveRegion();
  }
}
