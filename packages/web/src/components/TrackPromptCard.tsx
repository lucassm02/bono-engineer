/**
 * "Qual pista hoje?" (spec 06): the card of the menu screen, shown while the game is in a menu,
 * before the car is on the track. Up to 4 recent tracks (thumbnail and the reference the engineer
 * would use), "Outra pista…" (the full sheet) and "Reconhecer sozinho". Once a track is chosen it
 * becomes a one-line summary. Not shown without saved tracks, in the demo, in a replay, after
 * "Reconhecer sozinho" or with "Perguntar a pista ao começar" off.
 */

import { useEffect, useMemo } from 'react';
import { t as uiText } from '../lib/i18n.ts';
import { recentEntries, trackLine, trackPromptAllowed } from '../lib/liveContext.ts';
import {
  chooseTrack,
  ensureSavedTracks,
  neverAskTrack,
  openTrackPicker,
  skipTrackPrompt,
  useLiveContext,
  usePromptGate,
  useSavedTracks,
} from '../state/liveContext.ts';
import { addNotice } from '../state/uiStore.ts';
import { TrackRow } from './TrackPickerSheet.tsx';

export function TrackPromptCard() {
  const gate = usePromptGate();
  const tracks = useSavedTracks((s) => s.tracks);
  const ctx = useLiveContext((s) => s.ctx);
  const carCode = useLiveContext((s) => s.carCode);

  useEffect(() => {
    void ensureSavedTracks();
  }, []);

  const entries = useMemo(() => recentEntries(tracks ?? [], carCode, 4), [tracks, carCode]);
  if (!trackPromptAllowed(gate)) return null;

  const hint = ctx?.hint ?? null;
  if (hint) {
    // the name of the chosen track (the open session may be on another one)
    const chosen = tracks?.find((t) => t.id === hint.trackId);
    const name = chosen
      ? trackLine(chosen.name, chosen.layout)
      : trackLine(ctx?.name ?? null, ctx?.layout ?? null);
    return (
      <section
        className="lc-card lc-card-chosen"
        aria-label={uiText('Pista de hoje')}
        data-no-gesture
      >
        <strong>{uiText('Pista de hoje: {0}', name)}</strong>
        <span className="lc-card-actions">
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            data-size="sm"
            onClick={() => openTrackPicker('choose')}
          >
            {uiText('Trocar')}
          </button>
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => void chooseTrack(null)}
          >
            {uiText('Reconhecer sozinho')}
          </button>
        </span>
      </section>
    );
  }

  return (
    <section className="lc-card" aria-labelledby="lc-card-title" data-no-gesture>
      <h2 id="lc-card-title">{uiText('Qual pista hoje?')}</h2>
      <p>
        {uiText(
          'Diga onde vai treinar e o engenheiro já ajuda na primeira volta. Se preferir, eu reconheço sozinho.',
        )}
      </p>
      <div className="lc-card-list">
        {entries.map((e) => (
          <TrackRow
            key={e.track.id}
            entry={e}
            selected={false}
            compact
            onPick={() => {
              void chooseTrack(e.track.id);
              addNotice(
                'info',
                uiText('Pista de hoje: {0}', trackLine(e.track.name, e.track.layout)),
                3000,
              );
            }}
          />
        ))}
      </div>
      <div className="lc-card-actions">
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          onClick={() => openTrackPicker('choose')}
        >
          {uiText('Outra pista…')}
        </button>
        <button type="button" className="ui-btn" data-variant="ghost" onClick={skipTrackPrompt}>
          {uiText('Reconhecer sozinho')}
        </button>
        <button type="button" className="ui-btn" data-variant="ghost" onClick={neverAskTrack}>
          {uiText('Não perguntar mais')}
        </button>
      </div>
    </section>
  );
}
