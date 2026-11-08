/**
 * Small, safe Markdown parser for the coach reports: produces an AST that React renders as
 * elements (text is always a text node, so HTML in the input is shown literally — never injected).
 *
 * Supported: ATX headings, paragraphs, **bold**, *italic* or _italic_, `code`, ~~strike~~, links
 * (only http(s), mailto and in-app `#/` targets), fenced code blocks, bullet/ordered lists (nested
 * by indentation), GitHub tables (with alignment), blockquotes and horizontal rules. Anything else
 * stays plain text. Robust to partial input (streaming: an unclosed ``` fence is still a code block).
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'del'; c: Inline[] }
  | { t: 'code'; v: string }
  | { t: 'link'; href: string; c: Inline[] }
  | { t: 'br' };

export interface ListItem {
  c: Inline[];
  /** Nested list, if any. */
  sub?: Block;
}

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { t: 'h'; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'ul'; items: ListItem[] }
  | { t: 'ol'; start: number; items: ListItem[] }
  | { t: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: 'quote'; c: Block[] }
  | { t: 'hr' };

// ---------------------------------------------------------------------------------------------
// Inline
// ---------------------------------------------------------------------------------------------

const SAFE_URL = /^(https?:\/\/|mailto:|#\/)/i;

/** Only http(s), mailto and in-app hash links are kept (no javascript:, data:, etc.). */
export function safeHref(url: string): string | null {
  const u = url.trim();
  return SAFE_URL.test(u) ? u : null;
}

function pushText(out: Inline[], v: string): void {
  if (!v) return;
  const last = out[out.length - 1];
  if (last && last.t === 'text') last.v += v;
  else out.push({ t: 'text', v });
}

/** Finds the closing delimiter `d` starting at `from` (not escaped, non-empty content). */
function findClose(s: string, d: string, from: number): number {
  let i = from;
  while (i < s.length) {
    const j = s.indexOf(d, i);
    if (j < 0) return -1;
    if (j > from && s[j - 1] !== '\\') return j;
    i = j + 1;
  }
  return -1;
}

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let i = 0;
  let text = '';
  const flush = () => {
    pushText(out, text);
    text = '';
  };
  while (i < s.length) {
    const ch = s[i]!;
    // Escapes
    if (ch === '\\' && i + 1 < s.length && /[\\`*_~[\]()#|>-]/.test(s[i + 1]!)) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    // Code span
    if (ch === '`') {
      const j = s.indexOf('`', i + 1);
      if (j > i) {
        flush();
        out.push({ t: 'code', v: s.slice(i + 1, j) });
        i = j + 1;
        continue;
      }
    }
    // Bold ** / __
    if ((ch === '*' || ch === '_') && s[i + 1] === ch) {
      const d = ch + ch;
      const j = findClose(s, d, i + 2);
      if (j > i + 2) {
        flush();
        out.push({ t: 'strong', c: parseInline(s.slice(i + 2, j)) });
        i = j + 2;
        continue;
      }
    }
    // Strike ~~
    if (ch === '~' && s[i + 1] === '~') {
      const j = findClose(s, '~~', i + 2);
      if (j > i + 2) {
        flush();
        out.push({ t: 'del', c: parseInline(s.slice(i + 2, j)) });
        i = j + 2;
        continue;
      }
    }
    // Italic * / _ (not inside words for _, not followed by a space)
    if ((ch === '*' || ch === '_') && s[i + 1] !== ' ' && s[i + 1] !== undefined) {
      const prev = i > 0 ? s[i - 1]! : ' ';
      if (ch === '*' || !/[\p{L}\p{N}]/u.test(prev)) {
        const j = findClose(s, ch, i + 1);
        if (j > i + 1 && s[j - 1] !== ' ' && s[j + 1] !== ch) {
          flush();
          out.push({ t: 'em', c: parseInline(s.slice(i + 1, j)) });
          i = j + 1;
          continue;
        }
      }
    }
    // Link [text](url)
    if (ch === '[') {
      const close = s.indexOf('](', i + 1);
      if (close > i) {
        const end = s.indexOf(')', close + 2);
        if (end > close) {
          const label = s.slice(i + 1, close);
          const url = s.slice(close + 2, end);
          const safe = safeHref(url);
          flush();
          if (safe) out.push({ t: 'link', href: safe, c: parseInline(label) });
          else for (const n of parseInline(label)) out.push(n);
          i = end + 1;
          continue;
        }
      }
    }
    // Hard break: two spaces before newline / backslash newline
    if (ch === '\n') {
      if (text.endsWith('  ')) {
        text = text.replace(/ +$/, '');
        flush();
        out.push({ t: 'br' });
      } else {
        text += ' ';
      }
      i++;
      continue;
    }
    text += ch;
    i++;
  }
  flush();
  return out;
}

// ---------------------------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------------------------

const RE_HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_FENCE = /^ {0,3}(```+|~~~+)\s*([\w+-]*)/;
const RE_HR = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const RE_UL = /^(\s*)[-*+]\s+(.*)$/;
const RE_OL = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const RE_QUOTE = /^ {0,3}>\s?(.*)$/;

function indentOf(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 4;
    else break;
  }
  return n;
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

function isTableSep(line: string): Align[] | null {
  if (!line.includes('-') || !/^[\s|:-]+$/.test(line)) return null;
  const cells = splitRow(line);
  if (cells.length === 0 || cells.some((c) => !/^:?-+:?$/.test(c))) return null;
  return cells.map((c) =>
    c.startsWith(':') && c.endsWith(':')
      ? 'center'
      : c.endsWith(':')
        ? 'right'
        : c.startsWith(':')
          ? 'left'
          : null,
  );
}

function isBlockStart(line: string, next: string | undefined): boolean {
  return (
    RE_HEADING.test(line) ||
    RE_FENCE.test(line) ||
    RE_HR.test(line) ||
    RE_UL.test(line) ||
    RE_OL.test(line) ||
    RE_QUOTE.test(line) ||
    (line.includes('|') && next !== undefined && isTableSep(next) !== null)
  );
}

/** Parses a list starting at `i`; returns the block and the next line index. */
function parseList(lines: string[], i: number): { block: Block; next: number } {
  const first = lines[i]!;
  const ordered = !RE_UL.test(first) && RE_OL.test(first);
  const baseIndent = indentOf(first);
  const items: ListItem[] = [];
  let start = 1;
  if (ordered) start = Number(RE_OL.exec(first)?.[2] ?? 1);
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      // A blank line ends the list unless the next line continues it.
      const nxt = lines[i + 1];
      if (
        nxt !== undefined &&
        (RE_UL.test(nxt) || RE_OL.test(nxt)) &&
        indentOf(nxt) >= baseIndent
      ) {
        i++;
        continue;
      }
      break;
    }
    const ind = indentOf(line);
    const m = ordered ? RE_OL.exec(line) : RE_UL.exec(line);
    const other = ordered ? RE_UL.exec(line) : RE_OL.exec(line);
    if (ind > baseIndent && (m || other)) {
      // Nested list belongs to the last item.
      const sub = parseList(lines, i);
      const last = items[items.length - 1];
      if (last && !last.sub) last.sub = sub.block;
      else items.push({ c: [], sub: sub.block });
      i = sub.next;
      continue;
    }
    if (ind < baseIndent) break;
    if (m && ind === baseIndent) {
      const text = ordered ? m[3]! : m[2]!;
      items.push({ c: parseInline(text) });
      i++;
      continue;
    }
    if (other && ind === baseIndent) break;
    // Lazy continuation of the previous item.
    if (items.length && !isBlockStart(line, lines[i + 1])) {
      const last = items[items.length - 1]!;
      last.c.push({ t: 'text', v: ' ' }, ...parseInline(line.trim()));
      i++;
      continue;
    }
    break;
  }
  return { block: ordered ? { t: 'ol', start, items } : { t: 'ul', items }, next: i };
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = RE_FENCE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker)) {
        body.push(lines[i]!);
        i++;
      }
      i++; // closing fence (or end of input while streaming)
      blocks.push({ t: 'code', lang: fence[2] ?? '', v: body.join('\n') });
      continue;
    }
    const h = RE_HEADING.exec(line);
    if (h) {
      blocks.push({ t: 'h', level: h[1]!.length as 1, c: parseInline(h[2]!) });
      i++;
      continue;
    }
    if (RE_HR.test(line)) {
      blocks.push({ t: 'hr' });
      i++;
      continue;
    }
    const align = line.includes('|') && i + 1 < lines.length ? isTableSep(lines[i + 1]!) : null;
    if (align) {
      const head = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') {
        const cells = splitRow(lines[i]!);
        rows.push(head.map((_, k) => parseInline(cells[k] ?? '')));
        i++;
      }
      blocks.push({ t: 'table', align: head.map((_, k) => align[k] ?? null), head, rows });
      continue;
    }
    if (RE_QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && RE_QUOTE.test(lines[i]!)) {
        body.push(RE_QUOTE.exec(lines[i]!)![1]!);
        i++;
      }
      blocks.push({ t: 'quote', c: parseMarkdown(body.join('\n')) });
      continue;
    }
    if (RE_UL.test(line) || RE_OL.test(line)) {
      const { block, next } = parseList(lines, i);
      blocks.push(block);
      i = next;
      continue;
    }
    // Paragraph: until a blank line or another block.
    const para: string[] = [line];
    i++;
    while (i < lines.length && lines[i]!.trim() !== '' && !isBlockStart(lines[i]!, lines[i + 1])) {
      para.push(lines[i]!);
      i++;
    }
    blocks.push({ t: 'p', c: parseInline(para.map((l) => l.replace(/^\s+/, '')).join('\n')) });
  }
  return blocks;
}

/** Plain text of inline nodes (for titles / previews / tests). */
export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case 'text':
        case 'code':
          return n.v;
        case 'br':
          return '\n';
        default:
          return inlineText(n.c);
      }
    })
    .join('');
}
