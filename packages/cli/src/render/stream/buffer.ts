import { detectTerminalCapabilities, TerminalCapabilities } from '../../capabilities/detector.js';

export interface StreamBufferOptions {
  caps?: TerminalCapabilities;
  onFlush?: (content: string) => void;
}

/**
 * Incremental stream buffer with flicker-free synchronized output (Mode 2026).
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 4.1).
 */
export class StreamBuffer {
  private buffer = '';
  private displayedLength = 0;
  private caps: TerminalCapabilities;
  private onFlush?: (content: string) => void;

  constructor(options?: StreamBufferOptions) {
    this.caps = options?.caps || detectTerminalCapabilities();
    this.onFlush = options?.onFlush;
  }

  public append(delta: string): string {
    this.buffer += delta;
    return this.flushNew();
  }

  public getRawContent(): string {
    return this.buffer;
  }

  public clear(): void {
    this.buffer = '';
    this.displayedLength = 0;
  }

  /**
   * Returns newly added content since last flush,
   * wrapped in synchronized output escape sequences if supported.
   */
  public flushNew(): string {
    if (this.buffer.length <= this.displayedLength) {
      return '';
    }

    const newContent = this.buffer.slice(this.displayedLength);
    this.displayedLength = this.buffer.length;

    const output = this.wrapSynchronized(newContent);
    if (this.onFlush) {
      this.onFlush(output);
    }
    return output;
  }

  /**
   * Wraps terminal output in Mode 2026 synchronized update if terminal supports it.
   */
  public wrapSynchronized(text: string): string {
    if (!this.caps.synchronizedOutput || !text) {
      return text;
    }
    // \x1b[?2026h = begin synchronized update
    // \x1b[?2026l = end synchronized update
    return `\x1b[?2026h${text}\x1b[?2026l`;
  }

  /**
   * Checks if markdown code fence is currently unclosed in the stream.
   */
  public hasUnclosedCodeFence(): boolean {
    const matches = this.buffer.match(/```/g);
    return Boolean(matches && matches.length % 2 !== 0);
  }

  /**
   * Safely formats content for preview, closing unclosed code fences
   * to prevent terminal styling bleeds.
   */
  public getSafePreviewContent(): string {
    if (this.hasUnclosedCodeFence()) {
      return `${this.buffer}\n\`\`\``;
    }
    return this.buffer;
  }
}
