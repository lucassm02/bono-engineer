/**
 * G-G diagram (canvas): the dot is the car's acceleration vector — left turn → left, accelerating
 * → up, braking → down. Fading trail of the last ~1.5 s, peak ticks of the current lap on each axis,
 * rings every 0.5 g (scale grows past 2 g when the session peak needs it).
 */

import type { LiveFrame } from '@gt7/shared';
import { useRef } from 'react';
import { gScale } from '../lib/gStats.ts';
import { t as uiText } from '../lib/i18n.ts';
import { THEME, withAlpha } from '../lib/theme.ts';
import { derived } from '../live/derived.ts';
import { live } from '../live/liveStore.ts';
import { useLiveRender } from '../live/raf.ts';
import { beginDraw, CANVAS_COLORS as C, useCanvasSize } from './useCanvas.ts';

export function GCircle({
  compact = false,
  className = '',
}: {
  compact?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const draw = (f: LiveFrame | null) => {
    const s = size.current;
    const ctx = beginDraw(canvasRef.current, s);
    if (!ctx) return;
    const stats = derived.g;
    const maxG = gScale(stats.session.combined);
    const pad = compact ? 4 : Math.max(18, Math.min(s.w, s.h) * 0.08);
    const R = Math.max(10, Math.min(s.w, s.h) / 2 - pad);
    const cx = s.w / 2;
    const cy = s.h / 2;
    const k = R / maxG;
    const toX = (lat: number) => cx - lat * k;
    const toY = (lon: number) => cy - lon * k;

    // Rings and axes.
    ctx.lineWidth = 1;
    for (let g = 0.5; g <= maxG + 1e-6; g += 0.5) {
      ctx.beginPath();
      ctx.arc(cx, cy, g * k, 0, Math.PI * 2);
      ctx.strokeStyle = Number.isInteger(g) ? THEME.lineStrong : THEME.line;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R);
    ctx.lineTo(cx, cy + R);
    ctx.strokeStyle = C.line;
    ctx.stroke();

    if (!compact) {
      const fs = Math.max(10, Math.min(14, R * 0.08));
      ctx.font = `600 ${fs}px ${C.font}`;
      ctx.fillStyle = C.dim;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ACEL.', cx, cy - R - fs * 0.9);
      ctx.fillText('FREIO', cx, cy + R + fs * 0.9);
      ctx.textAlign = 'right';
      ctx.fillText('ESQ.', cx - R - 4, cy - fs);
      ctx.textAlign = 'left';
      ctx.fillText('DIR.', cx + R + 4, cy - fs);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.faint;
      for (let g = 1; g <= maxG; g++) ctx.fillText(`${g} g`, cx + g * k + 3, cy + fs * 0.8);
    }

    // Peak ticks of this lap.
    const pk = stats.lap;
    ctx.strokeStyle = C.purple;
    ctx.lineWidth = compact ? 2 : 3;
    const tick = compact ? 4 : 8;
    const ticks: [number, number, boolean][] = [
      [toX(pk.left), cy, true],
      [toX(-pk.right), cy, true],
      [cx, toY(pk.accel), false],
      [cx, toY(-pk.brake), false],
    ];
    for (const [x, y, vertical] of ticks) {
      ctx.beginPath();
      if (vertical) {
        ctx.moveTo(x, y - tick);
        ctx.lineTo(x, y + tick);
      } else {
        ctx.moveTo(x - tick, y);
        ctx.lineTo(x + tick, y);
      }
      ctx.stroke();
    }

    // Trail.
    let px = Number.NaN;
    let py = Number.NaN;
    ctx.lineCap = 'round';
    ctx.lineWidth = compact ? 2 : 3;
    stats.forEachTrail((lat, lon, age) => {
      const x = toX(lat);
      const y = toY(lon);
      if (Number.isFinite(px)) {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(x, y);
        ctx.strokeStyle = withAlpha(THEME.accent, 0.85 * (1 - age));
        ctx.stroke();
      }
      px = x;
      py = y;
    });

    // Current dot.
    if (f) {
      const x = toX(Math.max(-maxG, Math.min(maxG, f.g.lateral)));
      const y = toY(Math.max(-maxG, Math.min(maxG, f.g.longitudinal)));
      ctx.beginPath();
      ctx.arc(x, y, compact ? 4 : Math.max(6, R * 0.045), 0, Math.PI * 2);
      ctx.fillStyle = C.text;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.accent;
      ctx.stroke();
    }
  };

  const size = useCanvasSize(canvasRef, () => draw(live.frame));
  useLiveRender((f) => draw(f));
  return (
    <canvas
      ref={canvasRef}
      className={`g-circle ${className}`}
      role="img"
      aria-label={uiText('Círculo de forças G')}
    />
  );
}
