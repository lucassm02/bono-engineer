/**
 * Server-Sent Events over a POST response (EventSource only does GET): an incremental parser fed
 * with text chunks + a reader for `fetch` responses. Follows the HTML spec's line rules: `\n`,
 * `\r\n` or `\r` end a line, `event:`/`data:`/`id:` fields (one optional space after the colon),
 * multiple `data:` lines joined with `\n`, `:` comments ignored, a blank line dispatches.
 */

export interface SseMessage {
  /** `event:` field (default "message"). */
  event: string;
  /** Raw data (multi-line data joined with `\n`). */
  data: string;
  id: string | null;
}

export interface SseParser {
  /** Feeds a decoded text chunk (may split lines/events anywhere). */
  push(chunk: string): void;
  /** Flushes a final event not followed by a blank line. */
  end(): void;
}

export function createSseParser(onMessage: (m: SseMessage) => void): SseParser {
  let buf = '';
  let event = '';
  let data: string[] = [];
  let hasData = false;
  let id: string | null = null;
  /** Previous chunk ended with `\r`: a leading `\n` belongs to the same line break. */
  let pendingCr = false;

  const dispatch = () => {
    if (hasData) onMessage({ event: event || 'message', data: data.join('\n'), id });
    event = '';
    data = [];
    hasData = false;
  };

  const line = (l: string) => {
    if (l === '') {
      dispatch();
      return;
    }
    if (l.startsWith(':')) return;
    const c = l.indexOf(':');
    const field = c < 0 ? l : l.slice(0, c);
    let value = c < 0 ? '' : l.slice(c + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') {
      data.push(value);
      hasData = true;
    } else if (field === 'id') id = value;
    // `retry` and unknown fields are ignored.
  };

  return {
    push(chunk: string) {
      if (pendingCr && chunk.startsWith('\n')) chunk = chunk.slice(1);
      pendingCr = false;
      buf += chunk;
      let start = 0;
      for (let i = 0; i < buf.length; i++) {
        const ch = buf[i];
        if (ch !== '\n' && ch !== '\r') continue;
        line(buf.slice(start, i));
        if (ch === '\r') {
          if (i + 1 < buf.length) {
            if (buf[i + 1] === '\n') i++;
          } else {
            pendingCr = true;
          }
        }
        start = i + 1;
      }
      buf = buf.slice(start);
    },
    end() {
      if (buf) line(buf);
      buf = '';
      dispatch();
    },
  };
}

/** Parses `data` as JSON; returns null when it is not valid JSON. */
export function parseSseJson<T = unknown>(m: SseMessage): T | null {
  try {
    return JSON.parse(m.data) as T;
  } catch {
    return null;
  }
}

/** Reads a streaming `fetch` response body as SSE until it ends (or the signal aborts). */
export async function readSse(
  res: Response,
  onMessage: (m: SseMessage) => void,
  signal?: AbortSignal,
): Promise<void> {
  const body = res.body;
  const parser = createSseParser(onMessage);
  if (!body) {
    parser.push(await res.text());
    parser.end();
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock?.();
  }
}
