import { MiddlewareHandler } from 'hono';
import { createHash } from 'node:crypto';
import { DatabaseStore, WebClientRow } from '@tendril/core';
import { TendrilEnv, AuthContext } from './types.js';

export const COOKIE_NAME = 'tdl_session';

export const CSP_HEADER_VALUE =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'";

/**
 * Host header guard: rejects requests with host other than 127.0.0.1 or localhost.
 */
export const hostGuard: MiddlewareHandler<TendrilEnv> = async (c, next) => {
  const host = c.req.header('host') || '';
  const [hostname] = host.split(':');

  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    return c.json(
      {
        error: {
          code: 'misdirected_request',
          message: `Invalid Host header '${host}'. Only 127.0.0.1 and localhost are permitted.`,
        },
      },
      421,
    );
  }

  await next();
};

/**
 * Origin header guard: rejects non-GET / SSE requests with foreign Origin headers.
 */
export const originGuard: MiddlewareHandler<TendrilEnv> = async (c, next) => {
  const origin = c.req.header('origin');

  if (origin) {
    try {
      const parsed = new URL(origin);
      if (parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
        return c.json(
          {
            error: {
              code: 'forbidden_origin',
              message: `Foreign origin '${origin}' is forbidden.`,
            },
          },
          403,
        );
      }
    } catch {
      return c.json(
        {
          error: {
            code: 'forbidden_origin',
            message: `Malformed Origin header '${origin}'.`,
          },
        },
        403,
      );
    }
  }

  await next();
};

/**
 * Applies security headers including strict Content-Security-Policy.
 */
export const securityHeaders: MiddlewareHandler<TendrilEnv> = async (c, next) => {
  await next();
  c.res.headers.set('Content-Security-Policy', CSP_HEADER_VALUE);
  c.res.headers.set('X-Content-Type-Options', 'nosniff');
  c.res.headers.set('X-Frame-Options', 'DENY');
};

/**
 * Parses cookies from Cookie header.
 */
export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [key, ...values] = pair.trim().split('=');
    if (key) {
      cookies[key.trim()] = decodeURIComponent(values.join('='));
    }
  }
  return cookies;
}

/**
 * Auth middleware: validates Bearer cliToken or tdl_session cookie for protected routes.
 */
export function createAuthMiddleware(cliToken: string, db: DatabaseStore): MiddlewareHandler<TendrilEnv> {
  return async (c, next) => {
    const path = c.req.path;

    // Public endpoints that do not require authentication
    if (path === '/api/health' || path === '/api/pair') {
      return await next();
    }

    // Only guard /api/* routes; non-API static assets are public
    if (!path.startsWith('/api/')) {
      return await next();
    }

    // 1. Check Bearer Authorization header
    const authHeader = c.req.header('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      if (token === cliToken) {
        c.set('auth', { type: 'bearer' });
        return await next();
      }
    }

    // 2. Check tdl_session cookie
    const cookies = parseCookies(c.req.header('cookie'));
    const sessionCookie = cookies[COOKIE_NAME];

    if (sessionCookie) {
      const tokenHash = createHash('sha256').update(sessionCookie).digest('hex');

      const clientStmt = db.db.prepare(
        'SELECT * FROM web_clients WHERE token_hash = ? AND revoked_at IS NULL',
      );
      const client = clientStmt.get(tokenHash) as unknown as WebClientRow | undefined;

      if (client) {
        // Update last seen
        try {
          db.db
            .prepare('UPDATE web_clients SET last_seen_at = ? WHERE id = ?')
            .run(new Date().toISOString(), client.id);
        } catch {
          // ignore
        }

        c.set('auth', {
          type: 'cookie',
          clientId: client.id,
          tokenHash: client.token_hash,
          label: client.label,
        });

        return await next();
      }
    }

    // Unauthorized
    return c.json(
      {
        error: {
          code: 'unauthorized',
          message: 'Authentication required. Provide valid Bearer token or paired session cookie.',
        },
      },
      401,
    );
  };
}
