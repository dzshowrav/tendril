import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type HistoryMode = 'session' | 'global';

export interface HistoryOptions {
  mode?: HistoryMode;
  storagePath?: string;
  maxEntries?: number;
}

/**
 * Prompt History Manager with reverse search (Ctrl+R) and session/global modes.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 9).
 */
export class PromptHistory {
  private entries: string[] = [];
  private cursor = -1;
  private mode: HistoryMode;
  private storagePath: string;
  private maxEntries: number;

  constructor(options?: HistoryOptions) {
    this.mode = options?.mode || 'session';
    this.maxEntries = options?.maxEntries || 1000;
    const customHome = process.env.TENDRIL_HOME || join(homedir(), '.tendril');
    this.storagePath = options?.storagePath || join(customHome, 'history.txt');

    if (this.mode === 'global') {
      this.loadGlobal();
    }
  }

  public add(entry: string): void {
    const clean = entry.trim();
    if (!clean) return;

    // Remove existing duplicate if adjacent
    if (this.entries[this.entries.length - 1] === clean) {
      this.cursor = this.entries.length;
      return;
    }

    this.entries.push(clean);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }
    this.cursor = this.entries.length;

    if (this.mode === 'global') {
      this.saveGlobal();
    }
  }

  public getPrevious(): string | null {
    if (this.entries.length === 0) return null;
    if (this.cursor > 0) {
      this.cursor--;
      return this.entries[this.cursor];
    }
    return this.entries[0] || null;
  }

  public getNext(): string | null {
    if (this.entries.length === 0) return null;
    if (this.cursor < this.entries.length - 1) {
      this.cursor++;
      return this.entries[this.cursor];
    }
    this.cursor = this.entries.length;
    return '';
  }

  public resetCursor(): void {
    this.cursor = this.entries.length;
  }

  /**
   * Reverse incremental search (Ctrl+R).
   * Finds the most recent history entry matching the query.
   */
  public reverseSearch(query: string): string | null {
    const q = query.toLowerCase().trim();
    if (!q) return null;

    for (let i = this.entries.length - 1; i >= 0; i--) {
      if (this.entries[i].toLowerCase().includes(q)) {
        return this.entries[i];
      }
    }
    return null;
  }

  public setMode(mode: HistoryMode): void {
    this.mode = mode;
    if (mode === 'global') {
      this.loadGlobal();
    }
  }

  public getMode(): HistoryMode {
    return this.mode;
  }

  public getEntries(): string[] {
    return [...this.entries];
  }

  private loadGlobal(): void {
    if (existsSync(this.storagePath)) {
      try {
        const content = readFileSync(this.storagePath, 'utf8');
        this.entries = content
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        this.cursor = this.entries.length;
      } catch {
        // ignore
      }
    }
  }

  private saveGlobal(): void {
    try {
      writeFileSync(this.storagePath, this.entries.join('\n'), 'utf8');
    } catch {
      // ignore
    }
  }
}
