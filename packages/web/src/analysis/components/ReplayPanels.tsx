/**
 * Pieces of the lap replay: the transport (play/pause, step, speed, time bar), the live readout
 * (speed, gear, rpm, brake, throttle, steering, delta) and the "o que acertou / o que errou" lists.
 * The transport and the readout follow the player at frame rate, so they are small and read the
 * player store directly.
 */

import { useSyncExternalStore } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import { formatDelta, formatFixed, formatGear, formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { THEME } from '../../lib/theme.ts';
import { timeTone } from '../lib/chartData.ts';
import {
  BIG_STEP_S,
  barFraction,
  type GhostMode,
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
  type ReplayFrame,
  type ReplayPlayer,
  STEP_S,
} from '../lib/replay.ts';
import type { ReplayFinding } from '../lib/replayFindings.ts';

const RAD_TO_DEG = 180 / Math.PI;

export function speedLabel(s: number): string {
  return `${formatFixed(s, s === 0.25 ? 2 : s === 0.5 ? 1 : 0)}×`;
}

export const usePlayer = (player: ReplayPlayer) =>
  useSyncExternalStore(player.subscribe, player.getState);

// ---------------------------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------------------------

export interface TimeTick {
  timeS: number;
  tone: ReplayFinding['tone'];
}

export function Transport({
  player,
  frameAt,
  ticks,
}: {
  player: ReplayPlayer;
  frameAt: (timeS: number) => ReplayFrame;
  ticks: TimeTick[];
}) {
  const s = usePlayer(player);
  const frame = frameAt(s.timeS);
  const step = (dir: 1 | -1, e: { shiftKey: boolean }) => {
    player.pause();
    player.step(dir * (e.shiftKey ? BIG_STEP_S : STEP_S));
  };
  const atEnd = s.timeS >= player.durationS;
  return (
    <div className="rp-transport">
      <div className="rp-buttons">
        <button
          type="button"
          className="ui-btn rp-play"
          onClick={() => player.toggle()}
          aria-label={
            s.playing ? uiText('Pausar') : atEnd ? uiText('Rever a volta') : uiText('Tocar')
          }
          aria-keyshortcuts="Space"
        >
          <Icon name={s.playing ? 'pause' : 'play'} size={22} />
          <span className="rp-play-text">
            {s.playing ? uiText('Pausar') : atEnd ? uiText('Rever') : uiText('Tocar')}
          </span>
        </button>
        <button
          type="button"
          className="ui-btn rp-step"
          data-variant="secondary"
          onClick={(e) => step(-1, e)}
          aria-label={uiText('Voltar 0,1 s (Shift: 1 s)')}
          aria-keyshortcuts="ArrowLeft"
        >
          <Icon name="back" size={20} />
        </button>
        <button
          type="button"
          className="ui-btn rp-step"
          data-variant="secondary"
          onClick={(e) => step(1, e)}
          aria-label={uiText('Avançar 0,1 s (Shift: 1 s)')}
          aria-keyshortcuts="ArrowRight"
        >
          <Icon name="chevron-right" size={20} />
        </button>
        <button
          type="button"
          className="ui-btn rp-restart"
          data-variant="ghost"
          onClick={() => {
            player.pause();
            player.seek(0);
          }}
        >
          {uiText('Início')}
        </button>
        <fieldset className="ui-segmented rp-speeds" aria-label={uiText('Velocidade do replay')}>
          {PLAYBACK_SPEEDS.map((v: PlaybackSpeed) => (
            <button
              key={v}
              type="button"
              aria-pressed={s.speed === v}
              onClick={() => player.setSpeed(v)}
            >
              {speedLabel(v)}
            </button>
          ))}
        </fieldset>
      </div>
      <div className="rp-scrub-row">
        <span className="rp-time num">{formatLapTime(s.timeS * 1000)}</span>
        <div className="rp-scrub-wrap">
          <input
            type="range"
            className="rp-scrub"
            min={0}
            max={player.durationS}
            step={STEP_S}
            value={s.timeS}
            onChange={(e) => player.seek(Number(e.target.value))}
            aria-label={uiText('Posição na volta')}
            aria-valuetext={uiText(
              '{0} de {1}, {2} m',
              formatLapTime(s.timeS * 1000),
              formatLapTime(player.durationS * 1000),
              Math.round(frame.subject.distanceM),
            )}
          />
          <span className="rp-ticks" aria-hidden="true">
            {ticks.map((t) => (
              <i
                key={`${t.tone}:${t.timeS}`}
                className="rp-tick"
                data-tone={t.tone}
                style={{ left: `${(t.timeS / player.durationS) * 100}%` }}
              />
            ))}
          </span>
        </div>
        <span className="rp-time rp-time-end num">{formatLapTime(player.durationS * 1000)}</span>
      </div>
      <p className="ui-help rp-keys">
        {uiText(
          'Teclado: Espaço toca/pausa · ← → passo de 0,1 s (Shift: 1 s) · [ ] velocidade · G alterna distância/tempo',
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Readout
// ---------------------------------------------------------------------------------------------

function Bar({
  fraction,
  tone,
  ghost,
}: {
  fraction: number | null;
  tone: 'brake' | 'throttle';
  ghost: number | null;
}) {
  return (
    <span className="rp-bar" data-tone={tone} aria-hidden="true">
      <i style={{ width: `${(fraction ?? 0) * 100}%` }} />
      {ghost !== null && <b style={{ left: `${ghost * 100}%` }} />}
    </span>
  );
}

/** Centered bar: fills to the left or right of the middle by the steering angle. */
function SteerBar({ fraction, sign }: { fraction: number | null; sign: number }) {
  const w = (fraction ?? 0) * 50;
  return (
    <span className="rp-bar rp-bar-steer" aria-hidden="true">
      <i style={{ width: `${w}%`, left: sign < 0 ? `${50 - w}%` : '50%' }} />
    </span>
  );
}

const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)}%`);
const deg = (v: number | null) => (v === null ? '–' : `${Math.round(v * RAD_TO_DEG)}°`);
const num = (v: number | null, d = 0) => (v === null ? '–' : formatFixed(v, d));

export function Readout({
  player,
  frameAt,
  hasRpm,
  steerFullRad,
  mode,
  subjectLabel,
  ghostLabel,
}: {
  player: ReplayPlayer;
  frameAt: (timeS: number) => ReplayFrame;
  hasRpm: boolean;
  /** Steering angle (rad) that fills the bar. */
  steerFullRad: number;
  mode: GhostMode;
  subjectLabel: string;
  ghostLabel: string | null;
}) {
  const s = usePlayer(player);
  const f = frameAt(s.timeS);
  const v = f.subject.values;
  const g = f.ghost?.values ?? null;
  const steer = v.steering ?? null;
  const gap = f.gap;

  return (
    <fieldset className="rp-readout" aria-label={uiText('Leitura no instante do replay')}>
      <div className="rp-readout-head">
        <span className="rp-who" style={{ color: THEME.chart1 }}>
          {subjectLabel}
        </span>
        {ghostLabel && (
          <span className="rp-who" style={{ color: THEME.chart2 }}>
            {ghostLabel}
          </span>
        )}
      </div>

      {gap && (
        <div className="rp-delta" data-tone={timeTone(gap.deltaS * 1000, 5)}>
          <span className="rp-k">{uiText('Delta contra a referência')}</span>
          <span className="rp-delta-v num">{formatDelta(gap.deltaS * 1000)} s</span>
          <span className="rp-delta-sub">
            {gap.deltaS > 0.005
              ? uiText('mais lento neste ponto da volta')
              : gap.deltaS < -0.005
                ? uiText('mais rápido neste ponto da volta')
                : uiText('igual à referência')}
            {mode === 'time' && Math.abs(gap.gapM) >= 0.5 && (
              <>
                {' · '}
                {gap.gapM > 0
                  ? uiText('{0} m à frente da referência', Math.round(gap.gapM))
                  : uiText('{0} m atrás da referência', Math.round(-gap.gapM))}
              </>
            )}
          </span>
        </div>
      )}

      <dl className="rp-grid">
        <div className="rp-cell">
          <dt className="rp-k">{uiText('Velocidade')}</dt>
          <dd className="rp-v num">
            {num(v.speed ?? null)}
            <small> km/h</small>
          </dd>
          {g && <dd className="rp-g num">{num(g.speed ?? null)}</dd>}
        </div>
        <div className="rp-cell">
          <dt className="rp-k">{uiText('Marcha')}</dt>
          <dd className="rp-v num">{formatGear(v.gear ?? null)}</dd>
          {g && <dd className="rp-g num">{formatGear(g.gear ?? null)}</dd>}
        </div>
        {hasRpm && (
          <div className="rp-cell">
            <dt className="rp-k">{uiText('Rotação')}</dt>
            <dd className="rp-v num">
              {num(v.rpm ?? null)}
              <small> rpm</small>
            </dd>
            {g && <dd className="rp-g num">{num(g.rpm ?? null)}</dd>}
          </div>
        )}
        <div className="rp-cell">
          <dt className="rp-k">{uiText('Distância')}</dt>
          <dd className="rp-v num">
            {Math.round(f.subject.distanceM)}
            <small> m</small>
          </dd>
          {f.ghost && mode === 'time' && (
            <dd className="rp-g num">{Math.round(f.ghost.distanceM)}</dd>
          )}
        </div>
      </dl>

      <div className="rp-pedals">
        <div className="rp-pedal">
          <span className="rp-k">{uiText('Freio')}</span>
          <span className="rp-pv num">{pct(v.brake ?? null)}</span>
          <Bar
            tone="brake"
            fraction={barFraction(v.brake ?? null, 1)}
            ghost={g ? barFraction(g.brake ?? null, 1) : null}
          />
          {g && <span className="rp-g num">{pct(g.brake ?? null)}</span>}
        </div>
        <div className="rp-pedal">
          <span className="rp-k">{uiText('Acelerador')}</span>
          <span className="rp-pv num">{pct(v.throttle ?? null)}</span>
          <Bar
            tone="throttle"
            fraction={barFraction(v.throttle ?? null, 1)}
            ghost={g ? barFraction(g.throttle ?? null, 1) : null}
          />
          {g && <span className="rp-g num">{pct(g.throttle ?? null)}</span>}
        </div>
        <div className="rp-pedal">
          <span className="rp-k">{uiText('Volante')}</span>
          <span className="rp-pv num">{deg(steer)}</span>
          <SteerBar fraction={barFraction(steer, steerFullRad)} sign={steer ?? 0} />
          {g && <span className="rp-g num">{deg(g.steering ?? null)}</span>}
        </div>
      </div>
      {g && (
        <p className="ui-help rp-g-note">
          {uiText(
            'Em roxo, a referência no mesmo ponto ({0}).',
            mode === 'time' ? uiText('mesmo tempo') : uiText('mesma distância'),
          )}
        </p>
      )}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------------------------

const TONE_TAG: Record<ReplayFinding['tone'], () => string> = {
  bad: () => uiText('Errou'),
  good: () => uiText('Acertou'),
  info: () => uiText('Confira'),
};

export function FindingList({
  findings,
  selectedId,
  empty,
  timeOf,
  onOpen,
}: {
  findings: ReplayFinding[];
  selectedId: string | null;
  empty: string;
  timeOf: (distanceM: number) => number;
  onOpen: (f: ReplayFinding) => void;
}) {
  if (findings.length === 0) return <p className="dim rp-empty">{empty}</p>;
  return (
    <ul className="rp-findings">
      {findings.map((f) => (
        <li key={f.id}>
          <button
            type="button"
            className="rp-finding"
            data-tone={f.tone}
            aria-current={f.id === selectedId ? 'true' : undefined}
            onClick={() => onOpen(f)}
          >
            <span className="rp-finding-head">
              <span
                className="ui-badge"
                data-tone={f.tone === 'good' ? 'gain' : f.tone === 'bad' ? 'loss' : 'warn'}
              >
                {TONE_TAG[f.tone]()}
              </span>
              <strong>{f.title}</strong>
            </span>
            <span className="rp-finding-detail">{f.detail}</span>
            <span className="rp-finding-at num">
              {formatLapTime(timeOf(f.distanceM) * 1000)} · {Math.round(f.distanceM)} m ·{' '}
              {uiText('Ir para este ponto')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
