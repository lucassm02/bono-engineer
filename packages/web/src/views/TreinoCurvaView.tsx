import type { LiveFrame } from '@gt7/shared';
import { useRef } from 'react';
import { type CornerHintExt, distanceToBrake } from '../lib/cornerPass.ts';
import { setAttr, setStyle, setText } from '../lib/dom.ts';
import { clamp, deltaTone, formatDelta, formatInt } from '../lib/format.ts';
import { wrapDistance } from '../lib/mapMath.ts';
import { derived } from '../live/derived.ts';
import { live } from '../live/liveStore.ts';
import { useLiveRender } from '../live/raf.ts';
import {
  setCornerAudio,
  setPinnedCorner,
  speechSupported,
  useCornerTraining,
} from '../state/cornerTraining.ts';
import { cornerLabel } from './MapaView.tsx';

/** Countdown bar full scale (m before the brake point). */
const COUNTDOWN_M = 300;
const ITEMS = ['brake', 'vmin', 'throttle'] as const;
const ITEM_LABEL = { brake: 'Frenagem', vmin: 'V-mín', throttle: 'Retomada' } as const;
/** The result card is "fresh" (full colour) for this long after a pass. */
const FRESH_MS = 9000;

function arrow(dir: 'left' | 'right'): string {
  return dir === 'left' ? '↰' : '↱';
}

