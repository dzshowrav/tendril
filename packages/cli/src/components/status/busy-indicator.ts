import { setProgramStatus } from '../../capabilities/detector.js';
import { ActiveTheme, resolveActiveTheme } from '../../theme/loader.js';

export type BusyState =
  | 'idle'
  | 'working'
  | 'waiting_for_user'
  | 'done'
  | 'error'
  | 'cancelled';

export interface BusyIndicatorListener {
  (renderString: string, state: BusyState): void;
}

/**
 * Busy Indicator State Machine with frozen waiting timer.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 4.4).
 * State Machine: idle -> working -> (waiting_for_user -> working)* -> done | error | cancelled
 */
export class BusyIndicator {
  private state: BusyState = 'idle';
  private spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frameIndex = 0;
  private intervalTimer: NodeJS.Timeout | null = null;

  // Active elapsed time tracking
  private accumulatedWorkMs = 0;
  private workStartTime: number | null = null;
  private currentMessage = 'Thinking...';
  private listeners: Set<BusyIndicatorListener> = new Set();
  private theme: ActiveTheme;

  constructor(theme?: ActiveTheme) {
    this.theme = theme || resolveActiveTheme();
  }

  public getState(): BusyState {
    return this.state;
  }

  public getActiveElapsedMs(): number {
    let current = this.accumulatedWorkMs;
    if (this.state === 'working' && this.workStartTime !== null) {
      current += Date.now() - this.workStartTime;
    }
    return current;
  }

  public getFormattedElapsedTime(): string {
    const sec = (this.getActiveElapsedMs() / 1000).toFixed(1);
    return `${sec}s`;
  }

  /**
   * Transition to 'working' state
   */
  public startWorking(message = 'Thinking...'): void {
    this.currentMessage = message;
    if (this.state !== 'working') {
      this.state = 'working';
      this.workStartTime = Date.now();
      setProgramStatus('working');
      this.startTicker();
    }
  }

  /**
   * Transition to 'waiting_for_user' state.
   * Freezes the active elapsed timer so user think time is not counted as agent work time.
   */
  public pauseForUser(message = 'Awaiting approval...'): void {
    if (this.state === 'working' && this.workStartTime !== null) {
      this.accumulatedWorkMs += Date.now() - this.workStartTime;
      this.workStartTime = null;
    }
    this.state = 'waiting_for_user';
    this.currentMessage = message;
    setProgramStatus('waiting');
    this.notify();
  }

  /**
   * Transition to terminal states: 'done' | 'error' | 'cancelled'
   */
  public finish(resultState: 'done' | 'error' | 'cancelled' = 'done'): void {
    if (this.state === 'working' && this.workStartTime !== null) {
      this.accumulatedWorkMs += Date.now() - this.workStartTime;
      this.workStartTime = null;
    }
    this.state = resultState;
    this.stopTicker();

    setProgramStatus(resultState === 'error' ? 'error' : 'done');
    this.notify();
  }

  /**
   * Reset back to 'idle'
   */
  public reset(): void {
    this.stopTicker();
    this.state = 'idle';
    this.accumulatedWorkMs = 0;
    this.workStartTime = null;
    this.currentMessage = '';
    setProgramStatus('idle');
  }

  public onUpdate(listener: BusyIndicatorListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public render(): string {
    const { colors, symbols } = this.theme;
    const timeStr = colors.textMuted(`(${this.getFormattedElapsedTime()})`);

    switch (this.state) {
      case 'working': {
        const frame = colors.statusRunning(this.spinnerFrames[this.frameIndex]);
        return `${frame} ${colors.textPrimary(this.currentMessage)} ${timeStr}`;
      }
      case 'waiting_for_user': {
        const icon = colors.statusWaiting(symbols.waiting);
        return `${icon} ${colors.textWarning(this.currentMessage)} ${timeStr} [timer paused]`;
      }
      case 'done': {
        const icon = colors.statusSuccess(symbols.success);
        return `${icon} ${colors.textSuccess('Done')} ${timeStr}`;
      }
      case 'error': {
        const icon = colors.statusError(symbols.error);
        return `${icon} ${colors.textError('Error')} ${timeStr}`;
      }
      case 'cancelled': {
        const icon = colors.textMuted('—');
        return `${icon} ${colors.textMuted('Cancelled')} ${timeStr}`;
      }
      case 'idle':
      default:
        return '';
    }
  }

  private startTicker(): void {
    if (this.intervalTimer) return;
    this.intervalTimer = setInterval(() => {
      this.frameIndex = (this.frameIndex + 1) % this.spinnerFrames.length;
      this.notify();
    }, 80);
    this.notify();
  }

  private stopTicker(): void {
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private notify(): void {
    const rendered = this.render();
    for (const listener of this.listeners) {
      listener(rendered, this.state);
    }
  }
}
