import { useRef } from 'react';
import { setAttr, setText } from '../lib/dom.ts';
import { formatFixed } from '../lib/format.ts';
import type { GPeaks } from '../lib/gStats.ts';
import { derived } from '../live/derived.ts';
import { useLiveRender } from '../live/raf.ts';
import { GCircle } from '../widgets/GCircle.tsx';

/** "1,24 g esq." style text for a signed lateral value (+ = left). */
export function lateralText(g: number): string {
  const a = Math.abs(g);
  if (a < 0.05) return '0,00';
  return `${formatFixed(a, 2)} ${g > 0 ? 'esq.' : 'dir.'}`;
}

export function longitudinalText(g: number): string {
  const a = Math.abs(g);
  if (a < 0.05) return '0,00';
  return `${formatFixed(a, 2)} ${g > 0 ? 'acel.' : 'freio'}`;
}

const PEAK_ROWS: { key: keyof Omit<GPeaks, 'vertical'>; label: string }[] = [
  { key: 'left', label: 'Lateral esq.' },
  { key: 'right', label: 'Lateral dir.' },
  { key: 'brake', label: 'Frenagem' },
  { key: 'accel', label: 'Aceleração' },
  { key: 'combined', label: 'Combinada' },
];

export function ForcasGView() {
  const r = useRef<Record<string, HTMLElement | null>>({});
  const set = (k: string) => (el: HTMLElement | null) => {
    r.current[k] = el;
  };

  useLiveRender((f) => {
    const e = r.current;
    setText(e.lat, lateralText(f.g.lateral));
    setText(e.lon, longitudinalText(f.g.longitudinal));
    setText(e.comb, formatFixed(Math.hypot(f.g.lateral, f.g.longitudinal), 2));
    const v = f.g.vertical;
    setAttr(e.vertBox, 'data-show', v === null ? '0' : '1');
    if (v !== null) setText(e.vert, formatFixed(v, 2));
    const { lap, session } = derived.g;
    for (const row of PEAK_ROWS) {
      setText(e[`l-${row.key}`], formatFixed(lap[row.key], 2));
      setText(e[`s-${row.key}`], formatFixed(session[row.key], 2));
    }
    setAttr(e.vertPeak, 'data-show', session.vertical === null ? '0' : '1');
    setText(e['l-vert'], lap.vertical === null ? '–' : `±${formatFixed(lap.vertical, 2)}`);
    setText(e['s-vert'], session.vertical === null ? '–' : `±${formatFixed(session.vertical, 2)}`);
  });

  return (
    <div className="view forcas-g">
      <GCircle className="forcas-circle" />
      <div className="forcas-side">
        <div className="forcas-now">
          <div className="stat">
            <span className="readout-label">Lateral (g)</span>
            <span className="stat-value num" ref={set('lat')}>
              –
            </span>
          </div>
          <div className="stat">
            <span className="readout-label">Longitudinal (g)</span>
            <span className="stat-value num" ref={set('lon')}>
              –
            </span>
          </div>
          <div className="stat">
            <span className="readout-label">Combinada (g)</span>
            <span className="stat-value num" ref={set('comb')}>
              –
            </span>
          </div>
          <div className="stat" ref={set('vertBox')} data-show="0">
            <span className="readout-label">Vertical (g)</span>
            <span className="stat-value num" ref={set('vert')}>
              –
            </span>
          </div>
        </div>
        <table className="forcas-peaks num">
          <thead>
            <tr>
              <th>Máximas (g)</th>
              <th>Volta</th>
              <th>Sessão</th>
            </tr>
          </thead>
          <tbody>
            {PEAK_ROWS.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                <td ref={set(`l-${row.key}`)} />
                <td ref={set(`s-${row.key}`)} />
              </tr>
            ))}
            <tr ref={set('vertPeak')} data-show="0">
              <td>Vertical</td>
              <td ref={set('l-vert')} />
              <td ref={set('s-vert')} />
            </tr>
          </tbody>
        </table>
        <p className="forcas-hint dim">Marcas roxas: máximas desta volta.</p>
      </div>
    </div>
  );
}
