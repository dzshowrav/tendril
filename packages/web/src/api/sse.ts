export interface TendrilEvent {
  seq: number;
  type: string;
  data: any;
}

export type EventCallback = (event: TendrilEvent) => void;
export type ResyncCallback = () => void;
export type StatusCallback = (connected: boolean) => void;

export class SessionSSEClient {
  private abortController: AbortController | null = null;
  private lastEventId: number | null = null;
  private isRunning = false;
  private seenSeqs = new Set<number>();
  private reconnectTimer: number | null = null;

  constructor(
    private sessionId: string,
    private onEvent: EventCallback,
    private onResync?: ResyncCallback,
    private onStatus?: StatusCallback,
  ) {}

  public start(initialLastEventId?: number): void {
    if (this.isRunning) return;
    this.isRunning = true;
    if (initialLastEventId !== undefined) {
      this.lastEventId = initialLastEventId;
    }
    this.connect();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.onStatus?.(false);
  }

  private async connect(): Promise<void> {
    if (!this.isRunning) return;

    this.abortController = new AbortController();
    const url = `/api/sessions/${this.sessionId}/events`;

    const headers: Record<string, string> = {};
    if (this.lastEventId !== null) {
      headers['Last-Event-ID'] = String(this.lastEventId);
    }

    try {
      const res = await fetch(url, {
        headers,
        signal: this.abortController.signal,
      });

      if (!res.ok) {
        throw new Error(`SSE stream returned HTTP ${res.status}`);
      }

      this.onStatus?.(true);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (this.isRunning && !this.abortController.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        for (const part of parts) {
          if (!part.trim()) continue;
          const lines = part.split('\n');
          let seq = 0;
          let eventType = 'message';
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('id:')) {
              seq = parseInt(line.slice(3).trim(), 10) || 0;
            } else if (line.startsWith('event:')) {
              eventType = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataStr = line.slice(5).trim();
            }
          }

          if (eventType === 'resync') {
            // Buffer gap, full refresh needed
            this.seenSeqs.clear();
            this.onResync?.();
            continue;
          }

          if (seq > 0) {
            // Deduplicate
            if (this.seenSeqs.has(seq)) {
              continue;
            }
            this.seenSeqs.add(seq);
            if (this.seenSeqs.size > 2000) {
              const oldest = Array.from(this.seenSeqs)[0];
              this.seenSeqs.delete(oldest);
            }
            this.lastEventId = seq;
          }

          if (dataStr) {
            try {
              const parsed = JSON.parse(dataStr);
              this.onEvent({ seq, type: eventType, data: parsed });
            } catch {
              this.onEvent({ seq, type: eventType, data: dataStr });
            }
          }
        }
      }
    } catch (err: any) {
      // Stream disconnected
    } finally {
      this.onStatus?.(false);
      if (this.isRunning) {
        // Auto-reconnect after 1.5s
        this.reconnectTimer = window.setTimeout(() => {
          this.connect();
        }, 1500);
      }
    }
  }
}
