/**
 * Specs 05 and 06: what the engine knows about the track while driving.
 * - "Pista de hoje" (`setTrackHint`): the session opens with the chosen track, the first closed lap
 *   validates it, a wrong choice moves the session without losing laps, the hint expires.
 * - Learning guide of a new track, invalid recognition laps, "Curvas prontas".
 * - Early guess from the start line against the shipped catalogue (never stored).
 * Driven by synthetic packets and an explicit clock, like session-lifecycle.test.ts.
 */

import { generateLaps } from '@gt7/protocol';
import {
  getTrackLayout,
  type Lap,
  type LiveFrame,
  layoutStartHeading,
  listTrackLayouts,
  type TelemetryPacket,
  type TrackHint,
  type TrackMismatchInfo,
} from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { sequentialIds } from '../util/ids.ts';
import { MemoryEngineContext } from './context.ts';
import { type CompletedLap, LiveEngine } from './live-engine.ts';

const FRAME_MS = 1000 / 60;
const MIN = 60_000;

function rig() {
  const ctx = new MemoryEngineContext({ idFactory: sequentialIds('t') });
  const engine = new LiveEngine({ context: ctx, idFactory: sequentialIds('s') });
  const r = {
    engine,
    ctx,
    laps: [] as CompletedLap[],
    mismatches: [] as TrackMismatchInfo[],
    hints: [] as (TrackHint | null)[],
    frames: [] as LiveFrame[],
    t: 1_700_000_000_000,
    feed(p: TelemetryPacket, dtMs = FRAME_MS) {
      r.t += dtMs;
      engine.push(p, r.t);
    },
    feedAll(ps: TelemetryPacket[]) {
      for (const p of ps) r.feed(p);
    },
  };
  engine.on('lapCompleted', (l) => r.laps.push(l));
  engine.on('trackMismatch', (m) => r.mismatches.push(m));
  engine.on('hintChanged', (h) => r.hints.push(h));
  engine.on('frame', (f) => r.frames.push(f));
  return r;
}
type Rig = ReturnType<typeof rig>;

function drive(laps: number, seed: number, firstPacketId: number) {
  return generateLaps({
    profile: 'pro',
    seed,
    laps,
    format: 'A',
    outLapM: 300,
    firstPacketId,
  });
}
const lastId = (ps: TelemetryPacket[]) => ps[ps.length - 1]!.packetId;

/** The same laps on another circuit (different shape, length and start line). */
const onOtherTrack = (p: TelemetryPacket): TelemetryPacket => ({
  ...p,
  position: { x: p.position.x * 1.6 + 2500, y: p.position.y, z: p.position.z * 1.6 - 800 },
});

const lapsOf = (r: Rig, sessionId: string): Lap[] =>
  [...r.ctx.laps.values()].map((s) => s.lap).filter((l) => l.sessionId === sessionId);

/** Drives circuit A, then circuit B (two laps each, one session each) and returns their ids. */
function twoKnownTracks(r: Rig) {
  const a = drive(2, 61, 1000);
  r.feedAll(a.packets);
  const trackA = r.engine.track!.id;
  r.engine.endSession();
  const b = drive(2, 62, lastId(a.packets) + 400);
  r.feedAll(b.packets.map(onOtherTrack));
  const trackB = r.engine.track!.id;
  r.engine.endSession();
  return { trackA, trackB, nextId: lastId(b.packets) + 400 };
}

