import { useRef } from 'react';
import { DELTA_BAR_RANGE_MS } from '../config.ts';
import { setAttr, setStyle } from '../lib/dom.ts';
import { deltaBarFraction, deltaTone } from '../lib/format.ts';
import { useLiveRender } from '../live/raf.ts';

/**
 * Horizontal delta bar centred on zero: gaining grows to the left in green, losing grows to the
 * right in red (± {@link DELTA_BAR_RANGE_MS} full scale).
 */
export function DeltaBar({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  useLiveRender((f) => {
    const ms = f.lap.delta.ms;
    const frac = deltaBarFraction(ms, DELTA_BAR_RANGE_MS);
    setAttr(ref.current, 'data-tone', deltaTone(ms));
    // Fill spans from the centre: scaleX on a half-width element anchored at the centre.
    setStyle(fillRef.current, 'transform', `scaleX(${frac.toFixed(3)})`);
  });
  return (
    <div className={`delta-bar ${className}`} ref={ref} data-tone="neutral" aria-hidden="true">
      <div className="delta-bar-track">
        <div className="delta-bar-fill" ref={fillRef} />
        <div className="delta-bar-zero" />
      </div>
      <div className="delta-bar-scale">
        <span>−2 s</span>
        <span>−1</span>
        <span>0</span>
        <span>+1</span>
        <span>+2 s</span>
      </div>
    </div>
  );
}
