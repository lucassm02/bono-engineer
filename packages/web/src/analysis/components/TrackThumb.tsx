/** Track outline as a small SVG (map orientation: x mirrored, north up, same as the live map). */

import { useMemo } from 'react';

export interface ThumbLine {
  x: readonly number[];
  z: readonly number[];
}

/** SVG path + viewBox of a closed polyline, scaled to fit with a margin. */
export function thumbPath(
  line: ThumbLine,
  size = 100,
  pad = 8,
): { d: string; start: { x: number; y: number } } | null {
  const n = Math.min(line.x.length, line.z.length);
  if (n < 3) return null;
  // Map convention: screen = (−x, z) with y growing downwards (north up).
  const xs = Array.from({ length: n }, (_, i) => -line.x[i]!);
  const ys = Array.from({ length: n }, (_, i) => line.z[i]!);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(1e-6, maxX - minX);
  const h = Math.max(1e-6, maxY - minY);
  const scale = (size - pad * 2) / Math.max(w, h);
  const ox = (size - w * scale) / 2;
  const oy = (size - h * scale) / 2;
  const pts = xs.map((x, i) => ({
    x: ox + (x - minX) * scale,
    y: oy + (ys[i]! - minY) * scale,
  }));
  const d = `${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')} Z`;
  return { d, start: pts[0]! };
}

export function TrackThumb({
  line,
  className = '',
  label,
}: {
  line: ThumbLine | null;
  className?: string;
  label?: string;
}) {
  const p = useMemo(() => (line ? thumbPath(line) : null), [line]);
  return (
    <svg
      className={`a-thumb ${className}`}
      viewBox="0 0 100 100"
      role="img"
      aria-label={label ?? 'Traçado da pista'}
    >
      {p ? (
        <>
          <path
            className="a-thumb-line"
            d={p.d}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle className="a-thumb-start" cx={p.start.x} cy={p.start.y} r="3.2" />
        </>
      ) : (
        <text className="a-thumb-none" x="50" y="54" textAnchor="middle">
          sem traçado
        </text>
      )}
    </svg>
  );
}
