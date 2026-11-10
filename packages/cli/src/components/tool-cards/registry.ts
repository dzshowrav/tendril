import { BashCard } from './bash-card.js';
import { FallbackCard } from './fallback-card.js';
import { FileCard } from './file-card.js';
import { McpCard } from './mcp-card.js';
import { SearchCard } from './search-card.js';
import { SubAgentCard } from './subagent-card.js';
import { ToolCardRenderer } from './types.js';

/**
 * Dedicated Tool Card Registry.
 * Follows Kiro CLI Terminal UI specification (new-ins.md § 6.1).
 */
export class ToolCardRegistry {
  private cards: Map<string, ToolCardRenderer> = new Map();
  private fallbackCard: ToolCardRenderer = new FallbackCard();

  constructor() {
    this.registerDefaults();
  }

  public register(toolName: string, card: ToolCardRenderer): void {
    this.cards.set(toolName.toLowerCase(), card);
  }

  public get(toolName: string): ToolCardRenderer {
    const clean = (toolName || '').toLowerCase();

    // Check exact match
    if (this.cards.has(clean)) {
      return this.cards.get(clean)!;
    }

    // Check MCP prefix
    if (clean.startsWith('mcp:') || clean.startsWith('mcp_')) {
      return this.cards.get('mcp') || this.fallbackCard;
    }

    // Check subagent prefix
    if (clean.startsWith('subagent:') || clean.startsWith('agent:')) {
      return this.cards.get('subagent') || this.fallbackCard;
    }

    return this.fallbackCard;
  }

  private registerDefaults(): void {
    const bash = new BashCard();
    this.register('bash', bash);
    this.register('sh', bash);
    this.register('shell', bash);

    const file = new FileCard();
    this.register('read_file', file);
    this.register('write_file', file);
    this.register('edit_file', file);

    const search = new SearchCard();
    this.register('grep', search);
    this.register('glob', search);
    this.register('list_dir', search);

    const mcp = new McpCard();
    this.register('mcp', mcp);

    const subagent = new SubAgentCard();
    this.register('subagent', subagent);
  }
}
