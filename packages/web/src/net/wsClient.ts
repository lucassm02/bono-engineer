/**
 * WebSocket client for the dashboard protocol (@gt7/shared ws.ts): hello on open, auto-reconnect
 * with exponential backoff + jitter, ping/pong keep-alive and a stale-connection watchdog.
 */

import type { ClientMessage, HelloMessage, ServerMessage } from '@gt7/shared';

export type WsClientStatus = 'connecting' | 'open' | 'closed';

export interface WsClientHandlers {
  onMessage(msg: ServerMessage): void;
  onStatus(status: WsClientStatus, info: { attempt: number; retryInMs: number | null }): void;
}

export const PING_INTERVAL_MS = 5000;
/** No message at all for this long → the socket is considered dead and recycled. */
export const STALE_AFTER_MS = 15000;

/** Backoff delay before reconnect attempt `attempt` (0-based): 0.5 s doubling up to 10 s, ±20 %. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(10_000, 500 * 2 ** Math.max(0, attempt));
  return Math.round(base * (0.8 + random() * 0.4));
}

/** Parses a server text frame; null when it is not a valid message object. */
export function parseServerMessage(data: unknown): ServerMessage | null {
  if (typeof data !== 'string') return null;
  try {
    const m = JSON.parse(data) as { type?: unknown };
    return m && typeof m === 'object' && typeof m.type === 'string' ? (m as ServerMessage) : null;
  } catch {
    return null;
  }
}

/** ws(s)://<host>/ws for the page that served the dashboard. */
export function wsUrlFor(loc: Pick<Location, 'protocol' | 'host'>, path: string): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${path}`;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private stopped = true;

  constructor(
    private readonly url: string,
    private readonly hello: () => HelloMessage,
    private readonly handlers: WsClientHandlers,
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  /** Reconnect immediately (user pressed "Tentar agora"). */
  retryNow(): void {
    if (this.stopped || this.ws) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.connect();
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  private connect(): void {
    this.handlers.onStatus('connecting', { attempt: this.attempt, retryInMs: null });
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.lastMessageAt = Date.now();
      ws.send(JSON.stringify(this.hello()));
      this.handlers.onStatus('open', { attempt: 0, retryInMs: null });
      this.pingTimer = setInterval(() => this.keepAlive(), PING_INTERVAL_MS);
    };
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      const msg = parseServerMessage(ev.data);
      if (msg) this.handlers.onMessage(msg);
    };
    ws.onerror = () => {
      // onclose follows and handles the retry.
    };
    ws.onclose = () => {
      this.ws = null;
      this.clearTimers();
      if (!this.stopped) this.scheduleRetry();
    };
  }

  private keepAlive(): void {
    if (!this.ws) return;
    if (Date.now() - this.lastMessageAt > STALE_AFTER_MS) {
      // A dead TCP link (phone left the Wi-Fi) may take minutes to fire onclose: drop the socket
      // now and reconnect, ignoring whatever the old one still reports.
      const dead = this.ws;
      this.ws = null;
      dead.onclose = null;
      dead.onmessage = null;
      dead.onerror = null;
      try {
        dead.close();
      } catch {
        // already closed
      }
      this.clearTimers();
      if (!this.stopped) this.scheduleRetry();
      return;
    }
    this.send({ type: 'ping', t: Date.now() });
  }

  private scheduleRetry(): void {
    const delay = backoffMs(this.attempt);
    this.attempt++;
    this.handlers.onStatus('closed', { attempt: this.attempt, retryInMs: delay });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
