/**
 * The two pages the window shows by itself (everything else is the dashboard served by the
 * embedded server): the opening screen and the friendly error page. Self-contained HTML
 * (no network, no script) loaded through a data: URL.
 */

import { BRAND_SIGNAL, BRAND_SURFACE, brandIconContents, PRODUCT_NAME } from '@gt7/shared';
import { ACTION_SCHEME } from './paths.ts';

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const BASE_CSS = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { display: grid; place-items: center; background: ${BRAND_SURFACE}; color: #e8eaed;
    font: 16px/1.5 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; overflow: hidden; }
  main { max-width: 560px; padding: 24px; text-align: center; }
  .logo { width: 96px; height: 96px; margin: 0 auto 20px; display: block;
    border: 1px solid #243642; border-radius: 21px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 10px; }
  p { margin: 8px 0; color: #b8bec6; }
  .brand { letter-spacing: .14em; text-transform: uppercase; font-size: 12px; color: ${BRAND_SIGNAL}; margin-top: 28px; }
`;

const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">${brandIconContents()}</svg>`;

export function splashHtml(): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${PRODUCT_NAME}</title>
<style>${BASE_CSS}
  .spin { width: 28px; height: 28px; margin: 18px auto 6px; border-radius: 50%;
    border: 3px solid #26303a; border-top-color: ${BRAND_SIGNAL}; animation: r .9s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style></head>
<body><main>
  ${LOGO}
  <h1>Iniciando…</h1>
  <div class="spin" role="status" aria-label="Iniciando"></div>
  <p>Preparando o servidor e o painel.</p>
  <div class="brand">${PRODUCT_NAME}</div>
</main></body></html>`;
}

export interface ErrorPageInput {
  /** What went wrong, one sentence, already in pt-BR. */
  message: string;
  /** Technical detail (shown small). */
  detail?: string;
  /** Where the log is, if any. */
  logFile?: string;
}

export function errorHtml(input: ErrorPageInput): string {
  const detail = input.detail ? `<pre>${escapeHtml(input.detail)}</pre>` : '';
  const log = input.logFile
    ? `<p class="small">Detalhes técnicos: <code>${escapeHtml(input.logFile)}</code></p>`
    : '';
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${PRODUCT_NAME}</title>
<style>${BASE_CSS}
  h1 { color: #ffb21e; }
  .actions { margin-top: 22px; display: flex; gap: 12px; justify-content: center; }
  a.btn { display: inline-block; padding: 10px 20px; border-radius: 8px; text-decoration: none;
    font-weight: 600; background: ${BRAND_SIGNAL}; color: ${BRAND_SURFACE}; }
  a.btn.secondary { background: #1c2128; color: #e8eaed; border: 1px solid #333c46; }
  a.btn:focus-visible { outline: 3px solid #7cc4ff; outline-offset: 2px; }
  pre { text-align: left; background: #12161b; border: 1px solid #26303a; border-radius: 8px;
    padding: 10px 12px; color: #c3c9d0; font: 12px/1.45 Consolas, monospace; white-space: pre-wrap;
    word-break: break-word; max-height: 140px; overflow: auto; }
  .small { font-size: 13px; color: #8a929b; }
  code { background: #1c2128; padding: 1px 5px; border-radius: 4px; }
</style></head>
<body><main>
  ${LOGO}
  <h1>Não foi possível abrir o ${PRODUCT_NAME}</h1>
  <p>${escapeHtml(input.message)}</p>
  ${detail}
  ${log}
  <div class="actions">
    <a class="btn" href="${ACTION_SCHEME}//retry" autofocus>Tentar de novo</a>
    <a class="btn secondary" href="${ACTION_SCHEME}//quit">Fechar o app</a>
  </div>
</main></body></html>`;
}

export function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
