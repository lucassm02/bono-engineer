import { useMemo, useRef } from 'react';
import { setAttr, setStyle, setText } from '../lib/dom.ts';
import { clamp, formatFixed } from '../lib/format.ts';
import { fuelPlan } from '../lib/fuel.ts';
import { t as uiText } from '../lib/i18n.ts';
import { useLiveRender } from '../live/raf.ts';
import { useSessionLaps } from '../state/sessionStore.ts';

const WARN_SLOTS = [0, 1, 2] as const;
const HISTORY_LAPS = 10;

function FuelHistory() {
  const laps = useSessionLaps((s) => s.laps);
  const bars = useMemo(
    () => laps.filter((l) => l.fuelUsedL !== null && l.fuelUsedL > 0).slice(-HISTORY_LAPS),
    [laps],
  );
  if (bars.length === 0) {
    return (
      <div className="fuel-history-empty dim">
        {uiText('Consumo por volta aparece após a 1ª volta')}
      </div>
    );
  }
  const max = Math.max(...bars.map((b) => b.fuelUsedL ?? 0));
  const avg = bars.reduce((a, b) => a + (b.fuelUsedL ?? 0), 0) / bars.length;
  return (
    <div className="fuel-history" role="img" aria-label={uiText('Consumo por volta')}>
      {bars.map((b) => (
        <div className="fuel-hbar" key={b.lapId} data-valid={b.valid ? '1' : '0'}>
          <span className="num fuel-hval">{formatFixed(b.fuelUsedL, 2)}</span>
          <div className="fuel-hcol">
            <div
              className="fuel-hfill"
              style={{ height: `${(((b.fuelUsedL ?? 0) / max) * 100).toFixed(1)}%` }}
              data-high={(b.fuelUsedL ?? 0) > avg * 1.04 ? '1' : '0'}
            />
          </div>
          <span className="num dim fuel-hlap">V{b.lapNumber}</span>
        </div>
      ))}
    </div>
  );
}

export function CombustivelView() {
  const r = useRef<Record<string, HTMLElement | null>>({});
  const set = (k: string) => (el: HTMLElement | null) => {
    r.current[k] = el;
  };
  const regenMax = useRef(1);

  useLiveRender((f) => {
    const e = r.current;
    const p = fuelPlan(f.fuel, f.lap, f.lapFraction);
    setStyle(e.gaugeFill, 'transform', `scaleY(${clamp(p.fraction, 0, 1).toFixed(3)})`);
    setAttr(
      e.gauge,
      'data-level',
      p.missing && p.missing > 0.05
        ? 'error'
        : p.lapsOfFuel !== null && p.lapsOfFuel < 2
          ? 'warn'
          : 'ok',
    );
    if (p.needed !== null) {
      setAttr(e.gaugeNeed, 'data-show', '1');
      setStyle(e.gaugeNeed, 'bottom', `${(clamp(p.needed / p.capacity, 0, 1) * 100).toFixed(1)}%`);
    } else setAttr(e.gaugeNeed, 'data-show', '0');
    setText(e.level, formatFixed(p.level, 1));
    setText(e.pct, `${Math.round(p.fraction * 100)}% do tanque`);
    setText(e.laps, p.lapsOfFuel === null ? '–' : formatFixed(p.lapsOfFuel, 1));
    setText(e.perLap, p.perLap === null ? '–' : formatFixed(p.perLap, 2));
    setText(e.raceLeft, p.raceLapsLeft === null ? '–' : formatFixed(p.raceLapsLeft, 1));
    setText(e.needed, p.needed === null ? '–' : formatFixed(p.needed, 1));
    const short = p.missing !== null && p.missing > 0.05;
    setText(e.balanceLabel, short ? uiText('Faltam') : uiText('Sobram'));
    setText(
      e.balance,
      p.missing === null ? '–' : short ? formatFixed(p.missing, 1) : formatFixed(p.surplus, 1),
    );
    setAttr(e.balanceBox, 'data-tone', p.missing === null ? 'neutral' : short ? 'loss' : 'gain');
    setText(
      e.save,
      p.savePerLap === null ? '' : `economize ${formatFixed(p.savePerLap, 2)} L/volta`,
    );
    for (const i of WARN_SLOTS) {
      const w = p.warnings[i];
      setAttr(e[`w${i}`], 'data-level', w ? w.level : 'none');
      setText(e[`w${i}`], w ? w.text : '');
    }
    const regen = f.fuel.energyRecovery;
    setAttr(e.regenBox, 'data-show', regen === null ? '0' : '1');
    if (regen !== null) {
      regenMax.current = Math.max(regenMax.current, regen);
      setText(e.regen, formatFixed(regen, 1));
      setStyle(
        e.regenFill,
        'transform',
        `scaleX(${clamp(regen / regenMax.current, 0, 1).toFixed(3)})`,
      );
    }
  });

  return (
    <div className="view combustivel">
      <div className="fuel-gauge" ref={set('gauge')} data-level="ok" aria-hidden="true">
        <div className="fuel-gauge-fill" ref={set('gaugeFill')} />
        <div className="fuel-gauge-need" ref={set('gaugeNeed')} data-show="0">
          <span>{uiText('até o fim')}</span>
        </div>
      </div>
      <div className="fuel-main">
        <div className="fuel-big">
          <span className="num fuel-big-value" ref={set('laps')}>
            –
          </span>
          <span className="readout-label">{uiText('voltas de combustível')}</span>
        </div>
        <div className="fuel-level">
          <span className="num fuel-level-value">
            <span ref={set('level')}>–</span>
            <small> L</small>
          </span>
          <span className="dim fuel-pct" ref={set('pct')} />
        </div>
      </div>
      <div className="fuel-stats">
        <div className="stat">
          <span className="readout-label">{uiText('Média por volta')}</span>
          <span className="stat-value num">
            <span ref={set('perLap')}>–</span>
            <small> L</small>
          </span>
        </div>
        <div className="stat">
          <span className="readout-label">{uiText('Voltas até o fim')}</span>
          <span className="stat-value num" ref={set('raceLeft')}>
            –
          </span>
        </div>
        <div className="stat">
          <span className="readout-label">{uiText('Necessário até o fim')}</span>
          <span className="stat-value num">
            <span ref={set('needed')}>–</span>
            <small> L</small>
          </span>
        </div>
        <div className="stat fuel-balance" ref={set('balanceBox')} data-tone="neutral">
          <span className="readout-label" ref={set('balanceLabel')}>
            {uiText('Sobram')}
          </span>
          <span className="stat-value num">
            <span ref={set('balance')}>–</span>
            <small> L</small>
          </span>
          <span className="dim fuel-save" ref={set('save')} />
        </div>
      </div>
      <div className="fuel-side">
        <div className="fuel-warnings" aria-live="polite">
          {WARN_SLOTS.map((i) => (
            <div key={i} className="fuel-warning" ref={set(`w${i}`)} data-level="none" />
          ))}
        </div>
        <div className="fuel-regen" ref={set('regenBox')} data-show="0">
          <span className="readout-label">{uiText('Recuperação de energia')}</span>
          <div className="fuel-regen-row">
            <div className="fuel-regen-track">
              <div className="fuel-regen-fill" ref={set('regenFill')} />
            </div>
            <span className="num" ref={set('regen')} />
          </div>
        </div>
        <FuelHistory />
      </div>
    </div>
  );
}
