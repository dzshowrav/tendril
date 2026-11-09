import { Hono } from 'hono';
import { DatabaseStore, VERSION } from '@tendril/core';
import { TendrilEnv } from '../types.js';
import { PairingManager } from '../pairing.js';
import { COOKIE_NAME } from '../security.js';

export function createAuthRoutes(options: {
  db: DatabaseStore;
  pairingManager: PairingManager;
  port: number;
}): Hono<TendrilEnv> {
  const router = new Hono<TendrilEnv>();
  const { db, pairingManager, port } = options;

  // GET /api/health
  router.get('/health', (c) => {
    const auth = c.get('auth');
    return c.json({
      ok: true,
      version: VERSION,
      authed: Boolean(auth),
    });
  });

  // POST /api/pair { code, label }
  router.post('/pair', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const code = String(body.code || '').trim();
      const label = String(body.label || 'Web Client').trim();
      const userAgent = c.req.header('user-agent');

      if (!code) {
        return c.json(
          { error: { code: 'invalid_code', message: 'Pairing code is required' } },
          400,
        );
      }

      const { token, client } = pairingManager.exchangeCode(code, label, userAgent);

      // Set tdl_session cookie (HttpOnly, SameSite=Strict, Path=/, 1 year max-age)
      c.header(
        'Set-Cookie',
        `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
      );

      return c.json({
        ok: true,
        client: {
          id: client.id,
          label: client.label,
        },
      });
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.startsWith('RATE_LIMIT:')) {
        return c.json(
          { error: { code: 'rate_limited', message: msg.replace('RATE_LIMIT: ', '') } },
          429,
        );
      }
      return c.json(
        { error: { code: 'invalid_code', message: msg.replace('INVALID_CODE: ', '') } },
        400,
      );
    }
  });

  // POST /api/pair/code (Bearer only)
  router.post('/pair/code', (c) => {
    const auth = c.get('auth');
    if (auth?.type !== 'bearer') {
      return c.json(
        {
          error: {
            code: 'unauthorized',
            message: 'Generating pairing codes requires Bearer cliToken authentication.',
          },
        },
        403,
      );
    }

    const { code, expiresAt } = pairingManager.createPairingCode();
    const url = `http://127.0.0.1:${port}/pair#code=${code}`;

    return c.json({
      code,
      expiresAt,
      url,
    });
  });

  // POST /api/logout (Cookie auth)
  router.post('/logout', (c) => {
    const auth = c.get('auth');
    if (auth?.clientId) {
      try {
        db.db
          .prepare('UPDATE web_clients SET revoked_at = ? WHERE id = ?')
          .run(new Date().toISOString(), auth.clientId);
      } catch {
        // ignore
      }
    }

    // Clear cookie
    c.header('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);

    return c.json({ ok: true });
  });

  return router;
}
