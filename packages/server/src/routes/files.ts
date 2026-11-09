import { Hono } from 'hono';
import { readdirSync, statSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DatabaseStore, WorkspaceGuard, isBinaryFile } from '@tendril/core';
import { TendrilEnv } from '../types.js';

export function createFilesRoutes(options: {
  db: DatabaseStore;
}): Hono<TendrilEnv> {
  const router = new Hono<TendrilEnv>();
  const { db } = options;

  // GET /api/sessions/:id/files?path=
  router.get('/sessions/:id/files', (c) => {
    const sessionId = c.req.param('id');
    const relDirPath = c.req.query('path') || '.';

    const session = db.getSession(sessionId);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    try {
      const workspace = new WorkspaceGuard(session.workspace_path);
      const canonical = workspace.resolvePath(relDirPath);

      if (!existsSync(canonical) || !statSync(canonical).isDirectory()) {
        return c.json({ error: { code: 'not_found', message: 'Directory not found' } }, 404);
      }

      const entries = readdirSync(canonical, { withFileTypes: true });
      const dirs: Array<{ name: string; path: string }> = [];
      const files: Array<{ name: string; path: string; size: number }> = [];

      for (const entry of entries) {
        const entryPath = join(canonical, entry.name);
        const relPath = workspace.toRelative(entryPath);
        if (entry.isDirectory()) {
          dirs.push({ name: entry.name, path: relPath });
        } else {
          try {
            const s = statSync(entryPath);
            files.push({ name: entry.name, path: relPath, size: s.size });
          } catch {
            files.push({ name: entry.name, path: relPath, size: 0 });
          }
        }
      }

      dirs.sort((a, b) => a.name.localeCompare(b.name));
      files.sort((a, b) => a.name.localeCompare(b.name));

      return c.json({
        path: workspace.toRelative(canonical),
        dirs,
        files,
      });
    } catch (err: any) {
      return c.json({ error: { code: 'access_denied', message: err?.message || 'Access denied' } }, 403);
    }
  });

  // GET /api/sessions/:id/file?path= (read text file <= 1 MB)
  router.get('/sessions/:id/file', (c) => {
    const sessionId = c.req.param('id');
    const relFilePath = c.req.query('path');

    if (!relFilePath) {
      return c.json({ error: { code: 'invalid_path', message: 'File path query is required' } }, 400);
    }

    const session = db.getSession(sessionId);
    if (!session) {
      return c.json({ error: { code: 'not_found', message: 'Session not found' } }, 404);
    }

    try {
      const workspace = new WorkspaceGuard(session.workspace_path);
      const canonical = workspace.resolvePath(relFilePath);

      if (!existsSync(canonical) || statSync(canonical).isDirectory()) {
        return c.json({ error: { code: 'not_found', message: 'File not found' } }, 404);
      }

      const stat = statSync(canonical);
      const MAX_SIZE = 1024 * 1024; // 1 MB cap
      if (stat.size > MAX_SIZE) {
        return c.json(
          { error: { code: 'too_large', message: 'File exceeds 1 MB viewer limit' } },
          413,
        );
      }

      if (isBinaryFile(canonical)) {
        return c.json(
          { error: { code: 'binary_file', message: 'Binary files cannot be displayed' } },
          415,
        );
      }

      const content = readFileSync(canonical, 'utf8');
      return c.json({
        path: workspace.toRelative(canonical),
        size: stat.size,
        content,
      });
    } catch (err: any) {
      return c.json({ error: { code: 'access_denied', message: err?.message || 'Access denied' } }, 403);
    }
  });

  // GET /api/fs/dirs?path= (allowed roots: $HOME and ~/storage/shared)
  router.get('/fs/dirs', (c) => {
    const targetPath = c.req.query('path') || homedir();
    const resolvedTarget = resolve(targetPath);

    // Compute allowed roots
    const allowedRoots: string[] = [realpathSync(homedir())];
    const sharedStorage = join(homedir(), 'storage', 'shared');
    if (existsSync(sharedStorage)) {
      try {
        allowedRoots.push(realpathSync(sharedStorage));
      } catch {
        // ignore
      }
    }

    let isAllowed = false;
    try {
      const canonicalTarget = realpathSync(resolvedTarget);
      for (const root of allowedRoots) {
        if (canonicalTarget === root || canonicalTarget.startsWith(root + '/')) {
          isAllowed = true;
          break;
        }
      }
    } catch {
      return c.json({ error: { code: 'not_found', message: 'Directory does not exist' } }, 404);
    }

    if (!isAllowed) {
      return c.json(
        {
          error: {
            code: 'forbidden_path',
            message: 'Directory browsing is limited to $HOME and ~/storage/shared',
          },
        },
        403,
      );
    }

    try {
      const entries = readdirSync(resolvedTarget, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => ({
          name: e.name,
          path: join(resolvedTarget, e.name),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return c.json({
        current: resolvedTarget,
        dirs,
      });
    } catch (err: any) {
      return c.json({ error: { code: 'cannot_read_dir', message: err?.message } }, 500);
    }
  });

  return router;
}
