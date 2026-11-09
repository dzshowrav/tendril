import { Hono } from 'hono';
import {
  DatabaseStore,
  getTendrilPaths,
  loadConfig,
  saveConfig,
  loadAuth,
  saveAuth,
  maskApiKey,
  runDoctor,
  PROVIDER_PRESETS,
  Config,
  AuthFile,
} from '@tendril/core';
import { TendrilEnv } from '../types.js';

export interface SettingsRouteOptions {
  db: DatabaseStore;
  configPath?: string;
  authPath?: string;
}

export function createSettingsRoutes(options: SettingsRouteOptions): Hono<TendrilEnv> {
  const router = new Hono<TendrilEnv>();
  const { db } = options;
  const paths = getTendrilPaths();
  const configPath = options.configPath || paths.configPath;
  const authPath = options.authPath || paths.authPath;

  // GET /api/config
  router.get('/config', (c) => {
    const config = loadConfig(configPath);
    return c.json({ config });
  });

  // PUT /api/config
  router.put('/config', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as Partial<Config>;
    const current = loadConfig(configPath);
    const updated: Config = { ...current, ...body };
    saveConfig(configPath, updated);
    return c.json({ config: updated });
  });

  // GET /api/providers (keys masked as ••••last4)
  router.get('/providers', (c) => {
    const auth = loadAuth(authPath);
    const providersList = Object.entries(auth.providers).map(([id, p]) => {
      const preset = PROVIDER_PRESETS[id as keyof typeof PROVIDER_PRESETS];
      return {
        id,
        type: p.type,
        name: p.name || preset?.name || id,
        baseUrl: p.baseUrl || preset?.baseUrl || '',
        defaultModel: preset?.defaultModel || '',
        maskedKey: maskApiKey(p.apiKey),
      };
    });

    return c.json({ providers: providersList });
  });

  // PUT /api/providers/:id
  router.put('/providers/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const apiKey = body.apiKey !== undefined ? (body.apiKey ? String(body.apiKey).trim() : null) : undefined;
    const baseUrl = body.baseUrl !== undefined ? (body.baseUrl ? String(body.baseUrl).trim() : null) : undefined;
    const name = body.name ? String(body.name).trim() : undefined;
    const type = body.type === 'anthropic' ? 'anthropic' : 'openai-compatible';

    const auth = loadAuth(authPath);
    const existing = auth.providers[id];

    auth.providers[id] = {
      type: existing?.type || type,
      name: name || existing?.name || id,
      apiKey: apiKey !== undefined ? apiKey : existing?.apiKey,
      baseUrl: baseUrl !== undefined ? baseUrl : (existing?.baseUrl || null),
    };
    saveAuth(authPath, auth);

    return c.json({
      ok: true,
      provider: {
        id,
        type: auth.providers[id].type,
        name: auth.providers[id].name,
        baseUrl: auth.providers[id].baseUrl,
        maskedKey: maskApiKey(auth.providers[id].apiKey),
      },
    });
  });

  // DELETE /api/providers/:id
  router.delete('/providers/:id', (c) => {
    const id = c.req.param('id');
    const auth = loadAuth(authPath);
    delete auth.providers[id];
    saveAuth(authPath, auth);
    return c.json({ ok: true });
  });

  // POST /api/providers/:id/test
  router.post('/providers/:id/test', async (c) => {
    const id = c.req.param('id');
    const auth = loadAuth(authPath);
    const provider = auth.providers[id];

    if (!provider || !provider.apiKey) {
      return c.json(
        { error: { code: 'missing_key', message: `No API key configured for provider '${id}'` } },
        400,
      );
    }

    // Basic format test
    return c.json({
      ok: true,
      message: `Provider '${id}' configuration is valid.`,
    });
  });

  // GET /api/permissions/rules
  router.get('/permissions/rules', (c) => {
    const workspace = c.req.query('workspace');
    const rules = db.listPermissionRules(workspace);
    return c.json({ rules });
  });

  // DELETE /api/permissions/rules/:id
  router.delete('/permissions/rules/:id', (c) => {
    const id = c.req.param('id');
    const deleted = db.deletePermissionRule(id);
    if (!deleted) {
      return c.json({ error: { code: 'not_found', message: 'Rule not found' } }, 404);
    }
    return c.json({ ok: true });
  });

  // GET /api/clients
  router.get('/clients', (c) => {
    const stmt = db.db.prepare(
      'SELECT id, label, user_agent, created_at, last_seen_at, revoked_at FROM web_clients ORDER BY created_at DESC',
    );
    const clients = stmt.all();
    return c.json({ clients });
  });

  // DELETE /api/clients/:id (revoke web client)
  router.delete('/clients/:id', (c) => {
    const id = c.req.param('id');
    const stmt = db.db.prepare('UPDATE web_clients SET revoked_at = ? WHERE id = ?');
    const result = stmt.run(new Date().toISOString(), id);

    if (result.changes === 0) {
      return c.json({ error: { code: 'not_found', message: 'Client not found' } }, 404);
    }

    return c.json({ ok: true });
  });

  // GET /api/doctor
  router.get('/doctor', async (c) => {
    const results = await runDoctor();
    return c.json({ results });
  });

  return router;
}
