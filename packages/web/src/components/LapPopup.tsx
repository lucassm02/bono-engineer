import { deltaTone, formatDelta, formatLapTime, formatSectorTime } from '../lib/format.ts';
import { DELTA_REFERENCE_LABELS } from '../lib/labels.ts';
import { dismissLapPopup } from '../state/actions.ts';
import { useUi } from '../state/uiStore.ts';

/** 5 s card shown when a lap closes (never changes the current view). */
export function LapPopup() {
  const ev = useUi((s) => s.lapPopup);
  if (!ev) return null;
  const tone = deltaTone(ev.deltaMs);
  const best = ev.bestSectorIndex;
  return (
    <button
      type="button"
      className="lap-popup"
      data-no-gesture
      data-tone={tone}
      onClick={dismissLapPopup}
      aria-live="assertive"
    >
      <div className="lap-popup-head">
        <span className="lap-popup-lap">Volta {ev.lapNumber}</span>
        <span className="lap-popup-badges">
          {ev.isPersonalBest && (
            <span className="ui-badge" data-tone="purple">
              Melhor pessoal
            </span>
          )}
          {!ev.isPersonalBest && ev.isSessionBest && (
            <span className="ui-badge" data-tone="gain">
              Melhor da sessão
            </span>
          )}
          {!ev.valid && (
            <span className="ui-badge" data-tone="loss">
              Inválida
            </span>
          )}
        </span>
      </div>
      <div className="lap-popup-time num">{formatLapTime(ev.timeMs)}</div>
      <div className="lap-popup-delta num" data-tone={tone}>
        {ev.deltaMs === null ? 'Sem referência' : formatDelta(ev.deltaMs)}
        {ev.deltaMs !== null && (
          <span className="lap-popup-ref">
            {' '}
            vs {DELTA_REFERENCE_LABELS[ev.deltaReference].toLowerCase()}
          </span>
        )}
      </div>
      <div className="lap-popup-sectors">
        {ev.sectorTimesMs.map((t, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: sectors are positional
            key={i}
            className="lap-sector"
            data-status={ev.sectorStatus[i] ?? 'pending'}
            data-best={best === i ? '1' : '0'}
          >
            <span className="lap-sector-name">S{i + 1}</span>
            <span className="num">{formatSectorTime(t)}</span>
          </span>
        ))}
      </div>
      {best !== null && (
        <div className="lap-popup-best">Melhor setor contra a referência: S{best + 1}</div>
      )}
    </button>
  );
}
