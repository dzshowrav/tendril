import { Hono } from 'hono';
import { DatabaseStore, WorkspaceGuard, undoSnapshot } from '@tendril/core';
import { TendrilEnv } from '../types.js';

export function createChangesRoutes(options: {
  db: DatabaseStore;
}): Hono<TendrilEnv> {
  const router = new Hono<TendrilEnv>();
  const { db } = options;

  // GET /api/sessions/:id/changes
  router.get('/:id/changes', (c) => {
    const sessionId = c.req.param('id');
    const session = db.getSession(sessionId);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    const snapshots = db.listSnapshots(sessionId);
    return c.json({ changes: snapshots });
  });

  // GET /api/sessions/:id/changes/:toolRunId
  router.get('/:id/changes/:toolRunId', (c) => {
    const sessionId = c.req.param('id');
    const toolRunId = c.req.param('toolRunId');

    const session = db.getSession(sessionId);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    const snapshot = db.getSnapshotByToolRun(toolRunId);
    if (!snapshot) {
      return c.json({ error: { code: 'not_found', message: 'Change not found' } }, 404);
    }

    return c.json({ change: snapshot });
  });

  // POST /api/sessions/:id/changes/:toolRunId/undo { force? }
  router.post('/:id/changes/:toolRunId/undo', async (c) => {
    const sessionId = c.req.param('id');
    const toolRunId = c.req.param('toolRunId');
    const body = await c.req.json().catch(() => ({}));
    const force = Boolean(body.force);

    const session = db.getSession(sessionId);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    const snapshot = db.getSnapshotByToolRun(toolRunId);
    if (!snapshot) {
      return c.json({ error: { code: 'not_found', message: 'Change not found' } }, 404);
    }

    try {
      const workspace = new WorkspaceGuard(session.workspace_path);
      const result = undoSnapshot({
        sessionId,
        snapshotId: snapshot.id,
        workspace,
        db,
        force,
      });

      return c.json({ ok: true, result });
    } catch (err: any) {
      const message = err?.message || String(err);
      if (message.includes('--force')) {
        return c.json(
          {
            error: {
              code: 'conflict',
              message,
              needsForce: true,
            },
          },
          409,
        );
      }
      return c.json({ error: { code: 'undo_failed', message } }, 400);
    }
  });

  return router;
}
