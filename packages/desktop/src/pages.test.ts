import { describe, expect, it } from 'vitest';
import { errorHtml, escapeHtml, splashHtml, toDataUrl } from './pages.ts';

describe('pages', () => {
  it('the splash is pt-BR, self-contained and has no script', () => {
    const html = splashHtml();
    expect(html).toContain('Iniciando…');
    expect(html).toContain('lang="pt-BR"');
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('the error page explains, offers retry/quit and escapes everything it shows', () => {
    const html = errorHtml({
      message: 'A porta <b>8770</b> está em uso',
      detail: '<img src=x onerror=alert(1)>',
      logFile: 'C:\\Users\\a & b\\desktop.log',
    });
    expect(html).toContain('Tentar de novo');
    expect(html).toContain('bono-app://retry');
    expect(html).toContain('bono-app://quit');
    expect(html).not.toContain('<b>8770</b>');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('a &amp; b');
    expect(html).not.toMatch(/<script/i);
  });

  it('escapeHtml covers the five special characters', () => {
    expect(escapeHtml('<a href="x">\'&\'</a>')).toBe(
      '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;',
    );
  });

  it('toDataUrl round-trips accents', () => {
    const url = toDataUrl('<p>não</p>');
    expect(url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(url.split(',')[1] ?? '')).toBe('<p>não</p>');
  });
});
