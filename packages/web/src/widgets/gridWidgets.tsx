/**
 * Small widgets of the custom grid ("Personalizada"). Each one renders into its own cell (CSS
 * container, so text scales with the cell) and writes to the DOM from the rAF loop.
 */

import type { LiveFrame, WidgetId } from '@gt7/shared';
import { type ComponentType, useRef } from 'react';
import { SLIP_ALERT, SLIP_WARN, TYRE_TEMP_SCALE } from '../config.ts';
import { distanceToBrake } from '../lib/cornerPass.ts';
import { setAttr, setStyle, setText } from '../lib/dom.ts';
import {
  clamp,
  deltaTone,
  formatDelta,
  formatFixed,
  formatGear,
  formatInt,
  formatLapTime,
  formatSectorTime,
} from '../lib/format.ts';
import { t as uiText } from '../lib/i18n.ts';
import { DELTA_REFERENCE_LABELS, wheelLabel } from '../lib/labels.ts';
import { tyreTempColor } from '../lib/tyreColor.ts';
import { useLiveRender } from '../live/raf.ts';
import { steeringText } from '../views/InputsView.tsx';
import { cornerLabel } from '../views/MapView.tsx';
import { fuelText, trendGlyph } from '../views/RaceView.tsx';
import { DeltaBar } from './DeltaBar.tsx';
import { GCircle } from './GCircle.tsx';
import { ShiftLights } from './ShiftLights.tsx';
import { TrackMap } from './TrackMap.tsx';

type Refs = Record<string, HTMLElement | null>;

function useRefs() {
  const r = useRef<Refs>({});
  const set = (k: string) => (el: HTMLElement | null) => {
    r.current[k] = el;
  };
  return { r, set };
}

/** Spec of a "label + one big value" widget. */
interface ValueSpec {
  label: string;
  value: (f: LiveFrame) => string;
  tone?: (f: LiveFrame) => string;
  unit?: string;
  accent?: boolean;
  sub?: (f: LiveFrame) => string;
}

function valueWidget(
  label: string,
  value: (f: LiveFrame) => string,
  opts: Omit<ValueSpec, 'label' | 'value'> = {},
): ValueSpec {
  return { label, value, ...opts };
}

function ValueWidget({ spec }: { spec: ValueSpec }) {
  const { label, value, ...opts } = spec;
  const { r, set } = useRefs();
  useLiveRender((f) => {
    setText(r.current.v, value(f));
    if (opts.tone) setAttr(r.current.box, 'data-tone', opts.tone(f));
    if (opts.sub) setText(r.current.sub, opts.sub(f));
  });
  return (
    <div
      className="gw gw-value"
      ref={set('box')}
      data-tone="neutral"
      data-accent={opts.accent ? '1' : '0'}
    >
      <span className="gw-label">{uiText(label)}</span>
      <span className="gw-big num">
        <span ref={set('v')}>–</span>
        {opts.unit && <small> {opts.unit}</small>}
      </span>
      {opts.sub && <span className="gw-sub dim num" ref={set('sub')} />}
    </div>
  );
}

function DeltaWidget() {
  const { r, set } = useRefs();
  useLiveRender((f) => {
    const d = f.lap.delta;
    setText(r.current.v, formatDelta(d.ms, 2));
    setText(r.current.t, trendGlyph(d.rateMsPerS));
    setAttr(r.current.box, 'data-tone', deltaTone(d.ms));
    setText(
      r.current.ref,
      d.ms === null
        ? uiText('sem referência')
        : `vs ${DELTA_REFERENCE_LABELS[d.reference].toLowerCase()}`,
    );
  });
  return (
    <div className="gw gw-value gw-delta" ref={set('box')} data-tone="neutral">
      <span className="gw-label">
        Delta <span ref={set('ref')} />
      </span>
      <span className="gw-big num">
        <span ref={set('v')}>–</span>
        <span className="trend" ref={set('t')} />
      </span>
    </div>
  );
}

function DeltaBarWidget() {
  return (
    <div className="gw gw-center">
      <span className="gw-label">Delta</span>
      <DeltaBar className="gw-deltabar" />
    </div>
  );
}

function SectorsWidget() {
  const { r, set } = useRefs();
  useLiveRender((f) => {
    for (let i = 0; i < 3; i++) {
      const s = f.sectors[i];
      setText(r.current[`s${i}`], formatSectorTime(s?.timeMs ?? null));
      setAttr(r.current[`b${i}`], 'data-status', s?.status ?? 'pending');
    }
  });
  return (
    <div className="gw gw-sectors">
      {[0, 1, 2].map((i) => (
        <div key={i} className="sector" ref={set(`b${i}`)} data-status="pending">
          <span className="sector-name">S{i + 1}</span>
          <span className="num sector-time" ref={set(`s${i}`)} />
        </div>
      ))}
    </div>
  );
}

