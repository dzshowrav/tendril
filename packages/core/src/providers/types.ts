import type { MessageRole } from '../store.js';

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export type { MessageRole };

export interface Message {
  role: MessageRole;
  content: Block[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'aborted' | 'error';

export type ProviderEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_use_input_delta'; id: string; delta: string }
  | { type: 'tool_use_end'; id: string; name: string; input: unknown }
  | { type: 'usage'; inputTokens: number; outputTokens: number; cachedTokens?: number }
  | { type: 'stop'; reason: StopReason }
  | { type: 'error'; error: Error };

export interface ProviderStreamRequest {
  model: string;
  system: string;
  messages: Message[];
  tools?: ToolSpec[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export interface ProviderAdapter {
  stream(req: ProviderStreamRequest): AsyncIterable<ProviderEvent>;
}
