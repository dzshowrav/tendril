import http from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  getTendrilPaths,
  TendrilPaths,
  SessionRow,
  SessionMode,
  MessageRow,
  SnapshotRow,
  DoctorResult,
  Config,
} from '@tendril/core';
import { readDaemonState, DaemonState, isPidAlive } from '@tendril/server';

export interface TendrilClientOptions {
  customHome?: string;
  baseUrl?: string;
  cliToken?: string;
  autoStartTimeoutMs?: number;
}

export interface ClientSessionResponse {
  session: SessionRow;
  messages: MessageRow[];
  pendingPermissions: Array<{
    requestId: string;
    sessionId: string;
    tool: string;
    parameters: Record<string, unknown>;
    rulePattern: string;
    created_at: string;
  }>;
}

export class TendrilClient {
  public paths: TendrilPaths;
  public baseUrl: string | null = null;
  public cliToken: string | null = null;

  constructor(private options: TendrilClientOptions = {}) {
    this.paths = getTendrilPaths(options.customHome);
    if (options.baseUrl) {
      this.baseUrl = options.baseUrl;
    }
    if (options.cliToken) {
      this.cliToken = options.cliToken;
    }
  }

  /**
   * Connects to an existing daemon or optionally auto-starts one.
   */
  public async ensureDaemon(autoStart = true): Promise<void> {
    if (this.baseUrl && this.cliToken) {
      try {
        await this.getHealth();
        return;
      } catch {
        // Fall through to auto-detect
      }
    }

    // Try reading state.json
    const state = readDaemonState(this.paths);
    if (state && isPidAlive(state.pid)) {
      this.baseUrl = `http://127.0.0.1:${state.port}`;
      this.cliToken = state.cliToken;
      try {
        await this.getHealth();
        return;
      } catch {
        // Unreachable, fall through
      }
    }

    if (!autoStart) {
      throw new Error('Daemon is not running. Start it with `tendril serve` or run an interactive command.');
    }

    // Auto-start daemon
    await this.startDaemonDetached();
  }

  private async startDaemonDetached(): Promise<void> {
    const cliScript = process.argv[1];
    const args = [cliScript, 'serve'];

    const child = spawn(process.execPath, args, {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, TENDRIL_HOME: this.paths.homeDir },
    });
    child.unref();

    // Poll for up to autoStartTimeoutMs (default 5 seconds)
    const timeoutMs = this.options.autoStartTimeoutMs ?? 5000;
    const timeout = Date.now() + timeoutMs;
    while (Date.now() < timeout) {
      await new Promise((r) => setTimeout(r, 200));
      const state = readDaemonState(this.paths);
      if (state && isPidAlive(state.pid)) {
        this.baseUrl = `http://127.0.0.1:${state.port}`;
        this.cliToken = state.cliToken;
        try {
          await this.getHealth();
          return;
        } catch {
          // Keep polling
        }
      }
    }

    // Failed to start -> read last 10 lines of logs
    let logTail = '';
    if (existsSync(this.paths.logPath)) {
      try {
        const lines = readFileSync(this.paths.logPath, 'utf8').trim().split('\n');
        logTail = lines.slice(-10).join('\n');
      } catch {
        // ignore
      }
    }

