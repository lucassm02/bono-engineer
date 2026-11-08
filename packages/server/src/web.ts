/**
 * Serves the built dashboard (packages/web/dist) with SPA fallback, plus the pt-BR not-found /
 * error handling of the whole app (JSON for /api, index.html for client routes, a friendly page
 * when the dashboard was not built yet).
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import { AnalysisError } from '@gt7/core';
import { API_PREFIX, WS_PATH } from '@gt7/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import { analysisErrorStatus, HttpError, sendError } from './http.ts';

export function webDistAvailable(dir: string | null): dir is string {
  return !!dir && existsSync(join(dir, 'index.html'));
}

function isApi(path: string): boolean {
  return path === API_PREFIX || path.startsWith(`${API_PREFIX}/`) || path === WS_PATH;
}

const MISSING_DIST_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GT7 Race Engineer</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0d10;
    color: #e8eaed; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 560px; padding: 24px 16px; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  code { background: #1c2128; padding: 2px 6px; border-radius: 4px; font-size: 15px; }
  a { color: #7cc4ff; }
  li { margin: 6px 0; }
</style>
</head>
<body>
<main>
  <h1>O painel ainda não foi compilado</h1>
  <p>O servidor está funcionando, mas a pasta <code>packages/web/dist</code> não existe.</p>
  <ul>
    <li>Para usar: rode <code>npm run build</code> e depois <code>npm start</code> de novo.</li>
    <li>Para desenvolver: rode <code>npm run dev</code> e abra <code>http://localhost:5173</code>.</li>
  </ul>
  <p>A API já responde em <a href="/api/status">/api/status</a>.</p>
</main>
</body>
</html>`;

/**
 * Must run BEFORE the API plugin is registered: encapsulated child contexts capture the error /
 * not-found handlers of their parent at registration time.
 */
export async function registerWeb(app: FastifyInstance, webDist: string | null): Promise<void> {
  const hasDist = webDistAvailable(webDist);

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    if (isApi(path)) {
      return sendError(reply, 404, 'notFound', `Rota não encontrada: ${req.method} ${path}`);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(reply, 404, 'notFound', 'Recurso não encontrado.');
    }
    // Missing asset-like paths (with an extension) are real 404s; the rest are client routes.
    const last = path.split('/').pop() ?? '';
    if (last.includes('.')) {
      return reply.code(404).type('text/plain; charset=utf-8').send('Arquivo não encontrado.');
    }
    if (!hasDist) {
      return reply.code(200).type('text/html; charset=utf-8').send(MISSING_DIST_HTML);
    }
    reply.header('cache-control', 'no-cache');
    return reply.type('text/html; charset=utf-8').sendFile('index.html');
  });

  app.setErrorHandler((err: FastifyError | HttpError | AnalysisError, req, reply) => {
    if (err instanceof HttpError) return sendError(reply, err.status, err.code, err.message);
    if (err instanceof AnalysisError) {
      return sendError(reply, analysisErrorStatus(err.code), err.code, err.message);
    }
    const status = (err as FastifyError).statusCode ?? 500;
    const code = (err as FastifyError).code ?? 'serverError';
    if (code === 'FST_ERR_CTP_INVALID_JSON_BODY' || code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return sendError(reply, 400, 'invalidJson', 'JSON inválido no corpo da requisição.');
    }
    if (err instanceof SyntaxError || code.startsWith('FST_ERR_CTP_INVALID')) {
      return sendError(reply, 400, 'invalidJson', 'JSON inválido no corpo da requisição.');
    }
    if (status === 415) {
      return sendError(reply, 415, 'unsupportedMediaType', 'Envie o corpo como application/json.');
    }
    if (status === 413) {
      return sendError(reply, 413, 'payloadTooLarge', 'Corpo da requisição grande demais.');
    }
    if (status >= 400 && status < 500) {
      return sendError(reply, status, code, `Requisição inválida: ${err.message}`);
    }
    req.log.error(err);
    return sendError(reply, 500, 'serverError', `Erro interno do servidor: ${err.message}`);
  });

  if (hasDist) {
    await app.register(fastifyStatic, {
      root: webDist,
      prefix: '/',
      wildcard: true,
      index: ['index.html'],
      setHeaders(reply, path) {
        const p = path.replaceAll('\\', '/');
        if (p.includes('/assets/')) {
          reply.header('cache-control', 'public, max-age=31536000, immutable');
        } else {
          // index.html, sw.js, manifest: always revalidate so updates reach the phone.
          reply.header('cache-control', 'no-cache');
        }
      },
    });
  }
}
