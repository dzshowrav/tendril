import pc from 'picocolors';
import { theme, getSymbols, isNoColor, isAsciiMode } from './ui/theme.js';

const SPINNER_FRAMES_UTF8 = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_FRAMES_ASCII = ['-', '\\', '|', '/'];

export class EventRenderer {
  private inCodeFence = false;
  private inThinking = false;
  private currentTool: string | null = null;
  private toolOutputLines: string[] = [];
  private toolStartTime: number = 0;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private isSpinning = false;
  private spinnerFrameIdx = 0;
  private turnStartTime: number = 0;

  constructor(private out: (text: string) => void = (t) => process.stdout.write(t)) {}

  public startTurn(): void {
    this.turnStartTime = Date.now();
    this.startSpinner('Thinking...');
  }

  public startSpinner(message: string = 'Thinking...'): void {
    if (this.isSpinning) return;
    if (isNoColor() || !process.stdout.isTTY) return;

    this.isSpinning = true;
    this.spinnerFrameIdx = 0;
    const frames = isAsciiMode() ? SPINNER_FRAMES_ASCII : SPINNER_FRAMES_UTF8;

    this.spinnerTimer = setInterval(() => {
      const frame = frames[this.spinnerFrameIdx % frames.length];
      this.spinnerFrameIdx++;
      process.stdout.write(`\r${theme.secondary(frame)} ${theme.muted(message)} `);
    }, 80);
  }

  public stopSpinner(): void {
    if (!this.isSpinning) return;
    this.isSpinning = false;
    if (this.spinnerTimer) {
      clearInterval(this.spinnerTimer);
      this.spinnerTimer = null;
    }
    if (process.stdout.isTTY && !isNoColor()) {
      process.stdout.write('\r\x1B[K');
    }
  }

  public renderTextDelta(delta: string): void {
    this.stopSpinner();
    const s = getSymbols();
    const lines = delta.split('\n');

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

  public renderToolStart(tool: string, input: Record<string, unknown>): void {
    this.stopSpinner();
    const s = getSymbols();
    this.currentTool = tool;
    this.toolOutputLines = [];
    this.toolStartTime = Date.now();

    let argSummary = '';
    if (tool === 'read_file' || tool === 'write_file' || tool === 'edit_file') {
      argSummary = String(input.path || input.filePath || '');
    } else if (tool === 'list_dir') {
      argSummary = String(input.path || '.');
    } else if (tool === 'glob' || tool === 'grep') {
      argSummary = String(input.pattern || '');
    } else if (tool === 'bash') {
      argSummary = String(input.command || '');
    } else if (tool === 'web_fetch') {
      argSummary = String(input.url || '');
    } else {
      argSummary = JSON.stringify(input);
    }

    const icon = tool === 'bash' ? s.gear : tool.includes('file') ? s.zap : s.tool;
    this.out(`\n${theme.secondary(`${icon} ${tool}`)} ${theme.muted(argSummary)}\n`);
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

  public renderToolEnd(tool: string, success: boolean, summary?: string): void {
    this.stopSpinner();
    const s = getSymbols();
    const elapsedMs = this.toolStartTime > 0 ? Date.now() - this.toolStartTime : 0;
    const timeStr = elapsedMs > 0 ? ` (${elapsedMs}ms)` : '';

    if (!success) {
      this.out(`  ${theme.fail(summary || 'Tool execution failed')}${theme.muted(timeStr)}\n`);
    } else if (summary) {
      this.out(`  ${theme.muted(`${s.arrow} ${summary}${timeStr}`)}\n`);
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

  public renderPermissionPrompt(tool: string, summary: string): string {
    this.stopSpinner();
    return theme.permissionCard({ tool, target: summary });
  }
}
