import {
  Message,
  Block,
  ProviderAdapter,
  ToolSpec,
} from '../providers/types.js';
import {
  SessionMode,
  SessionStatus,
  ToolClass,
  ToolDecision,
  MessageRole,
} from '../store.js';
import { DecidedBy } from '../permissions/types.js';

// ==========================================
// Tendril Event Types (SSE protocol events)
// ==========================================

export type TendrilEvent =
  | {
      type: 'session.status';
      sessionId: string;
      data: { status: SessionStatus };
    }
  | {
      type: 'session.updated';
      sessionId: string;
      data: {
        title?: string;
        mode?: SessionMode;
        model?: string;
        provider?: string;
        usage?: {
          inputTokens: number;
          outputTokens: number;
          contextTokens: number;
          contextWindow: number;
        };
      };
    }
  | {
      type: 'message.created';
      sessionId: string;
      data: {
        message: {
          id: string;
          sessionId: string;
          seq: number;
          role: MessageRole;
          content: Block[];
          stopReason?: string | null;
        };
      };
    }
  | {
      type: 'text.delta';
      sessionId: string;
      data: {
        messageId: string;
        text: string;
      };
    }
  | {
      type: 'tool.start';
      sessionId: string;
      data: {
        toolRunId: string;
        messageId: string;
        name: string;
        tool?: string;
        input: Record<string, unknown>;
        summary: string;
      };
    }
  | {
      type: 'tool.output';
      sessionId: string;
      data: {
        toolRunId: string;
        chunk: string;
        stream: 'stdout' | 'stderr';
      };
    }
  | {
      type: 'tool.permission';
      sessionId: string;
      data: {
        requestId: string;
        toolRunId: string;
        name: string;
        tool?: string;
        summary: string;
        input: Record<string, unknown>;
        options: {
          canAllowAlways: boolean;
          disallowAlwaysReason?: string;
          normalizedPattern: string | null;
        };
      };
    }
  | {
      type: 'permission.resolved';
      sessionId: string;
      data: {
        requestId: string;
        decision: ToolDecision;
        by: DecidedBy;
      };
    }
  | {
      type: 'tool.end';
      sessionId: string;
      data: {
        toolRunId: string;
        name?: string;
        tool?: string;
        status: 'ok' | 'error' | 'denied';
        success?: boolean;
        resultPreview: string;
        summary?: string;
        changeId?: string;
        exitCode?: number | null;
        durationMs?: number;
      };
    }
  | {
      type: 'usage';
      sessionId: string;
      data: {
        inputTokens: number;
        outputTokens: number;
        contextTokens: number;
        contextWindow: number;
      };
    }
  | {
      type: 'compaction';
      sessionId: string;
      data: {
        status: 'started' | 'done' | 'failed';
        droppedMessages?: number;
      };
    }
  | {
      type: 'error';
      sessionId: string;
      data: {
        code: string;
        message: string;
        retryable: boolean;
      };
    };

export type EventSink = (event: TendrilEvent) => void;

export interface AgentRunTurnOptions {
  sessionId: string;
  userPrompt: string;
  origin?: 'cli' | 'web';
  signal?: AbortSignal;
}
