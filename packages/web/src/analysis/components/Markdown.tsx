/** Renders the safe Markdown AST (lib/markdown.ts) as React elements — no innerHTML anywhere. */

import { type ReactNode, useMemo } from 'react';
import { type Block, type Inline, type ListItem, parseMarkdown } from '../lib/markdown.ts';
import '../../styles/markdown.css';

function renderInline(nodes: Inline[], key = 'i'): ReactNode[] {
  return nodes.map((n, k) => {
    const id = `${key}-${k}`;
    switch (n.t) {
      case 'text':
        return n.v;
      case 'br':
        return <br key={id} />;
      case 'code':
        return <code key={id}>{n.v}</code>;
      case 'strong':
        return <strong key={id}>{renderInline(n.c, id)}</strong>;
      case 'em':
        return <em key={id}>{renderInline(n.c, id)}</em>;
      case 'del':
        return <del key={id}>{renderInline(n.c, id)}</del>;
      case 'link': {
        const external = !n.href.startsWith('#');
        return (
          <a
            key={id}
            href={n.href}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          >
            {renderInline(n.c, id)}
          </a>
        );
      }
    }
    return null;
  });
}

function renderItems(items: ListItem[], key: string): ReactNode[] {
  return items.map((it, k) => {
    const id = `${key}-${k}`;
    return (
      <li key={id}>
        {renderInline(it.c, id)}
        {it.sub ? renderBlock(it.sub, `${id}s`) : null}
      </li>
    );
  });
}

function renderBlock(b: Block, key: string): ReactNode {
  switch (b.t) {
    case 'h': {
      const Tag = `h${Math.min(6, b.level + 1)}` as 'h2';
      return <Tag key={key}>{renderInline(b.c, key)}</Tag>;
    }
    case 'p':
      return <p key={key}>{renderInline(b.c, key)}</p>;
    case 'code':
      return (
        <pre key={key} data-lang={b.lang || undefined}>
          <code>{b.v}</code>
        </pre>
      );
    case 'ul':
      return <ul key={key}>{renderItems(b.items, key)}</ul>;
    case 'ol':
      return (
        <ol key={key} start={b.start !== 1 ? b.start : undefined}>
          {renderItems(b.items, key)}
        </ol>
      );
    case 'quote':
      return <blockquote key={key}>{b.c.map((x, k) => renderBlock(x, `${key}-${k}`))}</blockquote>;
    case 'hr':
      return <hr key={key} />;
    case 'table':
      return (
        <div className="md-table" key={key}>
          <table>
            <thead>
              <tr>
                {b.head.map((c, k) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static table cells
                  <th key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>
                    {renderInline(c, `${key}h${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static table rows
                <tr key={r}>
                  {row.map((c, k) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: static table cells
                    <td key={k} style={b.align[k] ? { textAlign: b.align[k]! } : undefined}>
                      {renderInline(c, `${key}r${r}c${k}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
  return null;
}

/** Markdown text → elements. Headings are shifted one level down (the page owns the h1). */
export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className={`md ${className}`}>{blocks.map((b, k) => renderBlock(b, `b${k}`))}</div>;
}