function RpmWidget() {
  const { r, set } = useRefs();
  useLiveRender((f) => {
    const max = Math.max(f.car.rpmAlert.max, 1000) * 1.06;
    setStyle(r.current.fill, 'transform', `scaleX(${clamp(f.car.rpm / max, 0, 1).toFixed(3)})`);
    setAttr(r.current.box, 'data-hot', f.car.rpm >= f.car.rpmAlert.min ? '1' : '0');
    setText(r.current.v, formatInt(f.car.rpm));
  });
  return (
    <div className="gw gw-rpm" ref={set('box')} data-hot="0">
      <span className="gw-label">
        RPM <span className="num gw-rpm-v" ref={set('v')} />
      </span>
      <div className="gw-track">
        <div className="gw-fill" ref={set('fill')} />
      </div>
    </div>
  );
}

function ShiftLightsWidget() {
  return (
    <div className="gw gw-center">
      <ShiftLights className="gw-lights" />
    </div>
  );
}

function TyreTempsWidget() {
  const { r, set } = useRefs();
  useLiveRender((f) => {
    for (let i = 0; i < 4; i++) {
      const t = f.tyres.tempC[i as 0 | 1 | 2 | 3];
      setText(r.current[`t${i}`], formatInt(t));
      setStyle(r.current[`c${i}`], '--tyre', tyreTempColor(t, TYRE_TEMP_SCALE));
    }
  });
  return (
    <div className="gw gw-tyres">
      <span className="gw-label">{uiText('Pneus °C')}</span>
      <div className="gw-tyre-grid">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="gw-tyre num" ref={set(`c${i}`)} title={wheelLabel(i)}>
            <span ref={set(`t${i}`)} />
          </span>
        ))}
      </div>
    </div>
  );
}

function TyreSlipWidget() {
  const { r, set } = useRefs();
  useLiveRender((f) => {
    for (let i = 0; i < 4; i++) {
      const s = f.tyres.slip[i as 0 | 1 | 2 | 3];
      const a = Math.abs(s);
      const state = a < SLIP_WARN ? 'ok' : s > 0 ? 'spin' : 'lock';
      setAttr(r.current[`c${i}`], 'data-slip', state);
      setAttr(r.current[`c${i}`], 'data-level', a >= SLIP_ALERT ? '2' : a >= SLIP_WARN ? '1' : '0');
      setText(r.current[`t${i}`], state === 'ok' ? wheelLabel(i) : `${Math.round(a * 100)}%`);
    }
  });
  return (
    <div className="gw gw-tyres">
      <span className="gw-label">{uiText('Patinagem')}</span>
      <div className="gw-tyre-grid">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="gw-slip num" ref={set(`c${i}`)} data-slip="ok" data-level="0">
            <span ref={set(`t${i}`)} />
          </span>
        ))}
      </div>
    </div>
  );
}

function InputsWidget() {
  const { r, set } = useRefs();
  useLiveRender((f) => {
    setStyle(r.current.thr, 'transform', `scaleY(${clamp(f.car.throttle, 0, 1).toFixed(3)})`);
    setStyle(r.current.brk, 'transform', `scaleY(${clamp(f.car.brake, 0, 1).toFixed(3)})`);
  });
  return (
    <div className="gw gw-inputs">
      <span className="gw-label">{uiText('Pedais')}</span>
      <div className="gw-pedals">
        <div className="gw-pedal gw-pedal-brk">
          <div className="gw-pedal-fill" ref={set('brk')} />
        </div>
        <div className="gw-pedal gw-pedal-thr">
          <div className="gw-pedal-fill" ref={set('thr')} />
        </div>
      </div>
    </div>
  );
}

function BoostWidget() {
  const { r, set } = useRefs();
  useLiveRender((f) => {
    setAttr(r.current.box, 'data-turbo', f.flags.hasTurbo ? '1' : '0');
    setText(r.current.v, f.flags.hasTurbo ? formatFixed(f.car.boostBar, 2) : uiText('Aspirado'));
  });
  return (
    <div className="gw gw-value" ref={set('box')} data-turbo="1">
      <span className="gw-label">{uiText('Turbo (bar)')}</span>
      <span className="gw-big num" ref={set('v')} />
    </div>
  );
}

