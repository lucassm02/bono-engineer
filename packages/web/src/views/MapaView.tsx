import { useRef } from 'react';
import { distanceToBrake } from '../lib/cornerPass.ts';
import { setAttr, setText } from '../lib/dom.ts';
import { deltaTone, formatDelta, formatInt } from '../lib/format.ts';
import { DELTA_REFERENCE_LABELS } from '../lib/labels.ts';
import { derived } from '../live/derived.ts';
import { useLiveRender } from '../live/raf.ts';
import { TrackMap } from '../widgets/TrackMap.tsx';
import { lapCounterText } from './CorridaView.tsx';

const SOURCE_TEXT = {
  server: '',
  mock: 'Traçado da demonstração',
  live: 'Traçado montado com as suas voltas',
} as const;

export function cornerLabel(id: string, name: string | null): string {
  return name ? `${id} · ${name}` : id;
}

export function MapaView() {
  const r = useRef<Record<string, HTMLElement | null>>({});
  const set = (k: string) => (el: HTMLElement | null) => {
    r.current[k] = el;
  };

  useLiveRender((f) => {
    const e = r.current;
    const d = f.lap.delta;
    setText(e.delta, formatDelta(d.ms));
    setAttr(e.deltaBox, 'data-tone', deltaTone(d.ms));
    setText(
      e.ref,
      d.ms === null ? 'sem referência' : `vs ${DELTA_REFERENCE_LABELS[d.reference].toLowerCase()}`,
    );
    setText(e.lap, lapCounterText(f));
    const h = f.nextCorner;
    setAttr(e.corner, 'data-show', h ? '1' : '0');
    if (h) {
      setText(e.cornerName, cornerLabel(h.cornerId, h.name));
      setAttr(e.cornerName, 'data-dir', h.direction);
      const b = distanceToBrake(h, f.distanceM, f.track?.lengthM ?? null);
      setText(e.brakeLabel, b.kind === 'brake' ? 'Frenagem em' : 'Entrada em');
      setText(e.brakeDist, `${formatInt(Math.max(0, b.meters))} m`);
      setText(
        e.target,
        h.referenceMinSpeedKmh === null
          ? ''
          : `V-mín ${formatInt(h.referenceMinSpeedKmh)} km/h${
              h.referenceGearAtApex ? ` · ${h.referenceGearAtApex}ª` : ''
            }`,
      );
    }
    const g = derived.geometry();
    setText(e.source, g ? SOURCE_TEXT[g.source] : '');
  });

  return (
    <div className="view mapa">
      <TrackMap interactive className="mapa-map" />
      <aside className="mapa-side">
        <div className="mapa-delta" ref={set('deltaBox')} data-tone="neutral">
          <div className="readout-label">
            Delta <span ref={set('ref')} />
          </div>
          <div className="num mapa-delta-value" ref={set('delta')} />
        </div>
        <div className="mapa-corner" ref={set('corner')} data-show="0">
          <div className="readout-label">Próxima curva</div>
          <div className="mapa-corner-name" ref={set('cornerName')} data-dir="left" />
          <div className="mapa-brake">
            <span className="readout-label" ref={set('brakeLabel')} />
            <span className="num" ref={set('brakeDist')} />
          </div>
          <div className="dim mapa-target num" ref={set('target')} />
        </div>
        <div className="mapa-legend">
          <span className="lg lg-gain">Ganhando</span>
          <span className="lg lg-loss">Perdendo</span>
          <span className="lg lg-ref">Frenagem da ref.</span>
        </div>
        <div className="dim mapa-foot">
          <span ref={set('lap')} />
          <span ref={set('source')} />
        </div>
      </aside>
    </div>
  );
}
