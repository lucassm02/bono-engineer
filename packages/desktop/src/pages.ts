/**
 * The two pages the window shows by itself (everything else is the dashboard served by the
 * embedded server): the opening screen and the friendly error page. Self-contained HTML
 * (no network, no script) loaded through a data: URL.
 */

import {
  BRAND_SIGNAL,
  BRAND_SURFACE,
  brandIconContents,
  type Language,
  PRODUCT_NAME,
} from '@gt7/shared';
import { translateMessage } from '../../web/src/lib/messages.ts';
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
  body { display: grid; place-items: center; background: ${BRAND_SURFACE}; color: #eef3f7;
    font: 16px/1.5 "Segoe UI", system-ui, -apple-system, Roboto, sans-serif; overflow: hidden; }
  .drag { position: fixed; top: 0; left: 0; right: 0; height: 36px; -webkit-app-region: drag; }
  main { max-width: 560px; padding: 24px; text-align: center; }
  .logo { width: 96px; height: 96px; margin: 0 auto 20px; display: block;
    border: 1px solid #223140; border-radius: 21px; }
  h1 { font-size: 22px; font-weight: 600; margin: 0 0 10px; }
  p { margin: 8px 0; color: #a9b7c4; }
  .brand { letter-spacing: .14em; text-transform: uppercase; font-size: 12px; color: ${BRAND_SIGNAL}; margin-top: 28px; }
`;

const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true">${brandIconContents()}</svg>`;

export function splashHtml(language: Language = 'pt-BR'): string {
  const text = (message: string) => escapeHtml(translateMessage(language, message));
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><title>${PRODUCT_NAME}</title>
<style>${BASE_CSS}
  .spin { width: 28px; height: 28px; margin: 18px auto 6px; border-radius: 50%;
    border: 3px solid #223140; border-top-color: ${BRAND_SIGNAL}; animation: r .9s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
</style></head>
<body><div class="drag"></div><main>
  ${LOGO}
  <h1>${text('Iniciando…')}</h1>
  <div class="spin" role="status" aria-label="${text('Iniciando')}"></div>
  <p>${text('Preparando o servidor e o painel.')}</p>
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

export function errorHtml(input: ErrorPageInput, language: Language = 'pt-BR'): string {
  const text = (message: string, ...values: string[]) =>
    escapeHtml(translateMessage(language, message, ...values));
  const detail = input.detail ? `<pre>${escapeHtml(input.detail)}</pre>` : '';
  const log = input.logFile
    ? `<p class="small">${text('Detalhes técnicos:')} <code>${escapeHtml(input.logFile)}</code></p>`
    : '';
  return `<!doctype html>
<html lang="${language}"><head><meta charset="utf-8"><title>${PRODUCT_NAME}</title>
<style>${BASE_CSS}
  h1 { color: #ff5160; }
  .actions { margin-top: 22px; display: flex; gap: 12px; justify-content: center; }
  a.btn { display: inline-block; padding: 10px 20px; border-radius: 8px; text-decoration: none;
    font-weight: 600; background: ${BRAND_SIGNAL}; color: ${BRAND_SURFACE}; }
  a.btn.secondary { background: #131c26; color: #eef3f7; border: 1px solid #324658; }
  a.btn:focus-visible { outline: 3px solid ; outline-offset: 2px; }
  pre { text-align: left; background: #0d141c; border: 1px solid #223140; border-radius: 8px;
    padding: 10px 12px; color: #a9b7c4; font: 12px/1.45 Consolas, monospace; white-space: pre-wrap;
    word-break: break-word; max-height: 140px; overflow: auto; }
  .small { font-size: 13px; color: #7b8b9a; }
  code { background: #131c26; padding: 1px 5px; border-radius: 4px; }
</style></head>
<body><div class="drag"></div><main>
  ${LOGO}
  <h1>${text('Não foi possível abrir o {0}', PRODUCT_NAME)}</h1>
  <p>${text(input.message)}</p>
  ${detail}
  ${log}
  <div class="actions">
    <a class="btn" href="${ACTION_SCHEME}//retry" autofocus>${text('Tentar de novo')}</a>
    <a class="btn secondary" href="${ACTION_SCHEME}//quit">${text('Fechar o app')}</a>
  </div>
</main></body></html>`;
}

export function toDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
