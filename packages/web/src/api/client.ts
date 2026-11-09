export interface ApiError {
  code: string;
  message: string;
  status: number;
}

export class ApiClient {
  private static async request<T = any>(
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    const isJson = res.headers.get('content-type')?.includes('application/json');
    const data = isJson ? await res.json() : await res.text();

    if (!res.ok) {
      const err: ApiError = {
        code: data?.error?.code || `HTTP_${res.status}`,
        message: data?.error?.message || res.statusText || 'Request failed',
        status: res.status,
      };
      throw err;
    }

    return data as T;
  }

  // Health
  public static async getHealth(): Promise<{ status: string; version: string; port: number }> {
    return this.request('/api/health');
  }

  // Pairing & Auth
  public static async pair(code: string, label = 'Tendril Web'): Promise<{ ok: boolean; client: any }> {
    return this.request('/api/pair', {
      method: 'POST',
      body: JSON.stringify({ code, label }),
    });
  }

  public static async logout(): Promise<{ ok: boolean }> {
    return this.request('/api/logout', { method: 'POST' });
  }

  // Sessions
  public static async listSessions(workspace?: string): Promise<{ sessions: any[] }> {
    const q = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
    return this.request(`/api/sessions${q}`);
  }

  public static async createSession(data: {
    workspace: string;
    title?: string;
    provider?: string;
    model?: string;
    mode?: string;
  }): Promise<{ session: any }> {
    return this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public static async getSession(id: string): Promise<{
    session: any;
    messages: any[];
    pendingPermissions: any[];
  }> {
    return this.request(`/api/sessions/${id}`);
  }

  public static async updateSession(id: string, updates: any): Promise<{ session: any }> {
    return this.request(`/api/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  public static async deleteSession(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/sessions/${id}`, {
      method: 'DELETE',
    });
  }

  // Messages & Turns
  public static async sendMessage(sessionId: string, text: string): Promise<{ ok: boolean }> {
    return this.request(`/api/sessions/${sessionId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }

  public static async abortSession(sessionId: string): Promise<{ ok: boolean }> {
    return this.request(`/api/sessions/${sessionId}/abort`, {
      method: 'POST',
    });
  }

  public static async compactSession(sessionId: string): Promise<{ ok: boolean; droppedMessages?: number }> {
    return this.request(`/api/sessions/${sessionId}/compact`, {
      method: 'POST',
    });
  }

  // Permissions
  public static async resolvePermission(
    sessionId: string,
    requestId: string,
    decision: 'allow_once' | 'allow_always' | 'deny',
    note?: string,
  ): Promise<{ ok: boolean; decision: string }> {
    return this.request(`/api/sessions/${sessionId}/permissions/${requestId}`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    });
  }

  // Changes & Diffs
  public static async listChanges(sessionId: string): Promise<{ changes: any[] }> {
    return this.request(`/api/sessions/${sessionId}/changes`);
  }

  public static async undoChange(sessionId: string, toolRunId: string, force?: boolean): Promise<{ ok: boolean }> {
    return this.request(`/api/sessions/${sessionId}/changes/${toolRunId}/undo`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    });
  }

  // Files & Directories
  public static async listFiles(sessionId: string, path = '.'): Promise<{ dirs: any[]; files: any[]; path: string }> {
    return this.request(`/api/sessions/${sessionId}/files?path=${encodeURIComponent(path)}`);
  }

  public static async readFile(sessionId: string, path: string): Promise<{ content: string }> {
    return this.request(`/api/sessions/${sessionId}/file?path=${encodeURIComponent(path)}`);
  }

  public static async listFsDirs(path?: string): Promise<{ current: string; parent: string | null; dirs: string[] }> {
    const q = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.request(`/api/fs/dirs${q}`);
  }

  // Settings: Config, Providers, Rules, Clients, Doctor
  public static async getConfig(): Promise<{ config: any }> {
    return this.request('/api/config');
  }

  public static async updateConfig(config: any): Promise<{ config: any }> {
    return this.request('/api/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  public static async getProviders(): Promise<{ providers: any[] }> {
    return this.request('/api/providers');
  }

  public static async updateProvider(id: string, data: any): Promise<{ ok: boolean; provider: any }> {
    return this.request(`/api/providers/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  public static async deleteProvider(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/providers/${id}`, {
      method: 'DELETE',
    });
  }

  public static async testProvider(id: string): Promise<{ ok: boolean; message: string }> {
    return this.request(`/api/providers/${id}/test`, {
      method: 'POST',
    });
  }

  public static async getRules(): Promise<{ rules: any[] }> {
    return this.request('/api/permissions/rules');
  }

  public static async deleteRule(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/permissions/rules/${id}`, {
      method: 'DELETE',
    });
  }

  public static async getClients(): Promise<{ clients: any[] }> {
    return this.request('/api/clients');
  }

  public static async deleteClient(id: string): Promise<{ ok: boolean }> {
    return this.request(`/api/clients/${id}`, {
      method: 'DELETE',
    });
  }

  public static async getDoctor(): Promise<{ results: any }> {
    return this.request('/api/doctor');
  }
}
