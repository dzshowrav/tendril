import { Hono } from 'hono';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import {
  DatabaseStore,
  ToolRegistry,
  ProviderAdapter,
  PermissionEngine,
  readFileTool,
  listDirTool,
  globTool,
  grepTool,
  todoWriteTool,
  writeFileTool,
  editFileTool,
  bashTool,
  webFetchTool,
} from '@tendril/core';
import { TendrilEnv, ServerOptions } from './types.js';
import {
  hostGuard,
  originGuard,
  securityHeaders,
  createAuthMiddleware,
  CSP_HEADER_VALUE,
} from './security.js';
import { PairingManager } from './pairing.js';
import { SSEHub } from './sse-hub.js';
import { createAuthRoutes } from './routes/auth.js';
import { createSessionRoutes } from './routes/sessions.js';
import { createChangesRoutes } from './routes/changes.js';
import { createFilesRoutes } from './routes/files.js';
import { createSettingsRoutes } from './routes/settings.js';

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(listDirTool);
  registry.register(globTool);
  registry.register(grepTool);
  registry.register(todoWriteTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(bashTool);
  registry.register(webFetchTool);
  return registry;
}

export function createServerApp(options: ServerOptions): {
  app: Hono<TendrilEnv>;
  sseHub: SSEHub;
  pairingManager: PairingManager;
  permissionEngine: PermissionEngine;
} {
  const {
    db,
    cliToken,
    port = 7421,
    configPath,
    authPath,
    staticDir,
    providerAdapter,
    toolRegistry = createDefaultToolRegistry(),
  } = options;

  const app = new Hono<TendrilEnv>();
  const sseHub = new SSEHub(db);
  const pairingManager = new PairingManager(db);
  const permissionEngine = new PermissionEngine(db);

  // Fallback dummy provider if none passed
  const activeProvider: ProviderAdapter =
    providerAdapter || {
      stream: async function* () {
        yield { type: 'text_delta', text: 'Tendril Daemon Active.' };
        yield { type: 'stop', reason: 'end_turn' };
      },
    };

  // 1. Security & Guards Middleware
  app.use('*', hostGuard);
  app.use('*', originGuard);
  app.use('*', securityHeaders);
  app.use('*', createAuthMiddleware(cliToken, db));

  // 2. Mount API Routes
  const authRoutes = createAuthRoutes({ db, pairingManager, port });
  const sessionRoutes = createSessionRoutes({
    db,
    sseHub,
    permissionEngine,
    toolRegistry,
    providerAdapter: activeProvider,
  });
  const changesRoutes = createChangesRoutes({ db });
  const filesRoutes = createFilesRoutes({ db });
  const settingsRoutes = createSettingsRoutes({ db, configPath, authPath });

  app.route('/api', authRoutes);
  app.route('/api/sessions', sessionRoutes);
  app.route('/api/sessions', changesRoutes);
  app.route('/api', filesRoutes);
  app.route('/api', settingsRoutes);

  // 3. Static Files & SPA Fallback for non-API routes
  app.get('*', (c) => {
    const path = c.req.path;
    if (path.startsWith('/api')) {
      return c.json({ error: { code: 'not_found', message: 'API route not found' } }, 404);
    }

    if (staticDir && existsSync(staticDir)) {
      const target = path === '/' ? 'index.html' : path.slice(1);
      const filePath = join(staticDir, target);

      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const ext = extname(filePath);
        const contentType = getMimeType(ext);
        const buffer = readFileSync(filePath);

        c.res.headers.set('Content-Type', contentType);
        c.res.headers.set('Content-Security-Policy', CSP_HEADER_VALUE);
        return c.body(buffer);
      }

      // SPA fallback to index.html
      const indexPath = join(staticDir, 'index.html');
      if (existsSync(indexPath)) {
        const indexHtml = readFileSync(indexPath, 'utf8');
        c.res.headers.set('Content-Type', 'text/html; charset=utf-8');
        c.res.headers.set('Content-Security-Policy', CSP_HEADER_VALUE);
        return c.html(indexHtml);
      }
    }

    // Default basic web page if staticDir not yet built
    c.res.headers.set('Content-Security-Policy', CSP_HEADER_VALUE);
    return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Tendril</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body style="font-family: sans-serif; padding: 2rem;">
  <h1>Tendril Daemon</h1>
  <p>The daemon is running on port ${port}.</p>
</body>
</html>`);
  });

  return {
    app,
    sseHub,
    pairingManager,
    permissionEngine,
  };
}

function getMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}
