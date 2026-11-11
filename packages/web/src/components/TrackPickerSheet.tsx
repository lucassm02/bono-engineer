/**
 * "Pista de hoje" (specs 05 and 06): one sheet for the two things a driver may want to tell the
 * app about the track.
 *  - choose: "em que pista vou treinar?" — saved tracks by recent use (tracks with laps of the
 *    current car first), search by name, the reference the engineer would use. The choice is a
 *    hint: the engineer starts on lap 1 and the first closed lap checks it.
 *  - name: "qual pista é esta?" — the track the app has just learned is still called "Pista
 *    desconhecida N": up to 3 one-click suggestions (the shipped layouts that match the driven
 *    line), a search over the 122 layouts, "Outra pista…" and "Agora não".
 * Only opens with the car stopped, paused or in a menu, and closes itself if the car starts moving.
 */

import type { TrackRecognitionCandidate } from '@gt7/shared';
import { useEffect, useMemo, useState } from 'react';
import {
  candidateTitle,
  saveTrackName,
  useTrackSuggestions,
} from '../analysis/components/TrackNaming.tsx';
import { thumbPath } from '../analysis/components/TrackThumb.tsx';
import { formatKm, normalizeText } from '../analysis/lib/history.ts';
import { resolveTyped, searchCatalog } from '../analysis/lib/trackSuggest.ts';
import { trackDisplayName } from '../data/gt7Tracks.ts';
import { useSafeToPrompt } from '../hooks/useSafeToPrompt.ts';
import { t as uiText } from '../lib/i18n.ts';
import { carText, type PickerEntry, pickerEntries, trackLine } from '../lib/liveContext.ts';
import {
  chooseTrack,
  closeTrackPicker,
  ensureSavedTracks,
  neverAskTrack,
  skipTrackPrompt,
  useLiveContext,
  useSavedTracks,
} from '../state/liveContext.ts';
import { addNotice, useUi } from '../state/uiStore.ts';
import { Icon } from './ui/Icon.tsx';
import { Modal } from './ui/Modal.tsx';

