import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import { t as uiText } from '../lib/i18n.ts';
import 'uplot/dist/uPlot.min.css';
import { TIMINGS } from '../config.ts';
import { setAttr, setStyle, setText } from '../lib/dom.ts';
import { clamp, formatInt } from '../lib/format.ts';
import { THEME, withAlpha } from '../lib/theme.ts';
import { live } from '../live/liveStore.ts';
import { useLiveRender } from '../live/raf.ts';

const CHART_COLORS = {
  throttle: THEME.gain,
  brake: THEME.loss,
  speed: THEME.text,
  axis: THEME.text3,
  grid: THEME.line,
};

/** Steering text: degrees and side (+ = left in the shared convention). */
export function steeringText(rad: number | null): string {
  if (rad === null) return uiText('Indisponível');
  const deg = Math.round((rad * 180) / Math.PI);
  if (deg === 0) return '0°';
  return `${Math.abs(deg)}° ${deg > 0 ? 'esq.' : 'dir.'}`;
}

function InputsChart() {
  const hostRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const xRef = useRef(new Float64Array(live.history.capacity));

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const axisFont = `13px ${THEME.font}`;
    const opts: uPlot.Options = {
      width: Math.max(100, host.clientWidth),
      height: Math.max(80, host.clientHeight),
      legend: { show: false },
      cursor: { show: false },
      pxAlign: 0,
      scales: {
        x: { time: false, range: [-TIMINGS.inputsWindowS, 0] },
        pct: { range: [0, 105] },
        spd: { range: (_u, _min, max) => [0, Math.max(120, Math.ceil(max / 50) * 50)] },
      },
      axes: [
        {
          stroke: CHART_COLORS.axis,
          font: axisFont,
          grid: { stroke: CHART_COLORS.grid, width: 1 },
          ticks: { show: false },
          values: (_u, vals) => vals.map((v) => (v === 0 ? 'agora' : `${v} s`)),
        },
        {
          scale: 'pct',
          stroke: CHART_COLORS.axis,
          font: axisFont,
          grid: { stroke: CHART_COLORS.grid, width: 1 },
          ticks: { show: false },
          values: (_u, vals) => vals.map((v) => `${v}%`),
          size: 46,
        },
        {
          scale: 'spd',
          side: 1,
          stroke: CHART_COLORS.axis,
          font: axisFont,
          grid: { show: false },
          ticks: { show: false },
          size: 44,
        },
      ],
      series: [
        {},
        {
          scale: 'pct',
          stroke: CHART_COLORS.throttle,
          width: 2,
          fill: withAlpha(CHART_COLORS.throttle, 0.1),
        },
        {
          scale: 'pct',
          stroke: CHART_COLORS.brake,
          width: 2,
          fill: withAlpha(CHART_COLORS.brake, 0.14),
        },
        { scale: 'spd', stroke: CHART_COLORS.speed, width: 1.5, dash: [5, 4] },
      ],
    };
    const plot = new uPlot(opts, [[], [], [], []], host);
    plotRef.current = plot;
    const ro = new ResizeObserver(() => {
      plot.setSize({
        width: Math.max(100, host.clientWidth),
        height: Math.max(80, host.clientHeight),
      });
    });
    ro.observe(host);
    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, []);

  useLiveRender(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const h = live.history;
    const n = h.countWithin(TIMINGS.inputsWindowS);
    const t = h.view('t', n);
    const newest = t[t.length - 1] ?? 0;
    const x = xRef.current.subarray(0, n);
    for (let i = 0; i < n; i++) x[i] = t[i]! - newest;
    plot.setData([x, h.view('throttle', n), h.view('brake', n), h.view('speed', n)], true);
  });

  return <div className="inputs-chart" ref={hostRef} />;
}

export function InputsView() {
  const r = useRef<Record<string, Element | null>>({});
  const set = (k: string) => (el: Element | null) => {
    r.current[k] = el;
  };

  useLiveRender((f) => {
    const e = r.current;
    const bars: [string, number][] = [
      ['thr', f.car.throttle],
      ['brk', f.car.brake],
      ['clu', f.car.clutch],
    ];
    for (const [k, v] of bars) {
      const c = clamp(v, 0, 1);
      setStyle(e[`${k}Fill`] as HTMLElement, 'transform', `scaleX(${c.toFixed(3)})`);
      setText(e[`${k}Val`], `${formatInt(c * 100)}%`);
    }
    // Raw pedal ghosts (~ format+): what the driver pressed before aids.
    const raw: [string, number | null][] = [
      ['thr', f.car.throttleRaw],
      ['brk', f.car.brakeRaw],
    ];
    for (const [k, v] of raw) {
      const el = e[`${k}Raw`] as HTMLElement | null;
      setAttr(el, 'data-show', v === null ? '0' : '1');
      if (v !== null) setStyle(el, 'left', `${(clamp(v, 0, 1) * 100).toFixed(1)}%`);
    }
    const steer = f.car.steeringRad;
    setAttr(e.wheelBox, 'data-available', steer === null ? '0' : '1');
    setStyle(
      e.wheel as SVGElement,
      'transform',
      `rotate(${steer === null ? 0 : (-steer * 180) / Math.PI}deg)`,
    );
    setText(e.steerText, steeringText(steer));
    setAttr(e.tcs, 'data-on', f.flags.tcsActive ? '1' : '0');
    setAttr(e.asm, 'data-on', f.flags.asmActive ? '1' : '0');
  });

  const bar = (k: string, label: string, hasRaw: boolean) => (
    <div className={`pedal pedal-${k}`}>
      <span className="pedal-label">{label}</span>
      <div className="pedal-track">
        <div className="pedal-fill" ref={set(`${k}Fill`)} />
        {hasRaw && <div className="pedal-raw" ref={set(`${k}Raw`)} data-show="0" />}
      </div>
      <span className="pedal-value num" ref={set(`${k}Val`)}>
        0%
      </span>
    </div>
  );

  return (
    <div className="view inputs">
      <div className="inputs-pedals">
        {bar('thr', uiText('Acelerador'), true)}
        {bar('brk', uiText('Freio'), true)}
        {bar('clu', uiText('Embreagem'), false)}
      </div>
      <div className="inputs-wheel" ref={set('wheelBox')} data-available="1">
        <svg viewBox="0 0 120 120" className="wheel-svg" aria-hidden="true">
          <g ref={set('wheel')} className="wheel-rot">
            <circle cx="60" cy="60" r="48" className="wheel-rim" />
            <path d="M14 62 H50 M70 62 H106 M60 70 V106" className="wheel-spoke" />
            <circle cx="60" cy="62" r="11" className="wheel-hub" />
            <rect x="56" y="8" width="8" height="12" rx="2" className="wheel-mark" />
          </g>
        </svg>
        <div className="wheel-text num" ref={set('steerText')} />
        <div className="aids">
          <span className="aid" ref={set('tcs')} data-on="0">
            TCS
          </span>
          <span className="aid" ref={set('asm')} data-on="0">
            ASM
          </span>
        </div>
      </div>
      <InputsChart />
      <div className="inputs-legend" aria-hidden="true">
        <span className="lg lg-thr">{uiText('Acelerador')}</span>
        <span className="lg lg-brk">{uiText('Freio')}</span>
        <span className="lg lg-spd">{uiText('Velocidade (km/h)')}</span>
      </div>
    </div>
  );
}
