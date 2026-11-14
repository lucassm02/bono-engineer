/**
 * The pre-race screen of the game (state 'replay'): the console plays a lap with the chosen car
 * while the driver picks the setup. The car it shows is not being driven, so the live widgets
 * (gears, pedals, map) say nothing: this panel takes their place with the three things worth
 * confirming before the start: the track (it is already being recognised from the car in the
 * background; one tap changes it), the car and the tyres. The tyre is what the wear estimate
 * needs; the packet does not carry it. Quiet on purpose: small type, no frame-rate updates.
 */

import { useEffect } from 'react';
import { t as uiText } from '../lib/i18n.ts';
import { barTrackView, carText, trackLine } from '../lib/liveContext.ts';
import {
  compoundLabel,
  defaultOfGroup,
  groupOf,
  hardnessLabel,
  TYRE_GROUPS,
} from '../lib/tyres.ts';
import {
  chooseTyre,
  ensureSavedTracks,
  openTrackPicker,
  useLiveContext,
  useSavedTracks,
} from '../state/liveContext.ts';
import { useUi } from '../state/uiStore.ts';
import '../styles/prerace.css';

export function PreRaceScreen() {
  const liveState = useUi((s) => s.liveState);
  const active = liveState === 'replay';
  const ctx = useLiveContext((s) => s.ctx);
  const carCode = useLiveContext((s) => s.carCode);
  const tyre = useLiveContext((s) => s.tyre);
  const savedCount = useSavedTracks((s) => s.tracks?.length ?? 0);

  useEffect(() => {
    if (active) void ensureSavedTracks();
  }, [active]);

  if (!active) return null;

  const track = barTrackView({ ctx, sessionOpen: false, hasSavedTracks: savedCount > 0 });
  const car = carText(carCode);
  const group = groupOf(tyre);
  const trackKnown = !!ctx?.name;

  return (
    <section className="prerace" data-no-gesture aria-label={uiText('Pré-corrida')}>
      <div className="pr-inner">
        <p className="pr-eyebrow">{uiText('Pré-corrida')}</p>

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

        {car && (
          <div className="pr-block">
            <span className="pr-label">{uiText('Carro')}</span>
            <div className="pr-line">
              <span className="pr-value">{car}</span>
            </div>
          </div>
        )}

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
          <p className="pr-hint">
            {tyre
              ? uiText('Estimo o desgaste pela temperatura, pela carga e pelo tipo de pneu.')
              : uiText('Sem escolher, estimo o desgaste como se fosse Esportivo Médio.')}
          </p>
        </div>
      </div>
    </section>
  );
}
