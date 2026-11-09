import { Message, Block, ToolSpec, ProviderAdapter } from '../providers/types.js';
import { DatabaseStore, MessageRow, SessionRow } from '../store.js';

export const DEFAULT_CONTEXT_WINDOW = 128000;
export const AUTO_COMPACT_RATIO = 0.8; // 80%
export const MAX_RECENT_TOOL_RESULTS = 8;
export const PRESERVE_RECENT_MESSAGES_COUNT = 6;

/**
 * Estimates token count from string using characters / 4 formula.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Estimates total tokens in a block.
 */
export function estimateBlockTokens(block: Block): number {
  switch (block.type) {
    case 'text':
      return estimateTokens(block.text);
    case 'tool_use':
      return estimateTokens(block.name) + estimateTokens(JSON.stringify(block.input));
    case 'tool_result':
      return estimateTokens(block.content);
    default:
      return 0;
  }
}

/**
 * Estimates total tokens across a list of normalized messages.
 */
export function estimateMessagesTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    for (const block of msg.content) {
      total += estimateBlockTokens(block);
    }
  }
  return total;
}

/**
 * Replaces tool results older than the last 8 tool runs with a compact placeholder in model context.
 * Does not mutate original messages.
 */
export function replaceOldToolResults(messages: Message[]): Message[] {
  // Collect all tool_result locations: [msgIndex, blockIndex]
  const toolResultLocations: Array<{ msgIndex: number; blockIndex: number; toolUseId: string }> = [];

  for (let m = 0; m < messages.length; m++) {
    const msg = messages[m];
    for (let b = 0; b < msg.content.length; b++) {
      const block = msg.content[b];
      if (block.type === 'tool_result') {
        toolResultLocations.push({ msgIndex: m, blockIndex: b, toolUseId: block.toolUseId });
      }
    }
  }

  const totalToolResults = toolResultLocations.length;
  if (totalToolResults <= MAX_RECENT_TOOL_RESULTS) {
    return messages;
  }

  const oldLimit = totalToolResults - MAX_RECENT_TOOL_RESULTS;
  const oldLocationsSet = new Set<string>();
  for (let i = 0; i < oldLimit; i++) {
    const loc = toolResultLocations[i];
    oldLocationsSet.add(`${loc.msgIndex}:${loc.blockIndex}`);
  }

  // Clone and replace old tool results
  return messages.map((msg, m) => {
    const hasOldResult = msg.content.some((_, b) => oldLocationsSet.has(`${m}:${b}`));
    if (!hasOldResult) return msg;

    const newContent: Block[] = msg.content.map((block, b) => {
      if (block.type === 'tool_result' && oldLocationsSet.has(`${m}:${b}`)) {
        const preview = block.content.slice(0, 40).replace(/\n/g, ' ');
        return {
          type: 'tool_result',
          toolUseId: block.toolUseId,
          content: `[old result omitted: ${preview}...]`,
          isError: block.isError,
        };
      }
      return block;
    });

    return {
      role: msg.role,
      content: newContent,
    };
  });
}

/**
 * Deserializes message rows from SQLite database into normalized Message objects.
 */
export function rowsToMessages(rows: MessageRow[]): Message[] {
  return rows.map((r) => {
    try {
      const parsedContent = JSON.parse(r.content_json);
      return {
        role: r.role,
        content: Array.isArray(parsedContent) ? parsedContent : [{ type: 'text', text: String(parsedContent) }],
      };
    } catch {
      return {
        role: r.role,
        content: [{ type: 'text', text: r.content_json }],
      };
    }
  });
}

/**
 * Prepares the list of messages to feed into the model, taking into account:
 * 1. Saved session compaction summary (omits messages up to summary_upto_seq)
 * 2. Old tool result placeholders
 */
export function prepareContextMessages(options: {
  session: SessionRow;
  db: DatabaseStore;
}): { messages: Message[]; totalTokens: number } {
  const { session, db } = options;
  const allRows = db.listMessages(session.id);

  let activeRows = allRows;
  let summaryPrefix: Message[] = [];

  if (session.summary && session.summary_upto_seq) {
    activeRows = allRows.filter((r) => r.seq > (session.summary_upto_seq || 0));

    summaryPrefix = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `[Previous conversation summary up to turn #${session.summary_upto_seq}:\n${session.summary}]`,
          },
        ],
      },
      {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Understood. I will continue the conversation based on this previous summary and the latest context.',
          },
        ],
      },
    ];
  }

  const normalized = rowsToMessages(activeRows);
  const withSummary = [...summaryPrefix, ...normalized];
  const withOldResultsReplaced = replaceOldToolResults(withSummary);
  const totalTokens = estimateMessagesTokens(withOldResultsReplaced);

  return {
    messages: withOldResultsReplaced,
    totalTokens,
  };
}

export interface CompactionResult {
  summary: string;
  summaryUptoSeq: number;
  droppedMessages: number;
}

/**
 * Runs compaction on a session:
 * Summarizes messages older than the last 6 messages using the provider model.
 */
export async function runCompaction(options: {
  sessionId: string;
  provider: ProviderAdapter;
  model: string;
  db: DatabaseStore;
  signal?: AbortSignal;
}): Promise<CompactionResult | null> {
  const { sessionId, provider, model, db, signal } = options;
  const session = db.getSession(sessionId);
  if (!session) return null;

  const allRows = db.listMessages(sessionId);
  if (allRows.length <= PRESERVE_RECENT_MESSAGES_COUNT) {
    return null; // Not enough messages to compact
  }

  const rowsToSummarize = allRows.slice(0, allRows.length - PRESERVE_RECENT_MESSAGES_COUNT);
  const lastSeq = rowsToSummarize[rowsToSummarize.length - 1].seq;

  const messagesToSummarize = rowsToMessages(rowsToSummarize);
  const conversationText = messagesToSummarize
    .map((m) => {
      const text = m.content
        .map((b) => (b.type === 'text' ? b.text : b.type === 'tool_use' ? `[Tool: ${b.name}]` : `[Result]`))
        .join(' ');
      return `${m.role.toUpperCase()}: ${text}`;
    })
    .join('\n\n');

  const summarizationPrompt: Message[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `You are an expert summarizer for an AI coding assistant.
Summarize the following conversation history concisely, capturing all key user requirements, decisions made, files created or edited, tools executed, and current status.
Keep the summary factual, dense, and under 500 words.

Conversation history:
${conversationText}`,
        },
      ],
    },
  ];

  let summary = '';
  const stream = provider.stream({
    model,
    system: 'You are a concise, factual technical summarizer.',
    messages: summarizationPrompt,
    tools: [],
    maxOutputTokens: 1024,
    signal: signal || new AbortController().signal,
  });

  for await (const event of stream) {
    if (event.type === 'text_delta') {
      summary += event.text;
    }
  }

  summary = summary.trim();

  // Save summary to session in database
  db.updateSession(sessionId, {
    summary,
    summary_upto_seq: lastSeq,
  });

  return {
    summary,
    summaryUptoSeq: lastSeq,
    droppedMessages: rowsToSummarize.length,
  };
}
