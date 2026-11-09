import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DatabaseStore,
  Agent,
  WorkspaceGuard,
  ReadTracker,
  PermissionEngine,
  TendrilEvent,
  ProviderAdapter,
  ProviderEvent,
  isTermuxApiAvailable,
} from '@tendril/core';
import { createDefaultToolRegistry } from '../src/app.js';

describe('server termux_api integration', () => {
  let tmpHome: string;
  let tmpWorkspace: string;
  let store: DatabaseStore;

  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), 'tendril-termux-test-home-'));
    tmpWorkspace = mkdtempSync(join(tmpdir(), 'tendril-termux-test-ws-'));
    store = new DatabaseStore(join(tmpHome, 'tendril.db'));
  });

  afterEach(() => {
    store.close();
    rmSync(tmpHome, { recursive: true, force: true });
    rmSync(tmpWorkspace, { recursive: true, force: true });
  });

  it('omits termux_api from registry when unavailable', () => {
    const originalEnv = process.env.TENDRIL_MOCK_TERMUX_API;
    try {
      process.env.TENDRIL_MOCK_TERMUX_API = 'false';
      expect(isTermuxApiAvailable()).toBe(false);

      const registry = createDefaultToolRegistry();
      expect(registry.get('termux_api')).toBeUndefined();
    } finally {
      process.env.TENDRIL_MOCK_TERMUX_API = originalEnv;
    }
  });

  it('includes termux_api in registry when available', () => {
    const originalEnv = process.env.TENDRIL_MOCK_TERMUX_API;
    try {
      process.env.TENDRIL_MOCK_TERMUX_API = 'true';
      expect(isTermuxApiAvailable()).toBe(true);

      const registry = createDefaultToolRegistry();
      expect(registry.get('termux_api')).toBeDefined();
    } finally {
      process.env.TENDRIL_MOCK_TERMUX_API = originalEnv;
    }
  });

  it('prompts user for permission when model calls termux_api battery-status and returns JSON upon approval', async () => {
    const originalEnv = process.env.TENDRIL_MOCK_TERMUX_API;
    try {
      process.env.TENDRIL_MOCK_TERMUX_API = 'true';

      const registry = createDefaultToolRegistry();
      const permissionEngine = new PermissionEngine(store);
      const workspaceGuard = new WorkspaceGuard(tmpWorkspace);
      const readTracker = new ReadTracker();

      // Create session in 'ask' mode
      const session = store.createSession({
        title: 'Test Termux',
        workspace_path: tmpWorkspace,
        provider_id: 'mock-provider',
        model: 'mock-model',
        mode: 'ask',
      });

      let step = 0;
      const fakeProvider: ProviderAdapter = {
        async *stream(_req) {
          if (step === 0) {
            step++;
            yield { type: 'tool_use_start', id: 'call_battery_1', name: 'termux_api' };
            yield {
              type: 'tool_use_end',
              id: 'call_battery_1',
              name: 'termux_api',
              input: { command: 'battery-status' },
            };
            yield { type: 'stop', reason: 'tool_use' };
          } else {
            yield { type: 'text_delta', text: 'Battery level is 88%.' };
            yield { type: 'stop', reason: 'end_turn' };
          }
        },
      };

      const emittedEvents: TendrilEvent[] = [];
      const agent = new Agent({
        db: store,
        provider: fakeProvider,
        toolRegistry: registry,
        permissionEngine,
        readTracker,
        workspaceGuard,
        eventSink: (event) => {
          emittedEvents.push(event);

          if (event.type === 'tool.permission') {
            setTimeout(() => {
              permissionEngine.registry.resolveRequest({
                requestId: event.data.requestId,
                decision: 'allow_once',
                decidedBy: 'cli',
              });
            }, 10);
          }
        },
      });

      const result = await agent.runTurn({
        sessionId: session.id,
        userPrompt: 'Check battery status',
      });

      expect(result.finalResponse).toBe('Battery level is 88%.');

      // Verify tool.start and tool.end events were emitted
      const toolStartEvent = emittedEvents.find((e) => e.type === 'tool.start');
      expect(toolStartEvent).toBeDefined();
      expect(toolStartEvent?.data.name).toBe('termux_api');
      expect(toolStartEvent?.data.input.command).toBe('battery-status');

      const toolEndEvent = emittedEvents.find((e) => e.type === 'tool.end');
      expect(toolEndEvent).toBeDefined();
      expect(toolEndEvent?.data.status).toBe('ok');
      expect(toolEndEvent?.data.resultPreview).toContain('"percentage": 88');
      expect(toolEndEvent?.data.resultPreview).toContain('"health": "GOOD"');
    } finally {
      process.env.TENDRIL_MOCK_TERMUX_API = originalEnv;
    }
  });
});
