import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  DatabaseStore,
  WorkspaceGuard,
  ReadTracker,
  ToolRegistry,
  ProviderAdapter,
  Agent,
  SessionMode,
  createId,
  runCompaction,
} from '@tendril/core';
import { TendrilEnv } from '../types.js';
import { SSEHub, SSEClientConnection } from '../sse-hub.js';
import { PermissionEngine } from '@tendril/core';

export function createSessionRoutes(options: {
  db: DatabaseStore;
  sseHub: SSEHub;
  permissionEngine: PermissionEngine;
  toolRegistry: ToolRegistry;
  providerAdapter: ProviderAdapter;
}): Hono<TendrilEnv> {
  const router = new Hono<TendrilEnv>();
  const { db, sseHub, permissionEngine, toolRegistry, providerAdapter } = options;

  // Active turn abort controllers (sessionId -> AbortController)
  const activeControllers = new Map<string, AbortController>();
  const readTracker = new ReadTracker();

  // GET /api/sessions?workspace=&cursor=
  router.get('/', (c) => {
    const workspace = c.req.query('workspace');
    const cursor = c.req.query('cursor');

    let query = 'SELECT * FROM sessions';
    const params: (string | number | bigint | null | Uint8Array)[] = [];

    if (workspace) {
      query += ' WHERE workspace_path = ?';
      params.push(workspace);
    }

    query += ' ORDER BY created_at DESC LIMIT 50';

    const sessions = db.db.prepare(query).all(...params);
    return c.json({
      sessions,
      nextCursor: null,
    });
  });

  // POST /api/sessions { workspace, provider?, model?, mode?, title? }
  router.post('/', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const workspace = String(body.workspace || '').trim();
    if (!workspace) {
      return c.json(
        { error: { code: 'invalid_workspace', message: 'Workspace path is required' } },
        400,
      );
    }

    try {
      // Validate workspace directory
      new WorkspaceGuard(workspace);
    } catch (err: any) {
      return c.json(
        { error: { code: 'invalid_workspace', message: err?.message || 'Invalid workspace path' } },
        400,
      );
    }

    const session = db.createSession({
      id: createId(),
      title: body.title || 'New Session',
      workspace_path: workspace,
      provider_id: body.provider || 'anthropic',
      model: body.model || 'claude-3-7-sonnet',
      mode: (body.mode as SessionMode) || 'ask',
    });

    return c.json({ session }, 201);
  });

  // GET /api/sessions/:id
  router.get('/:id', (c) => {
    const id = c.req.param('id');
    const session = db.getSession(id);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    const messages = db.listMessages(id);
    const pendingPermissions = permissionEngine.registry.listPending(id);

    return c.json({
      session,
      messages,
      pendingPermissions,
    });
  });

  // PATCH /api/sessions/:id { title?, mode?, provider?, model? }
  router.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const session = db.getSession(id);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    const body = await c.req.json().catch(() => ({}));
    const updates: Record<string, unknown> = {};

    if (body.title !== undefined) updates.title = String(body.title);
    if (body.mode !== undefined) updates.mode = body.mode;
    if (body.provider !== undefined) updates.provider_id = body.provider;
    if (body.model !== undefined) updates.model = body.model;

    const updated = db.updateSession(id, updates);

    // Emit session.updated event on SSE
    sseHub.publish(id, 'session.updated', {
      title: updated?.title,
      mode: updated?.mode,
      model: updated?.model,
      provider: updated?.provider_id,
    });

    return c.json({ session: updated });
  });

  // DELETE /api/sessions/:id
  router.delete('/:id', (c) => {
    const id = c.req.param('id');
    const session = db.getSession(id);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    // Abort active turn if any
    const controller = activeControllers.get(id);
    if (controller) {
      controller.abort();
      activeControllers.delete(id);
    }

    db.deleteSession(id);
    return c.json({ ok: true });
  });

  // POST /api/sessions/:id/messages { text }
  router.post('/:id/messages', async (c) => {
    const id = c.req.param('id');
    const session = db.getSession(id);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    if (activeControllers.has(id) || session.status === 'running') {
      return c.json(
        { error: { code: 'session_busy', message: 'Session is currently running a turn' } },
        409,
      );
    }

    // Synchronously reserve turn mutex before any async parsing to prevent race conditions
    const controller = new AbortController();
    activeControllers.set(id, controller);

    const body = await c.req.json().catch(() => ({}));
    const text = String(body.text || '').trim();
    if (!text) {
      activeControllers.delete(id);
      return c.json({ error: { code: 'invalid_message', message: 'Message text is required' } }, 400);
    }

    const auth = c.get('auth');
    const origin = auth?.type === 'cookie' ? 'web' : 'cli';

    let workspaceGuard: WorkspaceGuard;
    try {
      workspaceGuard = new WorkspaceGuard(session.workspace_path);
    } catch (err: any) {
      return c.json(
        {
          error: {
            code: 'workspace_not_found',
            message: err?.message || `Workspace root does not exist: ${session.workspace_path}`,
          },
        },
        400,
      );
    }

    const agent = new Agent({
      db,
      provider: providerAdapter,
      toolRegistry,
      permissionEngine,
      readTracker,
      workspaceGuard,
      eventSink: (event) => {
        sseHub.publish(id, event.type, event.data);
      },
    });

    // Run agent turn asynchronously (202 Accepted)
    (async () => {
      try {
        await agent.runTurn({
          sessionId: id,
          userPrompt: text,
          origin,
          signal: controller.signal,
        });
      } catch (err: any) {
        sseHub.publish(id, 'error', {
          code: 'agent_error',
          message: err?.message || String(err),
          retryable: false,
        });
      } finally {
        activeControllers.delete(id);
      }
    })();

    return c.json({ ok: true, status: 'started' }, 202);
  });

  // POST /api/sessions/:id/abort
  router.post('/:id/abort', async (c) => {
    const id = c.req.param('id');
    const controller = activeControllers.get(id);
    if (controller) {
      controller.abort();
      activeControllers.delete(id);
    }

    await permissionEngine.registry.abortSessionRequests(id);
    db.updateSession(id, { status: 'idle' });
    sseHub.publish(id, 'session.status', { status: 'idle' });

    return c.json({ ok: true });
  });

  // POST /api/sessions/:id/compact
  router.post('/:id/compact', async (c) => {
    const id = c.req.param('id');
    const session = db.getSession(id);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    sseHub.publish(id, 'compaction', { status: 'started' });

    try {
      const result = await runCompaction({
        sessionId: id,
        provider: providerAdapter,
        model: session.model,
        db,
      });

      if (result) {
        sseHub.publish(id, 'compaction', {
          status: 'done',
          droppedMessages: result.droppedMessages,
        });
        return c.json({
          ok: true,
          summary: result.summary,
          summaryUptoSeq: result.summaryUptoSeq,
          droppedMessages: result.droppedMessages,
        });
      }

      sseHub.publish(id, 'compaction', { status: 'done', droppedMessages: 0 });
      return c.json({ ok: true, message: 'Nothing to compact' });
    } catch (err: any) {
      sseHub.publish(id, 'compaction', { status: 'failed' });
      return c.json({ error: { code: 'compaction_failed', message: err?.message || 'Compaction failed' } }, 500);
    }
  });

  // POST /api/sessions/:id/permissions/:requestId { decision, note? }
  router.post('/:id/permissions/:requestId', async (c) => {
    const id = c.req.param('id');
    const requestId = c.req.param('requestId');
    const body = await c.req.json().catch(() => ({}));
    const decision = body.decision;
    const note = body.note ? String(body.note) : undefined;

    if (decision !== 'allow_once' && decision !== 'allow_always' && decision !== 'deny') {
      return c.json(
        {
          error: {
            code: 'invalid_decision',
            message: "Decision must be one of 'allow_once', 'allow_always', or 'deny'",
          },
        },
        400,
      );
    }

    const auth = c.get('auth');
    const decidedBy = auth?.type === 'cookie' ? 'web' : 'cli';

    const res = await permissionEngine.registry.resolveRequest({
      requestId,
      decision,
      decidedBy,
      note,
    });

    if (res.status === 'already_resolved') {
      return c.json(
        {
          error: {
            code: 'already_resolved',
            message: 'Permission request has already been answered.',
          },
        },
        409,
      );
    }

    return c.json({ ok: true, decision: res.decision });
  });

  // GET /api/sessions/:id/events (SSE Stream)
  router.get('/:id/events', async (c) => {
    const id = c.req.param('id');
    const session = db.getSession(id);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    const lastEventId = c.req.header('last-event-id') || c.req.query('lastEventId');
    const auth = c.get('auth');

    return streamSSE(c, async (stream) => {
      const client: SSEClientConnection = {
        id: createId(),
        sessionId: id,
        tokenHash: auth?.tokenHash,
        send: (seq, type, data) => {
          stream.writeSSE({
            id: String(seq),
            event: type,
            data: JSON.stringify(data),
          });
        },
        close: () => {
          try {
            stream.close();
          } catch {
            // ignore
          }
        },
      };

      sseHub.subscribe(id, client, lastEventId);

      stream.onAbort(() => {
        sseHub.unsubscribe(id, client);
      });

      // Keep stream alive until closed/aborted
      while (!stream.aborted) {
        await stream.sleep(1000);
      }
    });
  });

  return router;
}
