import { useRef } from 'react';
import { distanceToBrake } from '../lib/cornerPass.ts';
import { setAttr, setText } from '../lib/dom.ts';
import { deltaTone, formatDelta, formatInt } from '../lib/format.ts';
import { t as uiText } from '../lib/i18n.ts';
import { DELTA_REFERENCE_LABELS } from '../lib/labels.ts';
import { derived } from '../live/derived.ts';
import { useLiveRender } from '../live/raf.ts';
import { TrackMap } from '../widgets/TrackMap.tsx';
import { lapCounterText } from './RaceView.tsx';

const SOURCE_TEXT = {
  server: '',
  get mock() {
    return uiText('Traçado da demonstração');
  },
  get live() {
    return uiText('Traçado montado com as suas voltas');
  },
} as const;

export function cornerLabel(id: string, name: string | null): string {
  return name ? `${id} · ${name}` : id;
}

export function MapView() {
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
      d.ms === null
        ? uiText('sem referência')
        : `vs ${DELTA_REFERENCE_LABELS[d.reference].toLowerCase()}`,
    );
    setText(e.lap, lapCounterText(f));
    const h = f.nextCorner;
    setAttr(e.corner, 'data-show', h ? '1' : '0');
    if (h) {
      setText(e.cornerName, cornerLabel(h.cornerId, h.name));
      setAttr(e.cornerName, 'data-dir', h.direction);
      const b = distanceToBrake(h, f.distanceM, f.track?.lengthM ?? null);
      setText(e.brakeLabel, b.kind === 'brake' ? uiText('Frenagem em') : uiText('Entrada em'));
      setText(e.brakeDist, `${formatInt(Math.max(0, b.meters))} m`);
      setText(
        e.target,
        h.referenceMinSpeedKmh === null
          ? ''
          : uiText(
              'V-mín {0} km/h{1}',
              formatInt(h.referenceMinSpeedKmh),
              h.referenceGearAtApex ? ` · ${h.referenceGearAtApex}ª` : '',
            ),
      );
    }
    const g = derived.geometry();
    setText(e.source, g ? SOURCE_TEXT[g.source] : '');
  });

  return (
    <div className="view mapa">
      <TrackMap interactive className="map-map" />
      <aside className="map-side">
        <div className="map-delta" ref={set('deltaBox')} data-tone="neutral">
          <div className="readout-label">
            Delta <span ref={set('ref')} />
          </div>
          <div className="num map-delta-value" ref={set('delta')} />
        </div>
        <div className="map-corner" ref={set('corner')} data-show="0">
          <div className="readout-label">{uiText('Próxima curva')}</div>
          <div className="map-corner-name" ref={set('cornerName')} data-dir="left" />
          <div className="map-brake">
            <span className="readout-label" ref={set('brakeLabel')} />
            <span className="num" ref={set('brakeDist')} />
          </div>
          <div className="dim map-target num" ref={set('target')} />
        </div>
        <div className="map-legend">
          <span className="lg lg-gain">{uiText('Ganhando')}</span>
          <span className="lg lg-loss">{uiText('Perdendo')}</span>
          <span className="lg lg-ref">{uiText('Frenagem da ref.')}</span>
        </div>
        <div className="dim map-foot">
          <span ref={set('lap')} />
          <span ref={set('source')} />
        </div>
      </aside>
    </div>
  );
}
