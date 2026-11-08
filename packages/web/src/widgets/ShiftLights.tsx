import { useRef } from 'react';
import { SHIFT_LIGHT_COUNT } from '../config.ts';
import { setAttr } from '../lib/dom.ts';
import { shiftLightLevel, shiftZone } from '../lib/shift.ts';
import { useLiveRender } from '../live/raf.ts';

const LIGHTS = Array.from({ length: SHIFT_LIGHT_COUNT }, (_, i) => ({
  key: `l${i}`,
  zone: shiftZone(i, SHIFT_LIGHT_COUNT),
}));

/** LED strip driven by the game's alert RPM range; flashes blue at the limiter. */
export function ShiftLights({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLiveRender((f, now) => {
    const el = ref.current;
    if (!el) return;
    const { lit, limiter } = shiftLightLevel(f.car.rpm, f.car.rpmAlert, SHIFT_LIGHT_COUNT);
    const flash = (limiter || f.flags.revLimiterAlert) && Math.floor(now / 90) % 2 === 0;
    setAttr(el, 'data-flash', flash ? '1' : '0');
    const kids = el.children;
    for (let i = 0; i < kids.length; i++) setAttr(kids[i], 'data-on', i < lit ? '1' : '0');
  });
  return (
    <div className={`shift-lights ${className}`} ref={ref} aria-hidden="true">
      {LIGHTS.map((l) => (
        <span key={l.key} className={`led led-${l.zone}`} data-on="0" />
      ))}
    </div>
  );
}
