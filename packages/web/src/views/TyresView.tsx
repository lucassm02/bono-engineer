import { useRef } from 'react';
import { TyrePace } from '../components/TyrePace.tsx';
import { SLIP_ALERT, SLIP_WARN, SUSPENSION_RANGE_M, TYRE_TEMP_SCALE } from '../config.ts';
import { setAttr, setStyle, setText } from '../lib/dom.ts';
import { clamp, formatInt } from '../lib/format.ts';
import { t as uiText } from '../lib/i18n.ts';
import { surfaceLabel, wheelLabel } from '../lib/labels.ts';
import { tyreTempBand, tyreTempColor } from '../lib/tyreColor.ts';
import { useLiveRender } from '../live/raf.ts';

export type SlipState = 'ok' | 'spin' | 'lock';

export function slipState(slip: number): { state: SlipState; level: 0 | 1 | 2 } {
  const a = Math.abs(slip);
  if (a < SLIP_WARN) return { state: 'ok', level: 0 };
  return { state: slip > 0 ? 'spin' : 'lock', level: a >= SLIP_ALERT ? 2 : 1 };
}

const SLIP_TEXT: Record<SlipState, string> = {
  get ok() {
    return uiText('Aderindo');
  },
  get spin() {
    return uiText('Patinando');
  },
  get lock() {
    return uiText('Travando');
  },
};
const BAND_TEXT = {
  get cold() {
    return uiText('Frio');
  },
  get warming() {
    return uiText('Aquecendo');
  },
  get ideal() {
    return uiText('Ideal');
  },
  get overheating() {
    return uiText('Quente');
  },
  get hot() {
    return uiText('Superaquecido');
  },
} as const;

const WHEELS = [0, 1, 2, 3] as const;
/** Tyre rectangles in the car drawing (viewBox 0 0 200 360). */
const TYRE_RECTS = [
  { x: 14, y: 62 },
  { x: 160, y: 62 },
  { x: 14, y: 248 },
  { x: 160, y: 248 },
] as const;

function CarDrawing({ tyreRef }: { tyreRef: (i: number) => (el: SVGRectElement | null) => void }) {
  return (
    <svg
      className="car-svg"
      viewBox="0 0 200 360"
      role="img"
      aria-label={uiText('Carro visto de cima')}
    >
      <path
        className="car-body"
        d="M100 14 C78 14 66 24 62 44 L54 110 C50 140 50 150 52 170 L56 300 C58 330 72 346 100 346 C128 346 142 330 144 300 L148 170 C150 150 150 140 146 110 L138 44 C134 24 122 14 100 14 Z"
      />
      <path className="car-wing" d="M44 318 H156 V336 H44 Z" />
      <path className="car-wing" d="M50 22 H150 V34 H50 Z" />
      <path className="car-cockpit" d="M80 150 C80 132 120 132 120 150 L116 210 H84 Z" />
      {WHEELS.map((i) => (
        <rect
          key={i}
          ref={tyreRef(i)}
          className="car-tyre"
          x={TYRE_RECTS[i].x}
          y={TYRE_RECTS[i].y}
          width="26"
          height="54"
          rx="6"
        />
      ))}
    </svg>
  );
}

export function TyresView() {
  const r = useRef<Record<string, Element | null>>({});
  const set = (k: string) => (el: Element | null) => {
    r.current[k] = el;
  };

  useLiveRender((f) => {
    const e = r.current;
    const { tempC, slip, suspensionM, surface } = f.tyres;
    const range = SUSPENSION_RANGE_M.max - SUSPENSION_RANGE_M.min;
    for (const i of WHEELS) {
      const t = tempC[i];
      const color = tyreTempColor(t, TYRE_TEMP_SCALE);
      setAttr(e[`tyre${i}`], 'fill', color);
      setStyle(e[`card${i}`] as HTMLElement, '--tyre', color);
      setText(e[`temp${i}`], formatInt(t));
      setText(e[`band${i}`], BAND_TEXT[tyreTempBand(t, TYRE_TEMP_SCALE)]);
      const s = slipState(slip[i]);
      setAttr(e[`slip${i}`], 'data-slip', s.state);
      setAttr(e[`slip${i}`], 'data-level', String(s.level));
      setAttr(e[`tyre${i}`], 'data-slip', s.level > 0 ? s.state : 'ok');
      setText(
        e[`slip${i}`],
        s.state === 'ok'
          ? SLIP_TEXT.ok
          : `${SLIP_TEXT[s.state]} ${Math.round(Math.abs(slip[i]) * 100)}%`,
      );
      const susp = clamp((suspensionM[i] - SUSPENSION_RANGE_M.min) / range, 0, 1);
      setStyle(e[`susp${i}`] as HTMLElement, 'transform', `scaleX(${susp.toFixed(3)})`);
      setText(e[`suspv${i}`], `${Math.round(suspensionM[i] * 1000)} mm`);
      setText(e[`surf${i}`], surface ? surfaceLabel(surface[i]) : '');
      setAttr(e[`surf${i}`], 'data-kind', surface ? surface[i] : '');
    }
  });

  const card = (i: (typeof WHEELS)[number]) => (
    <div className={`tyre-card tyre-card-${i}`} ref={set(`card${i}`)} key={i}>
      <div className="tyre-card-head">
        <span className="tyre-name">{wheelLabel(i)}</span>
        <span className="tyre-surface" ref={set(`surf${i}`)} />
      </div>
      <div className="tyre-temp num">
        <span ref={set(`temp${i}`)}>–</span>
        <small>°C</small>
      </div>
      <div className="tyre-band" ref={set(`band${i}`)} />
      <div className="tyre-slip" ref={set(`slip${i}`)} data-slip="ok" data-level="0" />
      <div className="tyre-susp" title={uiText('Altura da suspensão')}>
        <div className="tyre-susp-track">
          <div className="tyre-susp-fill" ref={set(`susp${i}`)} />
        </div>
        <span className="num" ref={set(`suspv${i}`)} />
      </div>
    </div>
  );

  return (
    <div className="view pneus">
      {card(0)}
      <div className="tyres-car">
        <CarDrawing tyreRef={(i) => set(`tyre${i}`)} />
      </div>
      {card(1)}
      {card(2)}
      {card(3)}
      <TempLegend />
      <TyrePace />
    </div>
  );
}

/** Gradient legend whose stops match the configured thresholds. */
function TempLegend() {
  const s = TYRE_TEMP_SCALE;
  const pos = (t: number) => ((t - s.cold) / (s.hot - s.cold)) * 100;
  const stops = [s.cold, s.idealMin, s.idealMax, s.hot];
  const gradient = `linear-gradient(90deg, ${tyreTempColor(s.cold, s)} 0%, ${tyreTempColor(
    s.idealMin,
    s,
  )} ${pos(s.idealMin)}%, ${tyreTempColor(s.idealMax, s)} ${pos(s.idealMax)}%, ${tyreTempColor(
    s.hot,
    s,
  )} 100%)`;
  return (
    <div className="temp-legend" aria-hidden="true">
      <div className="temp-legend-bar" style={{ background: gradient }} />
      <div className="temp-legend-ticks num">
        {stops.map((t, i) => (
          <span
            key={t}
            style={{ left: `${pos(t)}%` }}
            data-edge={i === 0 ? 'start' : i === stops.length - 1 ? 'end' : undefined}
          >
            {i === stops.length - 1 ? `${t} °C` : t}
          </span>
        ))}
      </div>
    </div>
  );
}
