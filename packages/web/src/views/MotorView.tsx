import { carName, makerOfCar } from '@gt7/shared';
import { useRef } from 'react';
import { setAttr, setStyle, setText } from '../lib/dom.ts';
import { clamp, formatFixed, formatGear, formatInt } from '../lib/format.ts';
import { shiftLightLevel } from '../lib/shift.ts';
import { useLiveRender } from '../live/raf.ts';
import { ShiftLights } from '../widgets/ShiftLights.tsx';

const BOOST_MIN = -1;
const BOOST_MAX = 2;

/** Upper end of the RPM bar: a bit above the alert max, rounded up to 1000. */
export function rpmScaleMax(alertMax: number, rpm: number): number {
  const base = Math.max(alertMax > 0 ? alertMax * 1.08 : 0, rpm, 6000);
  return Math.ceil(base / 1000) * 1000;
}

export function MotorView() {
  const r = useRef<Record<string, HTMLElement | null>>({});
  const set = (k: string) => (el: HTMLElement | null) => {
    r.current[k] = el;
  };
  const scaleRef = useRef(0);

  useLiveRender((f) => {
    const e = r.current;
    const { rpm, rpmAlert } = f.car;
    const max = Math.max(scaleRef.current, rpmScaleMax(rpmAlert.max, rpm));
    if (max !== scaleRef.current) {
      scaleRef.current = max;
      // Ticks every 1000 rpm, alert zone overlay.
      const ticks = e.ticks;
      if (ticks) {
        ticks.replaceChildren();
        for (let v = 0; v <= max; v += 1000) {
          const s = document.createElement('span');
          s.style.left = `${(v / max) * 100}%`;
          s.textContent = String(v / 1000);
          ticks.appendChild(s);
        }
      }
    }
    const frac = clamp(rpm / max, 0, 1);
    setStyle(e.rpmFill, 'transform', `scaleX(${frac.toFixed(4)})`);
    if (rpmAlert.max > rpmAlert.min) {
      setStyle(e.zone, 'left', `${((rpmAlert.min / max) * 100).toFixed(2)}%`);
      setStyle(e.zone, 'width', `${(((rpmAlert.max - rpmAlert.min) / max) * 100).toFixed(2)}%`);
      setStyle(e.redline, 'left', `${((rpmAlert.max / max) * 100).toFixed(2)}%`);
    }
    const { lit, limiter } = shiftLightLevel(rpm, rpmAlert, 10);
    setAttr(
      e.rpmBox,
      'data-stage',
      limiter ? 'limit' : lit >= 8 ? 'red' : lit >= 4 ? 'amber' : 'normal',
    );
    // Car name from the catalogue (nothing is shown for cars it does not know).
    const known = carName(f.car.carCode);
    setText(e.carname, known ? `${makerOfCar(f.car.carCode)?.name ?? ''} ${known}`.trim() : '');
    setText(e.rpm, formatInt(rpm));
    setText(e.gear, formatGear(f.car.gear));
    const sug = f.car.suggestedGear;
    setAttr(e.sugBox, 'data-show', sug !== null && sug !== f.car.gear ? '1' : '0');
    setText(e.sug, sug === null ? '' : formatGear(sug));
    setText(e.speed, formatInt(f.car.speedKmh));

    const hasTurbo = f.flags.hasTurbo;
    setAttr(e.boostBox, 'data-turbo', hasTurbo ? '1' : '0');
    setText(e.boost, hasTurbo ? formatFixed(f.car.boostBar, 2) : 'aspirado');
    const zero = (0 - BOOST_MIN) / (BOOST_MAX - BOOST_MIN);
    const b = (clamp(f.car.boostBar, BOOST_MIN, BOOST_MAX) - BOOST_MIN) / (BOOST_MAX - BOOST_MIN);
    setStyle(e.boostFill, 'left', `${(Math.min(zero, b) * 100).toFixed(1)}%`);
    setStyle(e.boostFill, 'width', `${(Math.abs(b - zero) * 100).toFixed(1)}%`);
    setText(e.oil, formatFixed(f.car.oilPressureBar, 1));
    setText(e.vmax, formatInt(f.car.maxSpeedKmh));
  });

  return (
    <div className="view motor">
      <ShiftLights className="motor-lights" />
      <div className="motor-rpm" ref={set('rpmBox')} data-stage="normal">
        <div className="motor-rpm-head">
          <span className="readout-label">RPM</span>
          <span className="readout-label motor-carname" ref={set('carname')} />
          <span className="motor-rpm-value num" ref={set('rpm')}>
            –
          </span>
        </div>
        <div className="rpm-track">
          <div className="rpm-zone" ref={set('zone')} />
          <div className="rpm-fill" ref={set('rpmFill')} />
          <div className="rpm-redline" ref={set('redline')} />
        </div>
        <div className="rpm-ticks num" ref={set('ticks')} aria-hidden="true" />
      </div>
      <div className="motor-gear">
        <div className="readout-label">Marcha</div>
        <div className="motor-gear-value num" ref={set('gear')}>
          –
        </div>
        <div className="motor-sug" ref={set('sugBox')} data-show="0">
          Sugerida <span className="num" ref={set('sug')} />
        </div>
      </div>
      <div className="motor-stats">
        <div className="stat stat-boost" ref={set('boostBox')} data-turbo="1">
          <div className="readout-label">Turbo (bar)</div>
          <div className="stat-value num" ref={set('boost')} />
          <div className="boost-track">
            <div className="boost-zero" />
            <div className="boost-fill" ref={set('boostFill')} />
          </div>
        </div>
        <div className="stat">
          <div className="readout-label">Óleo (bar)</div>
          <div className="stat-value num" ref={set('oil')} />
        </div>
        <div className="stat">
          <div className="readout-label">Velocidade</div>
          <div className="stat-value num">
            <span ref={set('speed')} /> <small>km/h</small>
          </div>
        </div>
        <div className="stat">
          <div className="readout-label">Máxima estimada</div>
          <div className="stat-value num">
            <span ref={set('vmax')} /> <small>km/h</small>
          </div>
        </div>
      </div>
    </div>
  );
}