function FlagsWidget() {
  const { r, set } = useRefs();
  useLiveRender((f) => {
    setAttr(r.current.tcs, 'data-on', f.flags.tcsActive ? '1' : '0');
    setAttr(r.current.asm, 'data-on', f.flags.asmActive ? '1' : '0');
    setAttr(r.current.lim, 'data-on', f.flags.revLimiterAlert ? '1' : '0');
    setAttr(r.current.hb, 'data-on', f.flags.handBrake ? '1' : '0');
  });
  return (
    <div className="gw gw-flags">
      <span className="aid" ref={set('tcs')} data-on="0">
        TCS
      </span>
      <span className="aid" ref={set('asm')} data-on="0">
        ASM
      </span>
      <span className="aid" ref={set('lim')} data-on="0">
        LIM
      </span>
      <span className="aid" ref={set('hb')} data-on="0">
        {uiText('FREIO MÃO')}
      </span>
    </div>
  );
}

function NextCornerWidget() {
  const { r, set } = useRefs();
  useLiveRender((f) => {
    const h = f.nextCorner;
    setText(
      r.current.name,
      h
        ? `${h.direction === 'left' ? '↰' : '↱'} ${cornerLabel(h.cornerId, h.name)}`
        : uiText('Sem dica'),
    );
    if (h) {
      const b = distanceToBrake(h, f.distanceM, f.track?.lengthM ?? null);
      setText(r.current.v, `${formatInt(Math.max(0, b.meters))} m`);
      setText(
        r.current.sub,
        b.kind === 'brake' ? uiText('até a frenagem') : uiText('até a entrada'),
      );
    } else {
      setText(r.current.v, '–');
      setText(r.current.sub, '');
    }
  });
  return (
    <div className="gw gw-value">
      <span className="gw-label" ref={set('name')} />
      <span className="gw-big num" ref={set('v')} />
      <span className="gw-sub dim" ref={set('sub')} />
    </div>
  );
}

function GForceWidget() {
  return (
    <div className="gw gw-canvas">
      <GCircle compact />
    </div>
  );
}

function MiniMapWidget() {
  return (
    <div className="gw gw-canvas">
      <TrackMap details={false} className="gw-map" />
    </div>
  );
}

const GRID_WIDGETS: Record<WidgetId, ComponentType | ValueSpec> = {
  delta: DeltaWidget,
  deltaBar: DeltaBarWidget,
  currentLap: valueWidget('Atual', (f) => formatLapTime(f.lap.currentLapMs)),
  predictedLap: valueWidget('Prevista', (f) => formatLapTime(f.lap.predictedLapMs), {
    accent: true,
  }),
  lastLap: valueWidget('Última', (f) => formatLapTime(f.lap.lastLapMs)),
  bestLap: valueWidget('Melhor', (f) => formatLapTime(f.lap.bestLapMs)),
  lapCounter: valueWidget('Volta', (f) =>
    f.lap.lap <= 0
      ? uiText('Saída')
      : f.lap.totalLaps
        ? `${f.lap.lap}/${f.lap.totalLaps}`
        : String(f.lap.lap),
  ),
  sectors: SectorsWidget,
  gear: valueWidget('Marcha', (f) => formatGear(f.car.gear), { accent: true }),
  speed: valueWidget('km/h', (f) => formatInt(f.car.speedKmh)),
  rpm: RpmWidget,
  shiftLights: ShiftLightsWidget,
  tyreTemps: TyreTempsWidget,
  tyreSlip: TyreSlipWidget,
  inputs: InputsWidget,
  steering: valueWidget('Volante', (f) => steeringText(f.car.steeringRad)),
  fuel: valueWidget(
    'Combustível',
    (f) =>
      f.fuel.lapsRemaining === null
        ? formatFixed(f.fuel.level, 1)
        : formatFixed(f.fuel.lapsRemaining, 1),
    {
      sub: (f) =>
        f.fuel.lapsRemaining === null
          ? uiText('litros')
          : fuelText(f).replace(uiText('Comb. '), ''),
    },
  ),
  gForce: GForceWidget,
  miniMap: MiniMapWidget,
  boost: BoostWidget,
  oilPressure: valueWidget('Óleo', (f) => formatFixed(f.car.oilPressureBar, 1), { unit: 'bar' }),
  nextCorner: NextCornerWidget,
  flags: FlagsWidget,
  linkQuality: valueWidget('Conexão', (f) => `${formatInt(f.link.rateHz)} Hz`, {
    sub: (f) => `perda ${formatFixed(f.link.lossPct, 1)}%`,
    tone: (f) => (f.link.lossPct > 2 ? 'loss' : 'neutral'),
  }),
};

/** Renders one widget of the custom grid. */
export function GridWidget({ widget }: { widget: WidgetId }) {
  const w = GRID_WIDGETS[widget];
  if (typeof w === 'function') {
    const W = w;
    return <W />;
  }
  return <ValueWidget spec={w} />;
}