describe('Pista de hoje: a dica é aplicada ao abrir a sessão (spec 06)', () => {
  it('a sessão nasce com a pista, "provável", e o engenheiro trabalha desde a volta 1', () => {
    const r = rig();
    const first = drive(2, 61, 1000);
    r.feedAll(first.packets);
    const trackA = r.engine.track!.id;
    r.engine.endSession();
    expect(r.ctx.getTrackRecords).toBeDefined();

    const hint = r.engine.setTrackHint(trackA, { now: r.t });
    expect(hint).toMatchObject({ trackId: trackA, source: 'user' });
    // no menu, antes da sessão, o contexto já mostra a pista escolhida
    expect(r.engine.trackContext).toMatchObject({
      trackId: trackA,
      confidence: 'probable',
      basis: 'hint',
    });

    r.frames.length = 0;
    const second = drive(2, 62, lastId(first.packets) + 400);
    r.feedAll(second.packets.slice(0, 5));
    const session = r.engine.session!;
    expect(session.trackId).toBe(trackA);
    expect(r.ctx.sessions.get(session.id)?.trackId).toBe(trackA);
    expect(r.engine.trackInfo).toMatchObject({ id: trackA, confidence: 'probable' });
    expect(r.engine.trackContext).toMatchObject({ basis: 'hint', confidence: 'probable' });
    // a linha central já está carregada: nenhuma volta de reconhecimento
    expect(r.engine.trackContext.learning).toBeNull();

    r.feedAll(second.packets.slice(5));
    // a primeira volta fechada confirma a dica e nada muda
    expect(r.mismatches).toHaveLength(0);
    expect(r.engine.session?.trackId).toBe(trackA);
    expect(r.engine.trackInfo).toMatchObject({ id: trackA, confidence: 'confirmed' });
    expect(r.engine.trackContext.basis).toBe('lap');
    expect(r.ctx.tracks.size).toBe(1);

    // durante a volta 1 o engenheiro já saiu de "aguardando a pista"
    const lap1 = r.frames.filter((f) => f.state === 'onTrack' && f.lap.lap === 1 && f.engineer);
    const statuses = new Set(lap1.map((f) => f.engineer!.status));
    expect(statuses.has('waitingTrack')).toBe(false);
    expect([...statuses].some((s) => s === 'ready' || s === 'noCues')).toBe(true);
  });

  it('sem dica, o comportamento é o de sempre: reconhece só pela geometria/largada', () => {
    const r = rig();
    const first = drive(2, 61, 1000);
    r.feedAll(first.packets);
    const trackA = r.engine.track!.id;
    r.engine.endSession();
    r.frames.length = 0;
    const second = drive(2, 62, lastId(first.packets) + 400);
    r.feedAll(second.packets.slice(0, 5));
    expect(r.engine.session?.trackId).toBeNull();
    expect(r.engine.trackInfo).toBeNull();
    r.feedAll(second.packets.slice(5));
    expect(r.engine.session?.trackId).toBe(trackA);
    const lap1 = r.frames.filter((f) => f.state === 'onTrack' && f.lap.lap === 1 && f.engineer);
    // pista salva, reconhecida pela linha de largada: ainda "reconhecendo" na volta 1
    expect(new Set(lap1.map((f) => f.engineer!.status)).has('waitingTrack')).toBe(true);
    expect(r.mismatches).toHaveLength(0);
  });

  it('o quadro carrega o contexto da pista (nome, confiança, curvas)', () => {
    const r = rig();
    r.feedAll(drive(2, 61, 1000).packets);
    const f = r.engine.snapshot()!;
    expect(f.trackContext).toMatchObject({
      confidence: 'confirmed',
      basis: 'lap',
      trackSource: 'auto',
      needsName: true,
    });
    expect(f.trackContext?.name).toMatch(/^Pista desconhecida/);
  });

  it('um "Reconhecer sozinho" no meio da sessão esquece a pista escolhida', () => {
    const r = rig();
    const first = drive(2, 61, 1000);
    r.feedAll(first.packets);
    const trackA = r.engine.track!.id;
    r.engine.endSession();
    r.engine.setTrackHint(trackA, { now: r.t });
    const second = drive(2, 62, lastId(first.packets) + 400);
    r.feedAll(second.packets.slice(0, 5));
    expect(r.engine.session?.trackId).toBe(trackA);
    r.engine.setTrackHint(null);
    expect(r.engine.session?.trackId).toBeNull();
    expect(r.engine.trackInfo).toBeNull();
    expect(r.engine.trackHint).toBeNull();
    expect(r.hints.at(-1)).toBeNull();
  });

  it('numa sessão com pista confirmada a dica só vale para a próxima', () => {
    const r = rig();
    const { trackA, trackB, nextId } = twoKnownTracks(r);
    const run = drive(2, 63, nextId);
    r.feedAll(run.packets.slice(0, 5));
    r.feedAll(run.packets.slice(5));
    const sessionTrack = r.engine.session!.trackId;
    expect([trackA, trackB]).toContain(sessionTrack);
    r.engine.setTrackHint(sessionTrack === trackA ? trackB : trackA, { now: r.t });
    expect(r.engine.session?.trackId).toBe(sessionTrack);
    expect(r.engine.trackInfo?.confidence).toBe('confirmed');
  });

  it('não vale em replay', () => {
    const r = rig();
    const first = drive(2, 61, 1000);
    r.feedAll(first.packets);
    const trackA = r.engine.track!.id;
    r.engine.endSession();
    r.engine.setReplayMode(true);
    r.engine.setTrackHint(trackA, { now: r.t });
    r.feedAll(drive(1, 62, lastId(first.packets) + 400).packets.slice(0, 5));
    expect(r.engine.session?.mode).toBe('replayCapture');
    expect(r.engine.session?.trackId).toBeNull();
    expect(r.engine.trackInfo).toBeNull();
  });

  it('recusa uma pista que não existe', () => {
    const r = rig();
    expect(() => r.engine.setTrackHint('naoexiste')).toThrow(/não encontrada/);
    expect(r.engine.trackHint).toBeNull();
  });
});

