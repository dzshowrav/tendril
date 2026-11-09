import { create } from 'zustand';
import { ApiClient } from '../api/client.js';
import { SessionSSEClient, TendrilEvent } from '../api/sse.js';

export interface PendingPermission {
  requestId: string;
  sessionId: string;
  tool: string;
  parameters: Record<string, unknown>;
  rulePattern: string;
  created_at: string;
  canAllowAlways?: boolean;
  disallowReason?: string;
}

interface SessionState {
  sessions: any[];
  activeSession: any | null;
  messages: any[];
  streamingAssistantText: string;
  activeTool: { tool: string; input: any; output: string[] } | null;
  pendingPermission: PendingPermission | null;
  turnStatus: string;
  isStreamConnected: boolean;
  sseClient: SessionSSEClient | null;

  loadSessions: (workspace?: string) => Promise<void>;
  createSession: (data: { workspace: string; title?: string; mode?: string; model?: string }) => Promise<any>;
  selectSession: (id: string) => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  abortCurrentTurn: () => Promise<void>;
  resolvePermission: (decision: 'allow_once' | 'allow_always' | 'deny', note?: string) => Promise<void>;
  refreshActiveSession: () => Promise<void>;
  clearActiveSession: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSession: null,
  messages: [],
  streamingAssistantText: '',
  activeTool: null,
  pendingPermission: null,
  turnStatus: 'idle',
  isStreamConnected: false,
  sseClient: null,

  loadSessions: async (workspace?: string) => {
    try {
      const { sessions } = await ApiClient.listSessions(workspace);
      set({ sessions });
    } catch {
      // ignore
    }
  },

  createSession: async (data) => {
    const { session } = await ApiClient.createSession(data);
    await get().loadSessions();
    return session;
  },

  selectSession: async (id: string) => {
    // Clean up previous SSE client
    const prevClient = get().sseClient;
    if (prevClient) {
      prevClient.stop();
    }

    set({
      activeSession: null,
      messages: [],
      streamingAssistantText: '',
      activeTool: null,
      pendingPermission: null,
      turnStatus: 'idle',
    });

    try {
      const { session, messages, pendingPermissions } = await ApiClient.getSession(id);
      const pending = pendingPermissions && pendingPermissions.length > 0 ? pendingPermissions[0] : null;

      set({
        activeSession: session,
        messages,
        pendingPermission: pending,
        turnStatus: session.status || 'idle',
      });

      // Start SSE stream
      const sse = new SessionSSEClient(
        id,
        (event: TendrilEvent) => {
          const state = get();

          switch (event.type) {
            case 'text.delta':
              set({
                streamingAssistantText: state.streamingAssistantText + (event.data.text || ''),
              });
              break;

            case 'tool.start':
              set({
                activeTool: {
                  tool: event.data.tool,
                  input: event.data.input,
                  output: [],
                },
              });
              break;

            case 'tool.output':
              if (state.activeTool) {
                set({
                  activeTool: {
                    ...state.activeTool,
                    output: [...state.activeTool.output, event.data.chunk || ''],
                  },
                });
              }
              break;

            case 'tool.end':
              set({ activeTool: null });
              break;

            case 'tool.permission':
              set({
                pendingPermission: {
                  requestId: event.data.requestId,
                  sessionId: id,
                  tool: event.data.tool,
                  parameters: event.data.input || {},
                  rulePattern: event.data.rulePattern || '',
                  created_at: new Date().toISOString(),
                  canAllowAlways: (event.data as any).options?.canAllowAlways !== false,
                  disallowReason: (event.data as any).options?.disallowAlwaysReason,
                },
                turnStatus: 'awaiting_permission',
              });
              break;

            case 'permission.resolved':
              set({ pendingPermission: null });
              break;

            case 'session.status':
              set({ turnStatus: event.data.status });
              if (event.data.status === 'idle') {
                // Turn ended, refresh messages
                get().refreshActiveSession();
              }
              break;

            case 'session.updated':
              if (state.activeSession) {
                set({
                  activeSession: { ...state.activeSession, ...event.data },
                });
              }
              break;
          }
        },
        () => {
          // On resync
          get().refreshActiveSession();
        },
        (connected: boolean) => {
          set({ isStreamConnected: connected });
        },
      );

      sse.start();
      set({ sseClient: sse });
    } catch {
      // ignore
    }
  },

  refreshActiveSession: async () => {
    const active = get().activeSession;
    if (!active) return;
    try {
      const { session, messages, pendingPermissions } = await ApiClient.getSession(active.id);
      set({
        activeSession: session,
        messages,
        streamingAssistantText: '',
        turnStatus: session.status || 'idle',
        pendingPermission: pendingPermissions && pendingPermissions.length > 0 ? pendingPermissions[0] : null,
      });
    } catch {
      // ignore
    }
  },

  sendMessage: async (text: string) => {
    const active = get().activeSession;
    if (!active) return;

    // Optimistically add user message to list
    const tempUserMsg = {
      id: 'temp-' + Date.now(),
      role: 'user',
      content_json: JSON.stringify([{ type: 'text', text }]),
      created_at: new Date().toISOString(),
    };

    set({
      messages: [...get().messages, tempUserMsg],
      streamingAssistantText: '',
      turnStatus: 'running',
    });

    await ApiClient.sendMessage(active.id, text);
  },

  abortCurrentTurn: async () => {
    const active = get().activeSession;
    if (!active) return;
    await ApiClient.abortSession(active.id);
    set({ turnStatus: 'idle', activeTool: null, pendingPermission: null });
  },

  resolvePermission: async (decision, note) => {
    const pending = get().pendingPermission;
    if (!pending) return;

    await ApiClient.resolvePermission(pending.sessionId, pending.requestId, decision, note);
    set({ pendingPermission: null, turnStatus: 'running' });
  },

  clearActiveSession: () => {
    const prevClient = get().sseClient;
    if (prevClient) {
      prevClient.stop();
    }
    set({
      activeSession: null,
      messages: [],
      streamingAssistantText: '',
      activeTool: null,
      pendingPermission: null,
      sseClient: null,
    });
  },
}));
