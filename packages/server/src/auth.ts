/**
 * Optional access token (LAN-only app: off by default). When set, /api/* and the WebSocket require
 * it via `?token=`, `x-gt7-token`, `Authorization: Bearer` or the `gt7_token` cookie. Opening any
 * page with a valid `?token=` sets the cookie, so the dashboard (which knows nothing about tokens)
 * keeps working on that browser.
 */

import { timingSafeEqual } from 'node:crypto';
import { API_PREFIX, WS_PATH } from '@gt7/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sendError } from './http.ts';

export const TOKEN_COOKIE = 'gt7_token';
export const TOKEN_HEADER = 'x-gt7-token';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function queryToken(req: FastifyRequest): string | null {
  const q = req.query as Record<string, unknown> | undefined;
  const t = q?.token;
  return typeof t === 'string' && t ? t : null;
}

export function tokenFromRequest(req: FastifyRequest): string | null {
  const h = req.headers[TOKEN_HEADER];
  if (typeof h === 'string' && h) return h;
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return queryToken(req) ?? parseCookies(req.headers.cookie)[TOKEN_COOKIE] ?? null;
}

export function tokensEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function isProtected(path: string): boolean {
  return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`) || path === WS_PATH;
}

export function registerAuth(app: FastifyInstance, token: string | null): void {
  if (!token) return;
  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    if (isProtected(path)) {
      const t = tokenFromRequest(req);
      if (!t || !tokensEqual(t, token)) {
        return sendError(
          reply,
          401,
          'unauthorized',
          'Token de acesso ausente ou inválido. Abra o painel pelo endereço com ?token=… mostrado no PC.',
        );
      }
      return;
    }
    const q = queryToken(req);
    if (q && tokensEqual(q, token)) {
      reply.header(
        'set-cookie',
        `${TOKEN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`,
      );
    }
  });
}
