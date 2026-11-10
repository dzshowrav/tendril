import pc from 'picocolors';
import { theme, getSymbols, isNoColor } from './ui/theme.js';
import { BusyIndicator } from './components/status/busy-indicator.js';
import { StreamBuffer } from './render/stream/buffer.js';

export class EventRenderer {
  private inCodeFence = false;
  private inThinking = false;
  private currentTool: string | null = null;
  private toolOutputLines: string[] = [];
  private toolStartTime: number = 0;
  private isSpinning = false;
  private turnStartTime: number = 0;
  private busyIndicator: BusyIndicator;
  private streamBuffer: StreamBuffer;
  private unsubBusy?: () => void;

  constructor(private out: (text: string) => void = (t) => process.stdout.write(t)) {
    this.busyIndicator = new BusyIndicator();
    this.streamBuffer = new StreamBuffer();
  }

  public startTurn(): void {
    this.turnStartTime = Date.now();
    this.streamBuffer.clear();
    this.startSpinner('Thinking...');
  }

  public startSpinner(message: string = 'Thinking...'): void {
    if (this.isSpinning) return;
    this.isSpinning = true;
    this.busyIndicator.startWorking(message);

    if (isNoColor() || !process.stdout.isTTY) return;

    if (this.unsubBusy) this.unsubBusy();
    this.unsubBusy = this.busyIndicator.onUpdate((rendered) => {
      if (this.isSpinning && process.stdout.isTTY && !isNoColor()) {
        process.stdout.write(`\r\x1B[K${rendered} `);
      }
    });
  }

  public pauseForUser(message: string = 'Awaiting permission...'): void {
    this.busyIndicator.pauseForUser(message);
    if (process.stdout.isTTY && !isNoColor()) {
      process.stdout.write(`\r\x1B[K${this.busyIndicator.render()}\n`);
    }
  }

  public stopSpinner(): void {
    if (!this.isSpinning) return;
    this.isSpinning = false;
    if (this.unsubBusy) {
      this.unsubBusy();
      this.unsubBusy = undefined;
    }
    this.busyIndicator.finish('done');
    if (process.stdout.isTTY && !isNoColor()) {
      process.stdout.write('\r\x1B[K');
    }
  }

  public renderTextDelta(delta: string): void {
    this.stopSpinner();
    const s = getSymbols();
    const formattedDelta = this.streamBuffer.wrapSynchronized(delta);
    const lines = formattedDelta.split('\n');

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];

      // Handle thinking tags if present
      if (line.includes('<think>')) {
        this.inThinking = true;
        line = line.replace('<think>', '');
        this.out(`\n${theme.muted(s.gutter)} ${theme.muted('Thinking...')}\n`);
      }
      if (line.includes('</think>')) {
        this.inThinking = false;
        line = line.replace('</think>', '');
      }

      // Check code fence toggle
      if (line.trim().startsWith('```')) {
        this.inCodeFence = !this.inCodeFence;
        this.out(theme.muted(line));
      } else if (this.inCodeFence) {
        // Code fence gutter
        this.out(`${theme.muted(s.gutter)} ${line}`);
      } else if (this.inThinking && line.trim()) {
        this.out(`${theme.muted(s.gutter)} ${theme.muted(line)}`);
      } else {
        this.out(line);
      }

      if (i < lines.length - 1) {
        this.out('\n');
      }
    }
  }

  public renderToolStart(tool?: string, input?: Record<string, unknown>): void {
    this.stopSpinner();
    const s = getSymbols();
    const toolName = tool || this.currentTool || 'tool';
    this.currentTool = toolName;
    this.toolOutputLines = [];
    this.toolStartTime = Date.now();

    const inp = input || {};
    let argSummary = '';
    if (toolName === 'read_file' || toolName === 'write_file' || toolName === 'edit_file') {
      argSummary = String(inp.path || inp.filePath || '');
    } else if (toolName === 'list_dir') {
      argSummary = String(inp.path || '.');
    } else if (toolName === 'glob' || toolName === 'grep') {
      argSummary = String(inp.pattern || '');
    } else if (toolName === 'bash') {
      argSummary = String(inp.command || '');
    } else if (toolName === 'web_fetch') {
      argSummary = String(inp.url || '');
    } else {
      argSummary = JSON.stringify(inp);
    }

    const icon = toolName === 'bash' ? s.gear : toolName.includes('file') ? s.zap : s.tool;
    this.out(`\n${theme.secondary(`${icon} ${toolName}`)} ${theme.muted(argSummary)}\n`);
  }

  public renderToolOutput(chunk: string): void {
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line) {
        this.toolOutputLines.push(line);
        this.out(`  ${theme.muted(line)}\n`);
      }
    }
  }

  public renderToolEnd(tool?: string, success?: boolean, summary?: string): void {
    this.stopSpinner();
    const s = getSymbols();
    const toolName = tool || this.currentTool || 'tool';
    const elapsedMs = this.toolStartTime > 0 ? Date.now() - this.toolStartTime : 0;
    const timeStr = elapsedMs > 0 ? ` (${elapsedMs}ms)` : '';

    const isSuccess = success !== false;
    if (!isSuccess) {
      this.out(`  ${theme.fail(summary || 'Tool execution failed')}${theme.muted(timeStr)}\n`);
    } else {
      this.out(`  ${theme.muted(`${s.arrow} ${summary || 'Completed'}${timeStr}`)}\n`);
    }
    this.currentTool = null;
    this.toolOutputLines = [];
    this.toolStartTime = 0;
  }

  public renderUsage(inputTokens: number, outputTokens: number): void {
    this.stopSpinner();
    const s = getSymbols();
    const formattedIn = inputTokens >= 1000 ? `${(inputTokens / 1000).toFixed(1)}k` : `${inputTokens}`;
    const formattedOut = outputTokens >= 1000 ? `${(outputTokens / 1000).toFixed(1)}k` : `${outputTokens}`;
    const total = inputTokens + outputTokens;
    const formattedTotal = total >= 1000 ? `${(total / 1000).toFixed(1)}k` : `${total}`;

    const elapsedS = this.turnStartTime > 0 ? ((Date.now() - this.turnStartTime) / 1000).toFixed(1) : null;
    const elapsedStr = elapsedS ? ` ${s.dot} ${elapsedS}s` : '';

    this.out(`\n${theme.muted(`${s.arrow} ${formattedTotal} tokens (${formattedIn} in ${s.dot} ${formattedOut} out)${elapsedStr}`)}\n`);
  }

  public renderDiff(diffText: string): void {
    if (!diffText) return;
    const lines = diffText.split('\n');

    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        this.out(isNoColor() ? `${line}\n` : pc.green(`${line}\n`));
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        this.out(isNoColor() ? `${line}\n` : pc.red(`${line}\n`));
      } else if (line.startsWith('@@')) {
        this.out(theme.secondary(`${line}\n`));
      } else {
        this.out(theme.muted(`${line}\n`));
      }
    }
  }

  public renderPermissionPrompt(
    tool: string,
    summary: string,
    opts?: { canAllowAlways?: boolean; reason?: string },
  ): string {
    this.pauseForUser('Awaiting permission...');
    return theme.permissionCard({
      tool,
      target: summary,
      canAllowAlways: opts?.canAllowAlways,
      reason: opts?.reason,
    });
  }
}