describe('Pista de hoje: a dica expira (spec 06)', () => {
  function withHint() {
    const r = rig();
    const first = drive(2, 61, 1000);
    r.feedAll(first.packets);
    const trackA = r.engine.track!.id;
    r.engine.endSession();
    const at = r.t;
    r.engine.setTrackHint(trackA, { now: at });
    return { r, trackA, at, nextId: lastId(first.packets) + 400 };
  }

  it('30 minutos sem sinal apagam a dica (tick)', () => {
    const { r, at } = withHint();
    r.engine.tick(at + 29 * MIN);
    expect(r.engine.trackHint).not.toBeNull();
    r.engine.tick(at + 31 * MIN);
    expect(r.engine.trackHint).toBeNull();
    expect(r.hints.at(-1)).toBeNull();
    expect(r.engine.trackContext.hint).toBeNull();
    expect(r.engine.trackContext.trackId).toBeNull();
  });

  it('o primeiro pacote depois de 30 minutos de silêncio abre a sessão sem a dica', () => {
    const { r, nextId } = withHint();
    r.t += 31 * MIN;
    r.feedAll(drive(1, 62, nextId).packets.slice(0, 5));
    expect(r.engine.session).not.toBeNull();
    expect(r.engine.session?.trackId).toBeNull();
    expect(r.engine.trackHint).toBeNull();
  });

  it('a dica vive enquanto chegam pacotes e termina com a sessão', () => {
    const { r, trackA, nextId } = withHint();
    r.t += 20 * MIN;
    r.feedAll(drive(1, 62, nextId).packets.slice(0, 5));
    expect(r.engine.session?.trackId).toBe(trackA);
    expect(r.engine.trackHint).not.toBeNull();
    r.engine.endSession();
    expect(r.engine.trackHint).toBeNull();
    expect(r.hints.at(-1)).toBeNull();
  });

  it('trocar de pista substitui a dica anterior', () => {
    const r = rig();
    const { trackA, trackB } = twoKnownTracks(r);
    r.engine.setTrackHint(trackA, { now: r.t });
    const second = r.engine.setTrackHint(trackB, { now: r.t + 1000 });
    expect(second?.trackId).toBe(trackB);
    expect(r.engine.trackHint?.trackId).toBe(trackB);
    expect(r.engine.trackContext.trackId).toBe(trackB);
  });
});

