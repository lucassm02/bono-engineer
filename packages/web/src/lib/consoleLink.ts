/**
 * Console link ("Conexão com o PS5"): pure helpers that turn the server's `ConsoleConnection` into
 * the text and colour the UI shows, validate a typed IP and fabricate a simulated connection for
 * the in-browser demo (`?mock=1`).
 */

import type { ConsoleConnection, ConsoleIpSource, ConsoleLinkState } from '@gt7/shared';

/** Visual tone of the link: drives the dot colour. */
export type LinkTone = 'ok' | 'busy' | 'info' | 'warn' | 'bad';

export interface LinkView {
  tone: LinkTone;
  /** Full sentence for the details panel / onboarding. */
  title: string;
  /** Short label for the discreet indicator. */
  short: string;
  /** Second line (what to do next, or progress). */
  detail: string | null;
  /** Show an animation (the app is working on it). */
  busy: boolean;
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "N endereços testados" (singular aware). */
export function hostsProbedText(n: number): string {
  return `${plural(n, 'endereço testado', 'endereços testados')}`;
}

/** What to show for a given connection. `null` = the server has not told us yet. */
export function describeLink(c: ConsoleConnection | null): LinkView {
  if (!c) {
    return {
      tone: 'warn',
      title: 'Sem informação do console',
      short: 'Sem informação',
      detail: 'O servidor ainda não informou o estado da conexão com o PS5.',
      busy: false,
    };
  }
  switch (c.state) {
    case 'idle':
      return {
        tone: 'bad',
        title: 'Telemetria parada',
        short: 'Telemetria parada',
        detail:
          c.hint ??
          'O app não está ouvindo o console. Feche outros programas de telemetria (SimHub, GT7 Dashboard) e reinicie o app.',
        busy: false,
      };
    case 'searching':
      return {
        tone: 'busy',
        title: 'Procurando o PS5 na rede…',
        short: 'Procurando o PS5…',
        detail:
          c.hostsProbed > 0
            ? `${hostsProbedText(c.hostsProbed)} até agora. Abra o Gran Turismo 7 no PS5 e entre numa pista.`
            : 'Abra o Gran Turismo 7 no PS5 e entre numa pista.',
        busy: true,
      };
    case 'found':
      return {
        tone: 'info',
        title: c.consoleIp
          ? `Console encontrado (${c.consoleIp}) — abra o Gran Turismo 7 e entre numa pista`
          : 'Console encontrado — abra o Gran Turismo 7 e entre numa pista',
        short: 'PS5 encontrado',
        detail: 'Não é erro: o PS5 só envia dados com o jogo aberto numa pista (ou replay).',
        busy: true,
      };
    case 'receiving':
      return {
        tone: 'ok',
        title: 'Recebendo telemetria',
        short: 'Recebendo telemetria',
        detail: null,
        busy: false,
      };
    case 'lost':
      return {
        tone: 'warn',
        title: 'Sinal perdido — reconectando…',
        short: 'Sinal perdido',
        detail:
          c.hint ??
          'O PS5 parou de enviar dados. Se o jogo está aberto, confira se o console continua na mesma rede.',
        busy: true,
      };
  }
}

export const IP_SOURCE_LABELS: Record<ConsoleIpSource, string> = {
  discovered: 'encontrado automaticamente',
  manual: 'fixado por você',
  simulator: 'console simulado (demonstração)',
};

export function ipSourceLabel(source: ConsoleIpSource | null): string {
  return source ? IP_SOURCE_LABELS[source] : 'ainda não encontrado';
}

/** True when the console is known (found at least once in this run, or saved). */
export function isLinkFound(state: ConsoleLinkState | null | undefined): boolean {
  return state === 'found' || state === 'receiving' || state === 'lost';
}

/** Strict dotted-quad IPv4: four decimals 0–255 without leading zeros, not 0.0.0.0 / broadcast. */
export function isValidIpv4(input: string): boolean {
  const s = input.trim();
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return false;
  const parts = m.slice(1, 5);
  for (const p of parts) {
    if (p.length > 1 && p.startsWith('0')) return false;
    if (Number(p) > 255) return false;
  }
  return s !== '0.0.0.0' && s !== '255.255.255.255';
}

/** "agora", "há 12 s", "há 3 min"… for a past epoch ms; "nunca" without a timestamp. */
export function agoText(at: number | null | undefined, now = Date.now()): string {
  if (!at) return 'nunca';
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return 'agora';
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

// ---------------------------------------------------------------------------------------------
// Demo (?mock=1)
// ---------------------------------------------------------------------------------------------

export const MOCK_LINK_STATES: readonly ConsoleLinkState[] = [
  'idle',
  'searching',
  'found',
  'receiving',
  'lost',
];

/**
 * `?mockConn=` value → a state to freeze on, or `'cycle'` (searching → found → receiving → lost,
 * 6 s each) so every state can be seen without a console. Anything else: receiving.
 */
export function parseMockConn(value: string | null): ConsoleLinkState | 'cycle' {
  if (value === 'cycle') return 'cycle';
  const found = MOCK_LINK_STATES.find((s) => s === value);
  return found ?? 'receiving';
}

const CYCLE: readonly ConsoleLinkState[] = ['searching', 'found', 'receiving', 'lost'];
export const MOCK_CYCLE_STEP_MS = 6000;

/** Simulated connection `elapsedMs` after the demo started. */
export function mockConsoleConnection(
  mode: ConsoleLinkState | 'cycle',
  elapsedMs: number,
  now = Date.now(),
): ConsoleConnection {
  const state =
    mode === 'cycle' ? CYCLE[Math.floor(elapsedMs / MOCK_CYCLE_STEP_MS) % CYCLE.length]! : mode;
  const known = state !== 'searching' && state !== 'idle';
  const inStep = mode === 'cycle' ? elapsedMs % MOCK_CYCLE_STEP_MS : elapsedMs;
  return {
    state,
    consoleIp: known ? '192.168.0.42' : null,
    source: known ? 'simulator' : null,
    subnets: ['192.168.0.0/24'],
    hostsProbed: state === 'searching' ? Math.min(253, Math.floor(inStep / 20)) : 253,
    lastScanAt: now - 4000,
    lastPacketAt: state === 'receiving' ? now : state === 'lost' ? now - 8000 : null,
    hint:
      state === 'searching'
        ? 'Procurando o PlayStation na rede. Abra o Gran Turismo 7 no PS5 e entre numa pista.'
        : state === 'found'
          ? 'Console encontrado. Abra o Gran Turismo 7 e entre numa pista.'
          : state === 'lost'
            ? 'O PS5 parou de enviar dados.'
            : state === 'idle'
              ? 'A porta de telemetria está ocupada por outro programa.'
              : null,
  };
}