    throw new Error(
      `Failed to start Tendril daemon within 10s.\n${logTail ? `Recent daemon logs:\n${logTail}` : ''}`,
    );
  }

  private async request<T = any>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ): Promise<T> {
    if (!this.baseUrl) {
      await this.ensureDaemon(true);
    }

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      ...options.headers,
    };

    if (this.cliToken) {
      headers['Authorization'] = `Bearer ${this.cliToken}`;
    }

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const err = new Error(
        (data as any)?.error?.message || `HTTP ${res.status}: ${res.statusText}`,
      );
      (err as any).code = (data as any)?.error?.code || `HTTP_${res.status}`;
      (err as any).status = res.status;
      (err as any).data = data;
      throw err;
    }

    return data as T;
  }

  public async getHealth(): Promise<{ status: string; version: string; port: number }> {
    return this.request('/api/health');
  }

  public async listSessions(workspace?: string): Promise<{ sessions: SessionRow[] }> {
    const q = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return this.request(`/api/sessions${q}`);
  }

  public async createSession(input: {
    workspace: string;
    title?: string;
    provider?: string;
    model?: string;
    mode?: SessionMode;
  }): Promise<{ session: SessionRow }> {
    return this.request('/api/sessions', {
      method: 'POST',
      body: input,
    });
  }

  public async getSession(id: string): Promise<ClientSessionResponse> {
    return this.request(`/api/sessions/${id}`);
  }

  public async updateSession(
    id: string,
    updates: Partial<{ title: string; mode: SessionMode; model: string; provider: string }>,
  ): Promise<{ session: SessionRow }> {
    return this.request(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: updates,
    });
  }

  public async deleteSession(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/sessions/${id}`, {
      method: 'DELETE',
    });
  }

  public async sendMessage(id: string, text: string): Promise<{ ok: boolean; status: string }> {
    return this.request(`/api/sessions/${id}/messages`, {
      method: 'POST',
      body: { text },
    });
  }

  public async abortSession(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/sessions/${id}/abort`, {
      method: 'POST',
    });
  }

  public async compactSession(
    id: string,
  ): Promise<{ ok: boolean; summary?: string; droppedMessages?: number }> {
    return this.request(`/api/sessions/${id}/compact`, {
      method: 'POST',
    });
  }

  public async resolvePermission(
    id: string,
    requestId: string,
    decision: 'allow_once' | 'allow_always' | 'deny',
    note?: string,
  ): Promise<{ ok: boolean; decision: string }> {
    return this.request(`/api/sessions/${id}/permissions/${requestId}`, {
      method: 'POST',
      body: { decision, note },
    });
  }

  public async listChanges(id: string): Promise<{ changes: SnapshotRow[] }> {
    return this.request(`/api/sessions/${id}/changes`);
  }

  public async getChange(id: string, toolRunId: string): Promise<{ change: SnapshotRow }> {
    return this.request(`/api/sessions/${id}/changes/${toolRunId}`);
  }

  public async undoChange(
    id: string,
    toolRunId: string,
    force?: boolean,
  ): Promise<{ ok: boolean; restoredPath: string }> {
    return this.request(`/api/sessions/${id}/changes/${toolRunId}/undo`, {
      method: 'POST',
      body: { force },
    });
  }

  public async createPairCode(): Promise<{ code: string; expiresAt: string; url: string }> {
    return this.request('/api/pair/code', {
      method: 'POST',
    });
  }

  public async listRules(workspace?: string): Promise<{ rules: any[] }> {
    const q = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return this.request(`/api/permissions/rules${q}`);
  }

  public async deleteRule(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/permissions/rules/${id}`, {
      method: 'DELETE',
    });
  }

  public async getConfig(): Promise<{ config: Config }> {
    return this.request('/api/config');
  }

  public async updateConfig(updates: Partial<Config>): Promise<{ config: Config }> {
    return this.request('/api/config', {
      method: 'PUT',
      body: updates,
    });
  }

  public async getProviders(): Promise<{ providers: any[] }> {
    return this.request('/api/providers');
  }

  public async updateProvider(id: string, data: any): Promise<any> {
    return this.request(`/api/providers/${id}`, {
      method: 'PUT',
      body: data,
    });
  }

  public async testProvider(id: string): Promise<{ ok: boolean; message: string }> {
    return this.request(`/api/providers/${id}/test`, {
      method: 'POST',
    });
  }

  public async runDoctor(): Promise<{ results: DoctorResult }> {
    return this.request('/api/doctor');
  }

  /**
   * Subscribes to SSE events for a session.
   * Returns an abort function to disconnect.
   */
  public subscribeEvents(
    sessionId: string,
    onEvent: (event: { seq: number; type: string; data: any }) => void,
    onError?: (err: Error) => void,
    lastEventId?: number,
  ): () => void {
    const controller = new AbortController();

    (async () => {
      try {
        if (!this.baseUrl) {
          await this.ensureDaemon(true);
        }

        const headers: Record<string, string> = {};
        if (this.cliToken) {
          headers['Authorization'] = `Bearer ${this.cliToken}`;
        }
        if (lastEventId !== undefined) {
          headers['Last-Event-ID'] = String(lastEventId);
        }

        const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/events`, {
          headers,
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`SSE stream connection failed: HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            if (!part.trim()) continue;
            const lines = part.split('\n');
            let seq = 0;
            let type = 'message';
            let dataStr = '';

            for (const line of lines) {
              if (line.startsWith('id:')) {
                seq = parseInt(line.slice(3).trim(), 10) || 0;
              } else if (line.startsWith('event:')) {
                type = line.slice(6).trim();
              } else if (line.startsWith('data:')) {
                dataStr = line.slice(5).trim();
              }
            }

            if (dataStr) {
              try {
                const parsed = JSON.parse(dataStr);
                onEvent({ seq, type, data: parsed });
              } catch {
                onEvent({ seq, type, data: dataStr });
              }
            }
          }
        }
      } catch (err: any) {
        if (!controller.signal.aborted) {
          onError?.(err);
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }
}