describe('Pista de hoje: divergência com reconciliação (spec 06)', () => {
  /** Run on circuit B with a teleport in lap 1 (so lap 1 is stored under the wrong, chosen track). */
  function wrongChoice() {
    const r = rig();
    const { trackA, trackB, nextId } = twoKnownTracks(r);
    r.engine.setTrackHint(trackA, { now: r.t });
    const run = drive(2, 64, nextId).packets.map(onOtherTrack);
    const k = run.findIndex((p) => p.lapCount === 1) + 1500;
    run[k] = { ...run[k]!, position: { ...run[k]!.position, x: run[k]!.position.x + 400 } };
    return { r, trackA, trackB, run };
  }

  it('a volta que não casa move a sessão e as voltas dela para a pista certa, sem perder nenhuma', () => {
    const { r, trackA, trackB, run } = wrongChoice();
    r.feedAll(run);
    const session = r.ctx.sessions.get(r.engine.session!.id)!;
    expect(r.mismatches).toHaveLength(1);
    const m = r.mismatches[0]!;
    expect(m).toMatchObject({
      sessionId: session.id,
      hintedTrackId: trackA,
      detectedTrackId: trackB,
      lapNumber: 2,
      lapsMoved: 1,
    });
    expect(m.hintedTrackName).toBe(r.ctx.tracks.get(trackA)!.name);
    expect(m.detectedTrackName).toBe(r.ctx.tracks.get(trackB)!.name);

    // a sessão e as duas voltas (a suja da volta 1 e a boa da volta 2) ficaram na pista certa
    expect(session.trackId).toBe(trackB);
    const laps = lapsOf(r, session.id);
    expect(laps).toHaveLength(2);
    expect(laps.every((l) => l.trackId === trackB)).toBe(true);
    expect(laps.some((l) => !l.valid)).toBe(true);
    expect(laps.some((l) => l.valid)).toBe(true);

    // o motor segue na pista certa, confirmada; recordes e referência vêm da pista B
    expect(r.engine.trackInfo).toMatchObject({ id: trackB, confidence: 'confirmed' });
    expect(r.engine.trackContext.basis).toBe('lap');
    expect(r.engine.deltaReference.activeLapId).not.toBeNull();
    expect(r.ctx.loadLap(r.engine.deltaReference.activeLapId!)?.lap.trackId).toBe(trackB);
    // a dica falhou: acabou
    expect(r.engine.trackHint).toBeNull();
    // nada foi criado nem mexido na pista A
    expect(r.ctx.tracks.size).toBe(2);
    const onA = [...r.ctx.laps.values()].filter((s) => s.lap.trackId === trackA);
    expect(onA).toHaveLength(2);
  });

  it('a reconciliação é idempotente', () => {
    const { r, trackB, run } = wrongChoice();
    r.feedAll(run);
    const sid = r.engine.session!.id;
    const before = lapsOf(r, sid).map((l) => ({ id: l.id, trackId: l.trackId }));
    expect(r.ctx.reassignSessionTrack(sid, trackB)).toBe(0);
    expect(r.ctx.reassignSessionTrack(sid, trackB)).toBe(0);
    expect(lapsOf(r, sid).map((l) => ({ id: l.id, trackId: l.trackId }))).toEqual(before);
    expect(r.ctx.sessions.get(sid)?.trackId).toBe(trackB);
  });

  it('a dica errada numa pista nunca vista cria a pista nova e move a sessão para ela', () => {
    const r = rig();
    const first = drive(2, 61, 1000);
    r.feedAll(first.packets);
    const trackA = r.engine.track!.id;
    r.engine.endSession();
    r.engine.setTrackHint(trackA, { now: r.t });
    let stageAtMismatch: number | undefined;
    r.engine.on('trackMismatch', () => {
      stageAtMismatch = r.engine.trackContext.learning?.stage;
    });
    r.feedAll(drive(2, 62, lastId(first.packets) + 400).packets.map(onOtherTrack));
    expect(r.mismatches).toHaveLength(1);
    const detected = r.mismatches[0]!.detectedTrackId;
    expect(detected).not.toBe(trackA);
    expect(r.ctx.tracks.get(detected)?.name).toMatch(/^Pista desconhecida/);
    expect(r.engine.session?.trackId).toBe(detected);
    // a pista nova foi aprendida agora: o guia mostra a etapa 3
    expect(stageAtMismatch).toBe(3);
  });

  it('"Manter a pista escolhida" (force) trava a escolha e não reconhece de novo', () => {
    const { r, trackA, run } = wrongChoice();
    r.feedAll(run.slice(0, 5));
    r.engine.setTrackHint(trackA, { now: r.t, force: true });
    expect(r.engine.trackInfo).toMatchObject({ id: trackA, confidence: 'confirmed' });
    r.feedAll(run.slice(5));
    expect(r.mismatches).toHaveLength(0);
    expect(r.engine.session?.trackId).toBe(trackA);
    expect(lapsOf(r, r.engine.session!.id).every((l) => l.trackId === trackA)).toBe(true);
  });
});

