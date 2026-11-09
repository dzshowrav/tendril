import pc from 'picocolors';
import { theme, getSymbols, isNoColor } from './ui/theme.js';

export class EventRenderer {
  private inCodeFence = false;
  private currentTool: string | null = null;
  private toolOutputLines: string[] = [];

  constructor(private out: (text: string) => void = (t) => process.stdout.write(t)) {}

  public renderTextDelta(delta: string): void {
    const s = getSymbols();
    const lines = delta.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check code fence toggle
      if (line.trim().startsWith('```')) {
        this.inCodeFence = !this.inCodeFence;
        this.out(theme.muted(line));
      } else if (this.inCodeFence) {
        // Code fence gutter
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
    const s = getSymbols();
    this.currentTool = tool;
    this.toolOutputLines = [];

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

    this.out(`\n${theme.secondary(s.tool)} ${theme.secondary(tool)} ${theme.muted(argSummary)}\n`);
  }

  public renderToolOutput(chunk: string): void {
    // Collect output lines for bash or other tools
    const s = getSymbols();
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line) {
        this.toolOutputLines.push(line);
        this.out(`  ${theme.muted(line)}\n`);
      }
    }
  }

  public renderToolEnd(tool: string, success: boolean, summary?: string): void {
    const s = getSymbols();
    if (!success) {
      this.out(`  ${theme.fail(summary || 'Tool execution failed')}\n`);
    } else if (summary) {
      this.out(`  ${theme.muted(`${s.arrow} ${summary}`)}\n`);
    }
    this.currentTool = null;
    this.toolOutputLines = [];
  }

  public renderUsage(inputTokens: number, outputTokens: number): void {
    const s = getSymbols();
    const formattedIn = inputTokens >= 1000 ? `${(inputTokens / 1000).toFixed(1)}k` : `${inputTokens}`;
    const formattedOut = outputTokens >= 1000 ? `${(outputTokens / 1000).toFixed(1)}k` : `${outputTokens}`;
    this.out(`\n${theme.muted(`${s.arrow} ${formattedIn} in ${s.dot} ${formattedOut} out`)}\n`);
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
    const s = getSymbols();
    const question = `${s.question} Allow ${tool}: ${summary}`;
    const options = '[y]once [a]lways [n]o';
    return theme.warning(`${question}  ${options} ${s.prompt} `);
  }
}
