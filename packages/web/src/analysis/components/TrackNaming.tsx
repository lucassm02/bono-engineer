/**
 * Naming of tracks without work: an autocomplete field over the built-in GT7 circuit list, the
 * click-to-edit title, and the discreet "Nova pista detectada — qual é?" prompt with candidates by
 * the recognized layouts (by the driven line, falling back to the lap length). Nothing is ever
 * named here without a click/Enter from the user (the server only names a track by itself for a
 * strong and unambiguous geometric match).
 */

import type { TrackRecognitionCandidate } from '@gt7/shared';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { type Gt7Track, trackDisplayName } from '../../data/gt7Tracks.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { formatKm } from '../lib/history.ts';
import { resolveTyped, searchCatalog, suggestByLength } from '../lib/trackSuggest.ts';
import { useFetch } from '../useFetch.ts';

/** Saves the name (and layout, when it comes from the list) of a track. */
export async function saveTrackName(
  trackId: string,
  name: string,
  layout: string | null,
): Promise<boolean> {
  try {
    await api.nameTrack(trackId, name.trim(), layout);
    return true;
  } catch (e) {
    addNotice('error', (e as Error).message, 6000);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Autocomplete field
// ---------------------------------------------------------------------------------------------

export function TrackNameField({
  initial = '',
  lengthM,
  placeholder = uiText('Digite o nome da pista (ex.: Monza, Suzuka, Spa)…'),
  autoFocus,
  busy,
  onSubmit,
  onCancel,
  submitLabel = uiText('Salvar'),
}: {
  initial?: string;
  lengthM?: number;
  placeholder?: string;
  autoFocus?: boolean;
  busy?: boolean;
  onSubmit: (name: string, layout: string | null) => void;
  onCancel?: () => void;
  submitLabel?: string;
}) {
  const [text, setText] = useState(initial);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const options = useMemo(() => (text.trim() ? searchCatalog(text, lengthM) : []), [text, lengthM]);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const pick = (t: Gt7Track) => {
    setText(trackDisplayName(t));
    setOpen(false);
    setActive(-1);
    onSubmit(t.name, t.layout ?? null);
  };
  const submitTyped = () => {
    if (!text.trim()) return;
    const r = resolveTyped(text);
    onSubmit(r.name, r.layout);
  };

  return (
    <div className="a-namefield" ref={boxRef}>
      <div className="a-namefield-row">
        <input
          className="a-input"
          value={text}
          placeholder={placeholder}
          maxLength={80}
          // biome-ignore lint/a11y/noAutofocus: opened by an explicit click
          autoFocus={autoFocus}
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={uiText('Nome da pista')}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const o = options[active];
              if (open && o) pick(o);
              else submitTyped();
            } else if (e.key === 'Escape') {
              if (open) setOpen(false);
              else onCancel?.();
            }
          }}
        />
        <button
          type="button"
          className="a-btn"
          disabled={busy || !text.trim()}
          onClick={submitTyped}
        >
          {submitLabel}
        </button>
        {onCancel && (
          <button type="button" className="a-btn a-btn-ghost" onClick={onCancel}>
            {uiText('Cancelar')}
          </button>
        )}
      </div>
      {open && options.length > 0 && (
        <ul className="a-namefield-list" id={listId}>
          {options.map((o, i) => (
            <li key={trackDisplayName(o)}>
              <button
                type="button"
                tabIndex={-1}
                data-active={i === active ? '1' : '0'}
                onPointerDown={(e) => {
                  e.preventDefault();
                  pick(o);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span>{trackDisplayName(o)}</span>
                {o.lengthM && <span className="dim num">{formatKm(o.lengthM)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Click-to-edit title
// ---------------------------------------------------------------------------------------------

export function EditableTrackName({
  trackId,
  name,
  layout,
  lengthM,
  onSaved,
}: {
  trackId: string;
  name: string;
  layout: string | null;
  lengthM: number;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  if (editing) {
    return (
      <TrackNameField
        initial={layout ? trackDisplayName({ name, layout }) : name}
        lengthM={lengthM}
        autoFocus
        busy={busy}
        onCancel={() => setEditing(false)}
        onSubmit={async (n, l) => {
          setBusy(true);
          const ok = await saveTrackName(trackId, n, l);
          setBusy(false);
          if (ok) {
            setEditing(false);
            onSaved();
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="a-title-edit"
      title={uiText('Clique para renomear')}
      onClick={() => setEditing(true)}
    >
      <span>{name}</span>
      {layout && <span className="a-title-layout"> · {layout}</span>}
      <span className="a-title-pencil" aria-hidden="true">
        ✎
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// "Nova pista detectada"
// ---------------------------------------------------------------------------------------------

export function NewTrackPrompt({
  trackId,
  lengthM,
  onSaved,
  onLater,
  variant = 'banner',
}: {
  trackId: string;
  lengthM: number;
  onSaved: () => void;
  /** "Agora não": hides the prompt for this track on this device. */
  onLater?: () => void;
  variant?: 'banner' | 'inline';
}) {
  // The server compares the stored driving line with the official layouts. If it cannot answer
  // (old server, no line), the length window still gives candidates.
  const recognition = useFetch(`recog:${trackId}`, () => api.trackRecognition(trackId));
  const suggestions: TrackRecognitionCandidate[] = useMemo(() => {
    if (recognition.data) return recognition.data.candidates.slice(0, 3);
    if (!recognition.error) return [];
    return suggestByLength(lengthM).map((s) => ({
      id: s.track.id,
      name: s.track.name,
      layout: s.track.layout ?? null,
      displayName: trackDisplayName(s.track),
      officialLengthM: s.track.lengthM,
      turns: 0,
      lengthErrRel: s.errorRel,
      basis: 'length' as const,
      confidence: 'low' as const,
      meanDevM: null,
      lookAlikes: [],
    }));
  }, [recognition.data, recognition.error, lengthM]);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const loadingSuggestions = recognition.loading && !recognition.data && !recognition.error;
  const showTyping = typing || (!loadingSuggestions && suggestions.length === 0);
  const byGeometry = suggestions.some((s) => s.basis === 'geometry');
  // A strong geometric match already tells the reverse layout apart (driving direction), so the
  // warning is for length-only suggestions, similar lines and ties.
  const needsCare =
    !!recognition.data?.ambiguous ||
    suggestions.some(
      (s) => s.lookAlikes.length > 0 && !(s.basis === 'geometry' && s.confidence === 'high'),
    );

  const save = async (name: string, layout: string | null) => {
    setBusy(true);
    const ok = await saveTrackName(trackId, name, layout);
    setBusy(false);
    if (ok) {
      addNotice('info', uiText('Pista salva como “{0}”.', name));
      onSaved();
    }
  };

  return (
    <section
      className="a-newtrack"
      data-variant={variant}
      aria-label={uiText('Nova pista detectada')}
    >
      <div className="a-newtrack-head">
        <strong>{uiText('Nova pista detectada — qual é?')}</strong>
        <span className="dim a-small num">
          {`${uiText('volta de')} `}
          {formatKm(lengthM)}
        </span>
      </div>
      {suggestions.length > 0 && (
        <div className="a-newtrack-sugg">
          <span className="dim a-small">
            {byGeometry
              ? uiText('O traçado se parece com:')
              : uiText('Parece ser (só pelo tamanho):')}
          </span>
          {suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              className="a-suggest"
              disabled={busy}
              title={candidateTitle(s)}
              onClick={() => save(s.name, s.layout)}
            >
              {s.displayName}
              <span className="a-suggest-sub">
                {s.basis === 'geometry' && s.confidence === 'high'
                  ? uiText('traçado confere')
                  : uiText('é essa')}
              </span>
            </button>
          ))}
          {!showTyping && (
            <button type="button" className="a-link-btn a-small" onClick={() => setTyping(true)}>
              {uiText('Outra pista…')}
            </button>
          )}
        </div>
      )}
      {suggestions.length > 0 && needsCare && (
        <p className="dim a-small a-newtrack-note">
          {uiText(
            'Há layouts parecidos (reverso, com ou sem chicane…): confira qual você correu antes de confirmar.',
          )}
        </p>
      )}
      {showTyping && (
        <TrackNameField
          lengthM={lengthM}
          busy={busy}
          autoFocus={suggestions.length > 0}
          onSubmit={save}
          submitLabel="Confirmar"
        />
      )}
      {onLater && (
        <button type="button" className="a-link-btn a-small a-newtrack-later" onClick={onLater}>
          {uiText('Agora não')}
        </button>
      )}
    </section>
  );
}

/** Tooltip of a suggestion: why the app thinks so. */
function candidateTitle(c: TrackRecognitionCandidate): string {
  const diff = `${(Math.abs(c.lengthErrRel) * 100).toFixed(1).replace('.', ',')}%`;
  const len = uiText(
    'Comprimento oficial: {0} (a volta medida difere {1})',
    formatKm(c.officialLengthM),
    diff,
  );
  const turns = c.turns > 0 ? ` · ${c.turns} curvas` : '';
  const geo =
    c.basis === 'geometry' && c.meanDevM !== null
      ? uiText('Traçado: desvio médio de {0} m. ', c.meanDevM.toFixed(1).replace('.', ','))
      : '';
  const alike = c.lookAlikes.length ? uiText(' · Parecidas: {0}', c.lookAlikes.join('; ')) : '';
  return `${geo}${len}${turns}${alike}`;
}