describe('Guia da volta de reconhecimento (spec 05 item 3)', () => {
  const stageOf = (r: Rig) => r.engine.trackContext.learning;

  it('percorre as etapas 1, 2 e 3 e some quando a volta seguinte fecha', () => {
    const r = rig();
    const gen = drive(3, 71, 1000);
    const seen: string[] = [];
    let sawStage3Pending = false;
    for (const p of gen.packets) {
      r.feed(p);
      const l = stageOf(r);
      const label = l ? `${l.stage}` : '-';
      if (seen.at(-1) !== label) seen.push(label);
      if (l?.stage === 3 && r.engine.trackContext.corners === 'pending') sawStage3Pending = true;
    }
    // saída (1), reconhecimento (2), aprendida (3), volta seguinte fechada (sem guia)
    expect(seen.join('')).toBe('123-');
    expect(sawStage3Pending).toBe(true);
    expect(r.laps.length).toBeGreaterThanOrEqual(2);
  });

  it('"Curvas prontas": markCornersSettled troca pending por ready', () => {
    const r = rig();
    const gen = drive(2, 72, 1000);
    for (const p of gen.packets) {
      r.feed(p);
      if (r.laps.length === 1) break;
    }
    expect(stageOf(r)?.stage).toBe(3);
    expect(r.engine.trackContext.corners).toBe('pending');
    r.engine.markCornersSettled(r.engine.track!.id);
    expect(r.engine.trackContext.corners).toBe('ready');
    expect(stageOf(r)?.stage).toBe(3);
  });

  it('um reinício na volta de reconhecimento mostra o motivo e volta à etapa 1', () => {
    const r = rig();
    const a = drive(2, 73, 1000);
    const cut = a.packets.findIndex((p) => p.lapCount === 1) + 1500;
    r.feedAll(a.packets.slice(0, cut));
    expect(stageOf(r)).toEqual({ stage: 2, invalid: null });
    // restart: the lap counter goes back to 0
    const b = drive(2, 74, a.packets[cut]!.packetId + 1);
    r.feedAll(b.packets.slice(0, 20));
    expect(stageOf(r)).toEqual({ stage: 1, invalid: 'restart' });
    // the next valid recognition lap clears the message and learns the track
    r.feedAll(b.packets.slice(20));
    expect(r.ctx.tracks.size).toBe(1);
    const after = stageOf(r);
    expect(after === null || (after.stage === 3 && after.invalid === null)).toBe(true);
  });

  it('uma volta com descontinuidade não cria a pista e pede mais uma', () => {
    const r = rig();
    const gen = drive(3, 75, 1000);
    const k = gen.packets.findIndex((p) => p.lapCount === 1) + 1500;
    const packets = [...gen.packets];
    packets[k] = {
      ...packets[k]!,
      position: { ...packets[k]!.position, x: packets[k]!.position.x + 400 },
    };
    let invalidAfterBadLap: unknown = null;
    for (const p of packets) {
      r.feed(p);
      if (r.laps.length === 1 && invalidAfterBadLap === null) {
        invalidAfterBadLap = { ...stageOf(r)!, tracks: r.ctx.tracks.size };
      }
    }
    expect(invalidAfterBadLap).toEqual({ stage: 2, invalid: 'discontinuity', tracks: 0 });
    // the following clean lap learns the track and clears the message
    expect(r.ctx.tracks.size).toBe(1);
  });

  it('pista salva reconhecida pela largada, ou escolhida, não tem guia', () => {
    const r = rig();
    const first = drive(2, 61, 1000);
    r.feedAll(first.packets);
    r.engine.endSession();
    const second = drive(2, 62, lastId(first.packets) + 400);
    r.feedAll(second.packets);
    expect(stageOf(r)).toBeNull();
  });
});

