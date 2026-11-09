import { DatabaseStore, TendrilEvent } from '@tendril/core';

export const MAX_RING_BUFFER_SIZE = 2000;
export const PING_INTERVAL_MS = 20 * 1000; // 20s
export const REVOCATION_CHECK_INTERVAL_MS = 1000; // 1s check for revoked clients

export interface StoredSSEEvent {
  seq: number;
  type: string;
  data: unknown;
}

export interface SSEClientConnection {
  id: string;
  sessionId: string;
  tokenHash?: string;
  send: (seq: number, event: string, data: unknown) => void;
  close: () => void;
}

export class SSEHub {
  // sessionId -> Array of StoredSSEEvent (max 2000)
  private ringBuffers = new Map<string, StoredSSEEvent[]>();

  // sessionId -> current sequence number
  private sessionSeqs = new Map<string, number>();

  // sessionId -> Set of active client connections
  private activeClients = new Map<string, Set<SSEClientConnection>>();

  private pingTimer: NodeJS.Timeout | null = null;
  private revocationTimer: NodeJS.Timeout | null = null;

  constructor(private db: DatabaseStore) {
    this.startTimers();
  }

  private startTimers(): void {
    // 20s Ping timer
    this.pingTimer = setInterval(() => {
      this.broadcastPing();
    }, PING_INTERVAL_MS);

    // 1s Revocation watchdog (ensures revoked client stream closes within 5s)
    this.revocationTimer = setInterval(() => {
      this.checkRevocations();
    }, REVOCATION_CHECK_INTERVAL_MS);
  }

  public stop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.revocationTimer) {
      clearInterval(this.revocationTimer);
      this.revocationTimer = null;
    }
    this.activeClients.clear();
    this.ringBuffers.clear();
  }

  private broadcastPing(): void {
    for (const [sessionId, clients] of this.activeClients.entries()) {
      const currentSeq = this.sessionSeqs.get(sessionId) || 1;
      for (const client of clients) {
        try {
          client.send(currentSeq, 'ping', {});
        } catch {
          // ignore send error
        }
      }
    }
  }

  private checkRevocations(): void {
    for (const [sessionId, clients] of this.activeClients.entries()) {
      for (const client of clients) {
        if (client.tokenHash) {
          try {
            const row = this.db.db
              .prepare('SELECT revoked_at FROM web_clients WHERE token_hash = ?')
              .get(client.tokenHash) as { revoked_at: string | null } | undefined;

            if (!row || row.revoked_at !== null) {
              // Revoked! Close stream immediately
              client.close();
              clients.delete(client);
            }
          } catch {
            // ignore DB check errors
          }
        }
      }
    }
  }

  /**
   * Publishes an event to a session, records in ring buffer, and delivers to active subscribers.
   */
  public publish(sessionId: string, eventType: string, data: unknown): StoredSSEEvent {
    let currentSeq = this.sessionSeqs.get(sessionId);
    if (currentSeq === undefined) {
      // Initialize from database session if available
      const s = this.db.getSession(sessionId);
      currentSeq = s?.next_event_seq || 1;
    }

    const seq = currentSeq;
    this.sessionSeqs.set(sessionId, seq + 1);

    // Save in DB session
    try {
      this.db.updateSession(sessionId, { next_event_seq: seq + 1 });
    } catch {
      // ignore
    }

    const event: StoredSSEEvent = { seq, type: eventType, data };

    // Push into ring buffer (capped at 2000)
    let buffer = this.ringBuffers.get(sessionId);
    if (!buffer) {
      buffer = [];
      this.ringBuffers.set(sessionId, buffer);
    }

    buffer.push(event);
    if (buffer.length > MAX_RING_BUFFER_SIZE) {
      buffer.shift();
    }

    // Broadcast to active clients for this session
    const clients = this.activeClients.get(sessionId);
    if (clients) {
      for (const client of clients) {
        try {
          client.send(event.seq, event.type, event.data);
        } catch {
          clients.delete(client);
        }
      }
    }

    return event;
  }

  /**
   * Subscribes a client to a session's SSE stream with Last-Event-ID replay or resync.
   */
  public subscribe(
    sessionId: string,
    client: SSEClientConnection,
    lastEventId?: string | null,
  ): void {
    let clients = this.activeClients.get(sessionId);
    if (!clients) {
      clients = new Set();
      this.activeClients.set(sessionId, clients);
    }
    clients.add(client);

    // Check for Last-Event-ID replay
    if (lastEventId) {
      const parsedLastId = parseInt(lastEventId, 10);
      if (!isNaN(parsedLastId)) {
        const buffer = this.ringBuffers.get(sessionId) || [];

        if (buffer.length > 0) {
          const oldestSeq = buffer[0].seq;
          if (parsedLastId < oldestSeq - 1) {
            // Missed events fell off the 2000-event ring buffer -> send resync
            client.send(oldestSeq - 1, 'resync', {});
          } else {
            // Replay missed events in strict order
            const missed = buffer.filter((e) => e.seq > parsedLastId);
            for (const event of missed) {
              client.send(event.seq, event.type, event.data);
            }
          }
        }
      }
    }
  }

  /**
   * Unsubscribes a client.
   */
  public unsubscribe(sessionId: string, client: SSEClientConnection): void {
    const clients = this.activeClients.get(sessionId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        this.activeClients.delete(sessionId);
      }
    }
  }
}
