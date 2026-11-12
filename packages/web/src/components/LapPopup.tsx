import { learnedPopupText } from '@gt7/shared';
import { noReferenceHint } from '../lib/copy.ts';
import { deltaTone, formatDelta, formatLapTime, formatSectorTime } from '../lib/format.ts';
import { t as uiText } from '../lib/i18n.ts';
import { DELTA_REFERENCE_LABELS } from '../lib/labels.ts';
import { dismissLapPopup } from '../state/actions.ts';
import { useLiveContext } from '../state/liveContext.ts';
import { useUi } from '../state/uiStore.ts';

/** 5 s card shown when a lap closes (never changes the current view). */
export function LapPopup() {
  const ev = useUi((s) => s.lapPopup);
  const ctx = useLiveContext((s) => s.ctx);
  if (!ev) return null;
  // the lap that taught the track: say so, and when the corners are ready
  const learned = ctx?.learning?.stage === 3 && !!ev.trackId && ctx.trackId === ev.trackId;
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
        <span className="lap-popup-lap">
          {`${uiText('Volta')} `}
          {ev.lapNumber}
        </span>
        <span className="lap-popup-badges">
          {ev.isPersonalBest && (
            <span className="ui-badge" data-tone="purple">
              {uiText('Melhor pessoal')}
            </span>
          )}
          {!ev.isPersonalBest && ev.isSessionBest && (
            <span className="ui-badge" data-tone="gain">
              {uiText('Melhor da sessão')}
            </span>
          )}
          {!ev.valid && (
            <span className="ui-badge" data-tone="loss">
              {uiText('Inválida')}
            </span>
          )}
        </span>
      </div>
      <div className="lap-popup-time num">{formatLapTime(ev.timeMs)}</div>
      <div className="lap-popup-delta num" data-tone={tone}>
        {ev.deltaMs === null ? uiText('Sem referência') : formatDelta(ev.deltaMs)}
        {ev.deltaMs !== null && (
          <span className="lap-popup-ref">
            {' '}
            vs {DELTA_REFERENCE_LABELS[ev.deltaReference].toLowerCase()}
          </span>
        )}
      </div>
      {ev.deltaMs === null && (
        <div className="lap-popup-hint">{noReferenceHint(ev.deltaReference)}</div>
      )}
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
      {learned && <div className="lap-popup-learned">{uiText(learnedPopupText(ctx.corners))}</div>}
      {best !== null && (
        <div className="lap-popup-best">
          {uiText('Melhor setor contra a referência: S')}
          {best + 1}
        </div>
      )}
    </button>
  );
}