describe('Palpite pelo catálogo ao cruzar a largada (spec 05 item 5)', () => {
  const trial = listTrackLayouts().find(
    (l) => l.venue === 'Trial Mountain Circuit' && !l.reverse && l.start,
  )!;

  /** Moves the whole run so that its start line sits on `at` heading `heading`. */
  function placeAt(
    packets: TelemetryPacket[],
    at: { x: number; z: number },
    heading: number,
  ): TelemetryPacket[] {
    const i0 = packets.findIndex((p) => p.lapCount === 1);
    const p0 = packets[i0]!;
    const h0 = Math.atan2(p0.velocity.x, p0.velocity.z);
    const phi = heading - h0;
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const rot = (x: number, z: number) => ({ x: x * c + z * s, z: z * c - x * s });
    return packets.map((p) => {
      const rel = rot(p.position.x - p0.position.x, p.position.z - p0.position.z);
      const v = rot(p.velocity.x, p.velocity.z);
      return {
        ...p,
        position: { x: at.x + rel.x, y: p.position.y, z: at.z + rel.z },
        velocity: { x: v.x, y: p.velocity.y, z: v.z },
      };
    });
  }

  it('casa: nomeia o circuito como "provável", sem gravar nada, e a volta fechada decide', () => {
    expect(getTrackLayout(trial.id)).toBeDefined();
    const r = rig();
    const gen = drive(2, 76, 1000);
    const packets = placeAt(gen.packets, trial.start!, layoutStartHeading(trial)!);
    const i0 = packets.findIndex((p) => p.lapCount === 1);
    r.feedAll(packets.slice(0, i0 + 10));
    const c = r.engine.trackContext;
    expect(c).toMatchObject({
      name: 'Trial Mountain Circuit',
      confidence: 'probable',
      basis: 'catalog',
      trackId: null,
    });
    expect(r.engine.trackInfo).toBeNull();
    // never persisted without a closed lap
    expect(r.ctx.tracks.size).toBe(0);
    expect(r.ctx.sessions.size).toBe(1);
    // still a new track for the guide
    expect(c.learning?.stage).toBe(2);

    r.feedAll(packets.slice(i0 + 10));
    const done = r.engine.trackContext;
    expect(done.basis).toBe('lap');
    expect(done.confidence).toBe('confirmed');
    // the lap geometry is a synthetic circuit, not Trial Mountain: the guess is dropped
    expect(done.name).toMatch(/^Pista desconhecida/);
  });

  it('sem match: uma largada que não é de nenhum layout não gera palpite', () => {
    const r = rig();
    const gen = drive(1, 77, 1000);
    const packets = placeAt(gen.packets, { x: 9e5, z: 9e5 }, 0.3);
    const i0 = packets.findIndex((p) => p.lapCount === 1);
    r.feedAll(packets.slice(0, i0 + 10));
    expect(r.engine.trackContext).toMatchObject({
      basis: 'none',
      confidence: 'unknown',
      name: null,
    });
  });

  it('uma pista salva na largada vence o palpite (basis start, sem guia)', () => {
    const r = rig();
    const first = drive(2, 61, 1000);
    r.feedAll(first.packets);
    r.engine.endSession();
    const second = drive(1, 62, lastId(first.packets) + 400);
    const i0 = second.packets.findIndex((p) => p.lapCount === 1);
    r.feedAll(second.packets.slice(0, i0 + 10));
    expect(r.engine.trackContext).toMatchObject({ basis: 'start', confidence: 'probable' });
    expect(r.engine.trackContext.learning).toBeNull();
  });
});
