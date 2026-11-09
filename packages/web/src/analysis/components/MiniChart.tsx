/** Small uPlot line chart (evolution over days): points + lines, custom x/y formatting. */

import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

export interface MiniSeries {
  label: string;
  color: string;
  values: (number | null)[];
  dash?: number[];
}

interface Props {
  xs: number[];
  series: MiniSeries[];
  height?: number;
  xLabel: (v: number) => string;
  yLabel: (v: number) => string;
  /** Draw a horizontal line at this y (e.g. 0 = reference). */
  zeroLine?: number | null;
}

const GRID = '#1a2229';
const AXIS = '#8592a0';
const FONT = '12px Bahnschrift, "DIN Alternate", "Roboto Condensed", "Arial Narrow", sans-serif';

export function MiniChart({ xs, series, height = 200, xLabel, yLabel, zeroLine = null }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const fmt = useRef({ xLabel, yLabel });
  fmt.current = { xLabel, yLabel };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = '';
    const opts: uPlot.Options = {
      width: el.clientWidth || 240,
      height,
      legend: { show: true, live: false },
      cursor: { drag: { x: false, y: false }, points: { size: 7 } },
      scales: { x: { time: false, range: (_u, min, max) => [min - 0.5, max + 0.5] } },
      axes: [
        {
          stroke: AXIS,
          font: FONT,
          grid: { stroke: GRID },
          ticks: { stroke: GRID },
          values: (_u, splits) => splits.map((v) => fmt.current.xLabel(v)),
        },
        {
          stroke: AXIS,
          font: FONT,
          size: 64,
          grid: { stroke: GRID },
          ticks: { stroke: GRID },
          values: (_u, splits) => splits.map((v) => fmt.current.yLabel(v)),
        },
      ],
      series: [
        { value: (_u, v) => (v === null ? '–' : fmt.current.xLabel(v)) },
        ...series.map((s) => ({
          label: s.label,
          stroke: s.color,
          width: 2,
          ...(s.dash ? { dash: s.dash } : {}),
          spanGaps: true,
          points: { show: true, size: 6, fill: s.color },
          value: (_u: uPlot, v: number | null) => (v === null ? '–' : fmt.current.yLabel(v)),
        })),
      ],
      hooks: {
        draw: [
          (u) => {
            if (zeroLine === null) return;
            const y = u.valToPos(zeroLine, 'y', true);
            if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) return;
            u.ctx.save();
            u.ctx.strokeStyle = '#46515c';
            u.ctx.setLineDash([4, 4]);
            u.ctx.beginPath();
            u.ctx.moveTo(u.bbox.left, y);
            u.ctx.lineTo(u.bbox.left + u.bbox.width, y);
            u.ctx.stroke();
            u.ctx.restore();
          },
        ],
      },
    };
    const plot = new uPlot(opts, [xs, ...series.map((s) => s.values)] as uPlot.AlignedData, el);
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (!w) return;
      if (Math.abs(plot.width - w) > 1) plot.setSize({ width: w, height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      plot.destroy();
    };
  }, [xs, series, height, zeroLine]);

  return <div className="a-minichart" ref={ref} />;
}
