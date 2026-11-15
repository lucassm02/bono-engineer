/**
 * The game uses the same signal for replays and the background lap in the pre-race menu.
 * Default to the track and tyre controls, with an action to see the replay telemetry.
 */

import { MAX_WEAR_MULTIPLIER } from '@gt7/shared';
import { useEffect } from 'react';
import { t as uiText } from '../lib/i18n.ts';
import { barTrackView, trackLine } from '../lib/liveContext.ts';
import {
  compoundLabel,
  defaultOfGroup,
  groupOf,
  hardnessLabel,
  TYRE_GROUPS,
} from '../lib/tyres.ts';
import {
  chooseTyre,
  chooseWearRate,
  ensureSavedTracks,
  openTrackPicker,
  useLiveContext,
  useSavedTracks,
} from '../state/liveContext.ts';
import { useUi } from '../state/uiStore.ts';
import { Icon } from './ui/Icon.tsx';
import '../styles/prerace.css';

export function PreRaceScreen() {
  const ctx = useLiveContext((s) => s.ctx);
  const tyre = useLiveContext((s) => s.tyre);
  const wearRate = useLiveContext((s) => s.wearRate);
  const savedCount = useSavedTracks((s) => s.tracks?.length ?? 0);

  useEffect(() => {
    void ensureSavedTracks();
  }, []);

  const track = barTrackView({ ctx, sessionOpen: false, hasSavedTracks: savedCount > 0 });
  const group = groupOf(tyre);
  const trackKnown = !!ctx?.name;

  return (
    <section className="prerace" data-no-gesture aria-label={uiText('Pré-corrida')}>
      <div className="pr-inner">
        <div className="pr-head">
          <p className="pr-eyebrow">{uiText('Pré-corrida')}</p>
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            data-size="sm"
            onClick={() => useUi.setState({ showReplayTelemetry: true })}
          >
            <Icon name="play" size={15} />
            {uiText('Ver telemetria do replay')}
          </button>
        </div>

        <div className="pr-block">
          <span className="pr-label">{uiText('Pista')}</span>
          <div className="pr-line">
            <span
              className="ui-dot"
              data-tone={trackKnown ? 'gain' : undefined}
              data-pulse={track.pulse ? '1' : '0'}
              aria-hidden="true"
            />
            <span className="pr-value">
              {trackKnown ? trackLine(ctx?.name ?? null, ctx?.layout ?? null) : track.label}
            </span>
            {trackKnown && ctx?.confidence !== 'confirmed' && (
              <span className="pr-note">{uiText('provável')}</span>
            )}
            {track.action && (
              <button
                type="button"
                className="pr-link"
                data-no-gesture
                onClick={() => openTrackPicker('choose')}
              >
                {uiText('Trocar')}
              </button>
            )}
          </div>
          {!trackKnown && (
            <p className="pr-hint">{uiText('Reconheço a pista pelo carro que roda ao fundo.')}</p>
          )}
        </div>

        <div className="pr-block">
          <span className="pr-label">
            {uiText('Pneus')}
            {tyre && <span className="pr-chosen">{` · ${compoundLabel(tyre)}`}</span>}
          </span>
          <fieldset className="pr-chips" aria-label={uiText('Tipo de pneu')}>
            {TYRE_GROUPS.map((g) => {
              const on = group?.id === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  className="pr-chip"
                  data-on={on ? '1' : '0'}
                  data-no-gesture
                  onClick={() => void chooseTyre(on ? null : defaultOfGroup(g))}
                >
                  {g.label()}
                </button>
              );
            })}
          </fieldset>
          {group && group.compounds.length > 1 && (
            <fieldset className="pr-chips" aria-label={uiText('Dureza do pneu')}>
              {group.compounds.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={c === tyre}
                  className="pr-chip"
                  data-on={c === tyre ? '1' : '0'}
                  data-no-gesture
                  onClick={() => void chooseTyre(c)}
                >
                  {hardnessLabel(c)}
                </button>
              ))}
            </fieldset>
          )}
          <label className="pr-rate" data-no-gesture>
            <span className="pr-rate-label">{uiText('Desgaste do jogo')}</span>
            <input
              type="range"
              className="pr-slider"
              min={0}
              max={MAX_WEAR_MULTIPLIER}
              step={1}
              value={wearRate}
              data-no-gesture
              aria-label={uiText('Multiplicador de desgaste dos pneus')}
              aria-valuetext={wearRate === 0 ? uiText('Desgaste desativado') : `×${wearRate}`}
              onChange={(e) => void chooseWearRate(Number(e.target.value))}
            />
            <span className="pr-rate-value num">{`×${wearRate}`}</span>
          </label>
          <p className="pr-hint">
            {wearRate === 0
              ? uiText('Desgaste desativado')
              : tyre
                ? uiText('Estimo o desgaste pela temperatura, pela carga e pelo tipo de pneu.')
                : uiText('Sem escolher, estimo o desgaste como se fosse Esportivo Médio.')}
          </p>
        </div>
      </div>
    </section>
  );
}