export function TreinoCurvaView() {
  const audio = useCornerTraining((s) => s.audio);
  const pinned = useCornerTraining((s) => s.pinnedCornerId);
  const r = useRef<Record<string, HTMLElement | null>>({});
  const set = (k: string) => (el: HTMLElement | null) => {
    r.current[k] = el;
  };
  const passSeen = useRef({ version: -1, at: 0 });

  useLiveRender((f: LiveFrame, now: number) => {
    const e = r.current;
    const pinnedId = useCornerTraining.getState().pinnedCornerId;
    const hint = f.nextCorner as CornerHintExt | null;
    const L = f.track?.lengthM ?? null;
    const focusId = pinnedId ?? hint?.cornerId ?? null;
    const isNext = !!hint && hint.cornerId === focusId;
    setAttr(e.root, 'data-hint', focusId ? '1' : '0');

    if (focusId) {
      const entry = derived.cornerEntries.get(focusId);
      setText(e.name, cornerLabel(focusId, isNext ? hint!.name : (entry?.name ?? null)));
      setText(e.dir, isNext ? arrow(hint!.direction) : '');
      if (isNext && hint) {
        const b = distanceToBrake(hint, f.distanceM, L);
        setText(e.distLabel, b.kind === 'brake' ? 'até a frenagem da ref.' : 'até a entrada');
        setText(e.dist, `${formatInt(Math.max(0, b.meters))} m`);
        const frac = clamp(1 - b.meters / COUNTDOWN_M, 0, 1);
        setStyle(e.bar, 'transform', `scaleX(${frac.toFixed(3)})`);
        setAttr(e.barBox, 'data-near', b.meters < 60 ? '1' : '0');
        setText(
          e.tBrake,
          hint.referenceBrakePointM === null ? '–' : `${formatInt(hint.referenceBrakePointM)} m`,
        );
        setText(
          e.tVmin,
          hint.referenceMinSpeedKmh === null
            ? '–'
            : `${formatInt(hint.referenceMinSpeedKmh)} km/h${hint.referenceGearAtApex ? ` · ${hint.referenceGearAtApex}ª` : ''}`,
        );
        setText(
          e.tThrottle,
          hint.referenceThrottleOnM == null ? '–' : `${formatInt(hint.referenceThrottleOnM)} m`,
        );
        setText(
          e.lastDelta,
          hint.lastPassDeltaMs === null
            ? ''
            : `Última passagem ${formatDelta(hint.lastPassDeltaMs)} s vs referência`,
        );
        setAttr(e.lastDelta, 'data-tone', deltaTone(hint.lastPassDeltaMs, 20));
      } else {
        // Pinned corner that is not next yet: distance to its entry when known.
        const dist =
          entry && f.distanceM !== null && L ? wrapDistance(entry.entryM - f.distanceM, L) : null;
        setText(e.distLabel, 'até a curva fixada');
        setText(
          e.dist,
          dist === null
            ? '–'
            : dist >= 1000
              ? `${(dist / 1000).toFixed(1).replace('.', ',')} km`
              : `${formatInt(dist)} m`,
        );
        setStyle(e.bar, 'transform', 'scaleX(0)');
        setAttr(e.barBox, 'data-near', '0');
        setText(e.lastDelta, hint ? `Antes: ${cornerLabel(hint.cornerId, hint.name)}` : '');
        setAttr(e.lastDelta, 'data-tone', 'neutral');
      }
      setAttr(e.root, 'data-ref', isNext && hint?.referenceBrakePointM != null ? '1' : '0');
    }

    // Result of the last pass (pinned corner only, when pinned).
    const rec = pinnedId ? (derived.passes.get(pinnedId) ?? null) : derived.lastPass;
    if (derived.passVersion !== passSeen.current.version) {
      passSeen.current = { version: derived.passVersion, at: now };
    }
    setAttr(e.result, 'data-show', rec ? '1' : '0');
    if (rec) {
      const a = rec.assessment;
      setAttr(e.result, 'data-verdict', a.verdict);
      setAttr(e.result, 'data-fresh', now - passSeen.current.at < FRESH_MS ? '1' : '0');
      setText(e.resCorner, cornerLabel(rec.pass.cornerId, rec.pass.name));
      setText(e.resHead, a.headline);
      for (const key of ITEMS) {
        const it = a.items.find((i) => i.key === key);
        setAttr(e[`row-${key}`], 'data-tone', it?.tone ?? 'info');
        setText(e[`you-${key}`], it?.you ?? '–');
        setText(e[`tgt-${key}`], it?.target ?? '–');
        setText(e[`txt-${key}`], it ? it.text : '–');
      }
      const basis = a.items.find((i) => i.basis !== null)?.basis ?? null;
      setText(
        e.basis,
        basis === 'passagem anterior'
          ? 'Alvo: sua passagem anterior (sem referência)'
          : basis
            ? 'Alvo: volta de referência'
            : '',
      );
    }
  });

  const pinCurrent = () => {
    if (pinned) setPinnedCorner(null);
    else {
      const id = live.frame?.nextCorner?.cornerId ?? null;
      if (id) setPinnedCorner(id);
    }
  };

  return (
    <div className="view treino" ref={set('root')} data-hint="0" data-ref="0">
      <section className="treino-next">
        <div className="treino-head">
          <span className="treino-dir" ref={set('dir')} />
          <span className="treino-name" ref={set('name')} />
        </div>
        <div className="treino-dist">
          <span className="num treino-dist-value" ref={set('dist')} />
          <span className="readout-label" ref={set('distLabel')} />
        </div>
        <div className="treino-bar" ref={set('barBox')} data-near="0">
          <div className="treino-bar-fill" ref={set('bar')} />
        </div>
        <dl className="treino-targets num">
          <div>
            <dt>Frenagem</dt>
            <dd ref={set('tBrake')}>–</dd>
          </div>
          <div>
            <dt>V-mín</dt>
            <dd ref={set('tVmin')}>–</dd>
          </div>
          <div>
            <dt>Retomada</dt>
            <dd ref={set('tThrottle')}>–</dd>
          </div>
        </dl>
        <div className="treino-last num" ref={set('lastDelta')} data-tone="neutral" />
        <div className="treino-nohint">
          <strong>Sem dica de curva</strong>
          <span className="dim">
            O treino precisa de uma pista identificada com curvas detectadas. As metas vêm da volta
            de referência do delta.
          </span>
        </div>
      </section>
      <section className="treino-result" ref={set('result')} data-show="0" data-verdict="neutral">
        <div className="treino-res-top">
          <span className="readout-label">Última passagem</span>
          <span className="treino-res-corner" ref={set('resCorner')} />
        </div>
        <div className="treino-res-head" ref={set('resHead')} />
        <table className="treino-res-table num">
          <thead>
            <tr>
              <th />
              <th>Você</th>
              <th>Alvo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ITEMS.map((k) => (
              <tr key={k} ref={set(`row-${k}`)} data-tone="info">
                <td>{ITEM_LABEL[k]}</td>
                <td ref={set(`you-${k}`)} />
                <td ref={set(`tgt-${k}`)} />
                <td className="treino-res-txt" ref={set(`txt-${k}`)} />
              </tr>
            ))}
          </tbody>
        </table>
        <div className="dim treino-basis" ref={set('basis')} />
      </section>
      <section className="treino-empty-result dim">
        Passe por uma curva para ver o resultado: frenagem, V-mín e retomada contra a referência.
      </section>
      <div className="treino-controls" data-no-gesture>
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          aria-pressed={audio}
          disabled={!speechSupported()}
          onClick={() => setCornerAudio(!audio)}
        >
          {audio ? 'Áudio: ligado' : 'Áudio: desligado'}
        </button>
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          aria-pressed={!!pinned}
          onClick={pinCurrent}
        >
          {pinned ? `Soltar ${pinned}` : 'Fixar esta curva'}
        </button>
      </div>
    </div>
  );
}