export function TrackPickerSheet() {
  const mode = useLiveContext((s) => s.picker);
  const safe = useSafeToPrompt();

  // never leave the sheet open under a moving car
  useEffect(() => {
    if (mode && !safe) {
      closeTrackPicker();
      addNotice('info', uiText('Disponível quando você parar'), 2500);
    }
  }, [mode, safe]);

  return (
    <Modal
      open={mode !== null && safe}
      onClose={closeTrackPicker}
      size="md"
      className="lc-sheet"
      title={uiText('Pista de hoje')}
      subtitle={
        mode === 'name'
          ? uiText('Dê o nome da pista que acabei de aprender.')
          : uiText('Diga onde vai treinar e o engenheiro já começa na primeira volta.')
      }
    >
      {mode === 'choose' && <ChooseTrack />}
      {mode === 'name' && <NameTrack />}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Choose a saved track
// ---------------------------------------------------------------------------------------------

function MiniThumb({ line }: { line: { x: number[]; z: number[] } | null }) {
  const p = useMemo(() => (line ? thumbPath(line, 100, 10) : null), [line]);
  return (
    <svg className="lc-thumb" viewBox="0 0 100 100" aria-hidden="true">
      {p ? (
        <>
          <path d={p.d} className="lc-thumb-line" />
          <circle cx={p.start.x} cy={p.start.y} r="4" className="lc-thumb-start" />
        </>
      ) : null}
    </svg>
  );
}

export function TrackRow({
  entry,
  selected,
  onPick,
  compact = false,
}: {
  entry: PickerEntry;
  selected: boolean;
  onPick: () => void;
  compact?: boolean;
}) {
  const { track, reference } = entry;
  return (
    <button
      type="button"
      className="ui-list-item lc-pick"
      data-compact={compact ? '1' : '0'}
      aria-current={selected ? 'true' : undefined}
      onClick={onPick}
    >
      <MiniThumb line={track.thumb} />
      <span className="ui-list-text">
        <span className="ui-list-title">{trackLine(track.name, track.layout)}</span>
        <span className="ui-list-desc num">
          {formatKm(track.lengthM)}
          {track.lapCount > 0 ? ` · ${laps(track.lapCount)}` : ''}
        </span>
        <span className="lc-pick-ref" data-kind={reference.kind}>
          {reference.text}
        </span>
      </span>
      {selected && <Icon name="check" size={18} className="lc-pick-check" />}
    </button>
  );
}

const laps = (n: number) => `${n} ${n === 1 ? uiText('volta') : uiText('voltas')}`;

function ChooseTrack() {
  const tracks = useSavedTracks((s) => s.tracks);
  const ctx = useLiveContext((s) => s.ctx);
  const carCode = useLiveContext((s) => s.carCode);
  const askOnStart = useUi((s) => s.profile.askTrackOnStart);
  const [query, setQuery] = useState('');
  const entries = useMemo(
    () => pickerEntries(tracks ?? [], carCode, query),
    [tracks, carCode, query],
  );
  const car = carText(carCode);
  const selectedId = ctx?.hint?.trackId ?? null;

  useEffect(() => {
    void ensureSavedTracks();
  }, []);

  const pick = (id: string) => {
    closeTrackPicker();
    void chooseTrack(id);
    const t = tracks?.find((x) => x.id === id);
    if (t) addNotice('info', uiText('Pista de hoje: {0}', trackLine(t.name, t.layout)), 3000);
  };

  return (
    <div className="lc-sheet-body">
      {car && <p className="lc-sheet-car">{uiText('Carro: {0}', car)}</p>}
      {tracks && tracks.length > 5 && (
        <label className="lc-search">
          <Icon name="search" size={18} />
          <input
            className="ui-input"
            type="search"
            value={query}
            placeholder={uiText('Buscar pista')}
            aria-label={uiText('Buscar pista')}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      )}
      {tracks === null && <p className="lc-muted">{uiText('Carregando as suas pistas…')}</p>}
      {tracks && tracks.length === 0 && (
        <div className="ui-empty">
          <strong>{uiText('Nenhuma pista salva ainda')}</strong>
          <p>{uiText('Eu reconheço a pista sozinho quando você fechar a primeira volta.')}</p>
        </div>
      )}
      {tracks && tracks.length > 0 && entries.length === 0 && (
        <p className="lc-muted">{uiText('Nenhuma pista com esse nome.')}</p>
      )}
      {entries.length > 0 && (
        <ul className="ui-list lc-list">
          {entries.map((e) => (
            <li key={e.track.id}>
              <TrackRow
                entry={e}
                selected={e.track.id === selectedId}
                onPick={() => pick(e.track.id)}
              />
            </li>
          ))}
        </ul>
      )}
      <div className="lc-sheet-foot">
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          onClick={() => {
            closeTrackPicker();
            skipTrackPrompt();
          }}
        >
          {uiText('Reconhecer sozinho')}
        </button>
        {askOnStart && (
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            onClick={() => {
              closeTrackPicker();
              neverAskTrack();
              addNotice(
                'info',
                uiText('Não vou mais perguntar. Dá para mudar em Configurações → Engenheiro.'),
                5000,
              );
            }}
          >
            {uiText('Não perguntar mais')}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Name the track the app just learned
// ---------------------------------------------------------------------------------------------

function NameTrack() {
  const ctx = useLiveContext((s) => s.ctx);
  const tracks = useSavedTracks((s) => s.tracks);
  const trackId = ctx?.trackId ?? null;
  const known = tracks?.find((t) => t.id === trackId) ?? null;

  useEffect(() => {
    void ensureSavedTracks(true);
  }, []);

  if (!trackId) {
    return <p className="lc-muted">{uiText('Ainda não aprendi nenhuma pista nesta sessão.')}</p>;
  }
  if (!known) return <p className="lc-muted">{uiText('Carregando…')}</p>;
  return <NameForm trackId={trackId} lengthM={known.lengthM} />;
}

function NameForm({ trackId, lengthM }: { trackId: string; lengthM: number }) {
  const { suggestions, loading, byGeometry, needsCare } = useTrackSuggestions(trackId, lengthM);
  const [busy, setBusy] = useState(false);
  const [other, setOther] = useState(false);
  const [text, setText] = useState('');
  const typed = useMemo(
    () => (text.trim() ? searchCatalog(text, lengthM, undefined, 6) : []),
    [text, lengthM],
  );
  const showOther = other || (!loading && suggestions.length === 0);

  const save = async (name: string, layout: string | null) => {
    setBusy(true);
    const ok = await saveTrackName(trackId, name, layout);
    setBusy(false);
    if (!ok) return;
    addNotice('info', uiText('Pista salva como “{0}”.', name), 4000);
    void ensureSavedTracks(true);
    closeTrackPicker();
  };

  return (
    <div className="lc-sheet-body">
      <p className="lc-muted num">{uiText('Volta de {0}', formatKm(lengthM))}</p>
      {loading && (
        <p className="lc-muted">{uiText('Comparando o traçado com as pistas do jogo…')}</p>
      )}
      {suggestions.length > 0 && (
        <>
          <p className="ui-eyebrow">
            {byGeometry
              ? uiText('O traçado se parece com')
              : uiText('Parece ser (só pelo tamanho)')}
          </p>
          <ul className="ui-list lc-list">
            {suggestions.map((s) => (
              <li key={s.id}>
                <SuggestionRow s={s} busy={busy} onPick={() => save(s.name, s.layout)} />
              </li>
            ))}
          </ul>
          {needsCare && (
            <p className="lc-muted">
              {uiText(
                'Há layouts parecidos (reverso, com ou sem chicane…): confira qual você correu antes de confirmar.',
              )}
            </p>
          )}
        </>
      )}
      {!showOther && (
        <button
          type="button"
          className="ui-btn"
          data-variant="ghost"
          onClick={() => setOther(true)}
        >
          {uiText('Outra pista…')}
        </button>
      )}
      {showOther && (
        <div className="lc-other">
          <label className="ui-field">
            <span className="ui-label">{uiText('Nome da pista')}</span>
            <input
              className="ui-input"
              value={text}
              maxLength={80}
              // biome-ignore lint/a11y/noAutofocus: the driver asked to type a name
              autoFocus={suggestions.length > 0}
              placeholder={uiText('Digite o nome da pista (ex.: Monza, Suzuka, Spa)…')}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim() && !busy) {
                  const r = resolveTyped(text);
                  void save(r.name, r.layout);
                }
              }}
            />
          </label>
          {typed.length > 0 && (
            <ul className="ui-list lc-list">
              {typed.map((o) => (
                <li key={trackDisplayName(o)}>
                  <button
                    type="button"
                    className="ui-list-item"
                    disabled={busy}
                    onClick={() => save(o.name, o.layout ?? null)}
                  >
                    <span className="ui-list-text">
                      <span className="ui-list-title">{trackDisplayName(o)}</span>
                    </span>
                    {o.lengthM ? (
                      <span className="ui-list-desc num">{formatKm(o.lengthM)}</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="ui-btn"
            disabled={busy || !text.trim() || normalizeText(text) === ''}
            onClick={() => {
              const r = resolveTyped(text);
              void save(r.name, r.layout);
            }}
          >
            {uiText('Confirmar')}
          </button>
        </div>
      )}
      <div className="lc-sheet-foot">
        <button type="button" className="ui-btn" data-variant="ghost" onClick={closeTrackPicker}>
          {uiText('Agora não')}
        </button>
      </div>
    </div>
  );
}

function SuggestionRow({
  s,
  busy,
  onPick,
}: {
  s: TrackRecognitionCandidate;
  busy: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className="ui-list-item"
      disabled={busy}
      title={candidateTitle(s)}
      onClick={onPick}
    >
      <span className="ui-list-text">
        <span className="ui-list-title">{s.displayName}</span>
        <span className="ui-list-desc">
          {s.basis === 'geometry' && s.confidence === 'high'
            ? uiText('traçado confere')
            : uiText('é essa')}
        </span>
      </span>
      <span className="ui-list-desc num">{formatKm(s.officialLengthM)}</span>
    </button>
  );
}
