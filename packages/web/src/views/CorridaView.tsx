import type { LiveFrame } from '@gt7/shared';
import { useRef } from 'react';
import { setAttr, setText } from '../lib/dom.ts';
import {
  deltaTone,
  formatDelta,
  formatFixed,
  formatGear,
  formatInt,
  formatLapTime,
  formatSectorTime,
} from '../lib/format.ts';
import { DELTA_REFERENCE_LABELS } from '../lib/labels.ts';
import { useLiveRender } from '../live/raf.ts';
import { DeltaBar } from '../widgets/DeltaBar.tsx';
import { ShiftLights } from '../widgets/ShiftLights.tsx';

/** Trend arrow from the delta rate (ms/s): ▲ losing, ▼ gaining. */
export function trendGlyph(rate: number | null): string {
  if (rate === null || Math.abs(rate) < 15) return '';
  return rate > 0 ? '▲' : '▼';
}

export function lapCounterText(f: LiveFrame): string {
  if (f.lap.lap <= 0) return 'Volta de saída';
  return f.lap.totalLaps ? `Volta ${f.lap.lap}/${f.lap.totalLaps}` : `Volta ${f.lap.lap}`;
}

export function fuelText(f: LiveFrame): string {
  const laps = f.fuel.lapsRemaining;
  if (laps === null) return `Comb. ${formatFixed(f.fuel.level, 1)} L`;
  return `Comb. ${formatFixed(laps, 1)} voltas`;
}

const SECTORS = [0, 1, 2] as const;

export function CorridaView() {
  const r = useRef<Record<string, HTMLElement | null>>({});
  const set = (k: string) => (el: HTMLElement | null) => {
    r.current[k] = el;
  };

  useLiveRender((f) => {
    const e = r.current;
    const d = f.lap.delta;
    setText(e.delta, formatDelta(d.ms));
    setAttr(e.deltaBox, 'data-tone', deltaTone(d.ms));
    setText(e.trend, trendGlyph(d.rateMsPerS));
    setText(
      e.ref,
      d.ms === null ? 'sem referência' : `vs ${DELTA_REFERENCE_LABELS[d.reference].toLowerCase()}`,
    );
    setText(e.gear, formatGear(f.car.gear));
    setText(e.speed, formatInt(f.car.speedKmh));
    setText(e.predicted, formatLapTime(f.lap.predictedLapMs));
    setText(e.current, formatLapTime(f.lap.currentLapMs));
    setText(e.last, formatLapTime(f.lap.lastLapMs));
    setText(e.best, formatLapTime(f.lap.bestLapMs));
    setText(e.lap, lapCounterText(f));
    setAttr(e.invalid, 'data-show', f.lap.currentLapValid === false ? '1' : '0');
    setText(e.fuel, fuelText(f));
    for (const i of SECTORS) {
      const s = f.sectors[i];
      setText(e[`s${i}`], formatSectorTime(s?.timeMs ?? null));
      setAttr(e[`sb${i}`], 'data-status', s?.status ?? 'pending');
      setText(e[`sd${i}`], s?.deltaMs != null ? formatDelta(s.deltaMs) : '');
    }
  });

  return (
    <div className="view corrida">
      <ShiftLights className="corrida-lights" />
      <div className="corrida-meta">
        <span>
          <span ref={set('lap')} className="meta-strong">
            Volta –
          </span>
          <span ref={set('invalid')} className="tag tag-bad lap-invalid" data-show="0">
            Volta inválida
          </span>
        </span>
        <span ref={set('fuel')}>Comb. –</span>
      </div>
      <div className="corrida-delta tone-box" ref={set('deltaBox')} data-tone="neutral">
        <div className="readout-label">
          Delta <span ref={set('ref')} />
        </div>
        <div className="corrida-delta-value num">
          <span ref={set('delta')}>––,–––</span>
          <span className="trend" ref={set('trend')} />
        </div>
      </div>
      <div className="corrida-gear">
        <div className="readout-label">Marcha</div>
        <div className="gear-value num" ref={set('gear')}>
          –
        </div>
      </div>
      <div className="corrida-speed">
        <div className="readout-label">km/h</div>
        <div className="speed-value num" ref={set('speed')}>
          –
        </div>
      </div>
      <DeltaBar className="corrida-bar" />
      <div className="corrida-times">
        <div className="time-cell time-cell-key">
          <div className="readout-label">Prevista</div>
          <div className="num" ref={set('predicted')} />
        </div>
        <div className="time-cell">
          <div className="readout-label">Atual</div>
          <div className="num" ref={set('current')} />
        </div>
        <div className="time-cell">
          <div className="readout-label">Última</div>
          <div className="num" ref={set('last')} />
        </div>
        <div className="time-cell">
          <div className="readout-label">Melhor</div>
          <div className="num" ref={set('best')} />
        </div>
      </div>
      <div className="corrida-sectors">
        {SECTORS.map((i) => (
          <div className="sector" key={i} ref={set(`sb${i}`)} data-status="pending">
            <span className="sector-name">S{i + 1}</span>
            <span className="num sector-time" ref={set(`s${i}`)} />
            <span className="num sector-delta" ref={set(`sd${i}`)} />
          </div>
        ))}
      </div>
    </div>
  );
}
