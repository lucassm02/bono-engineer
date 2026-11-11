import { useRef } from 'react';
import { DELTA_BAR_RANGE_MS } from '../config.ts';
import { setAttr, setStyle, setText } from '../lib/dom.ts';
import { clamp, deltaTone, formatDelta, formatLapTime } from '../lib/format.ts';
import { t as uiText } from '../lib/i18n.ts';
import { DELTA_REFERENCE_LABELS } from '../lib/labels.ts';
import { useLiveRender } from '../live/raf.ts';
import { DeltaBar } from '../widgets/DeltaBar.tsx';
import { lapCounterText, trendGlyph } from './CorridaView.tsx';

/** Background tint intensity 0–1 from the delta magnitude (saturates at the bar range). */
export function tintStrength(ms: number | null): number {
  if (ms === null || !Number.isFinite(ms)) return 0;
  return clamp(Math.abs(ms) / DELTA_BAR_RANGE_MS, 0, 1);
}

export function DeltaGrandeView() {
  const r = useRef<Record<string, HTMLElement | null>>({});
  const set = (k: string) => (el: HTMLElement | null) => {
    r.current[k] = el;
  };

  useLiveRender((f) => {
    const e = r.current;
    const ms = f.lap.delta.ms;
    setText(e.delta, formatDelta(ms, 2));
    setAttr(e.root, 'data-tone', deltaTone(ms));
    // 0.30 minimum so small deltas are already visible, up to 0.62 at full scale (white text stays readable).
    const k = ms === null ? 0 : 0.3 + tintStrength(ms) * 0.32;
    setStyle(e.root, '--tint', k.toFixed(2));
    setText(e.trend, trendGlyph(f.lap.delta.rateMsPerS));
    setText(
      e.ref,
      ms === null
        ? uiText('Sem volta de referência')
        : uiText('Contra {0}', DELTA_REFERENCE_LABELS[f.lap.delta.reference].toLowerCase()),
    );
    setText(e.lap, lapCounterText(f));
    setText(e.predicted, uiText('Prevista {0}', formatLapTime(f.lap.predictedLapMs)));
  });

  return (
    <div className="view delta-grande" ref={set('root')} data-tone="neutral">
      <div className="dg-top">
        <span ref={set('lap')} />
        <span ref={set('predicted')} className="num" />
      </div>
      <div className="dg-value num">
        <span ref={set('delta')}>––,––</span>
        <span className="dg-trend" ref={set('trend')} />
      </div>
      <DeltaBar className="dg-bar" />
      <div className="dg-ref" ref={set('ref')} />
    </div>
  );
}
