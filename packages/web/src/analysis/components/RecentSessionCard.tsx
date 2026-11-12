/**
 * Início: "Sessão de Suzuka terminou · ver resumo" (spec 12). A card, never a full screen: it shows
 * for the latest session that ended a short while ago and has laps, until the driver opens or
 * dismisses it.
 */

import { useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { routes } from '../../lib/route.ts';
import { loadJson, saveJson } from '../../lib/storage.ts';
import { api } from '../api.ts';
import { fullTrackName } from '../lib/history.ts';
import { shouldOfferSummary } from '../lib/sessionSummary.ts';
import { useFetch } from '../useFetch.ts';
import { Panel } from './Panel.tsx';

const SEEN_KEY = 'bono.summary.seen';

export function RecentSessionCard() {
  const latest = useFetch('recent-session', async () => {
    const [s] = await api.sessions({ limit: 1 });
    return s ?? null;
  });
  const [seen, setSeen] = useState<string[]>(() => loadJson<string[]>(SEEN_KEY) ?? []);
  const session = latest.data;
  const track = useFetch(session?.trackId ? `track:${session.trackId}` : null, () =>
    api.track(session!.trackId!),
  );
  if (!session || !shouldOfferSummary(session, seen)) return null;

  const markSeen = () => {
    const next = [...seen, session.id].slice(-30);
    setSeen(next);
    saveJson(SEEN_KEY, next);
  };
  const name = track.data ? fullTrackName(track.data) : uiText('uma pista');

  return (
    <Panel
      className="ss-home"
      title={uiText('A sessão em {0} terminou', name)}
      description={
        session.bestLapMs
          ? uiText('{0} voltas · melhor {1}', session.lapCount, formatLapTime(session.bestLapMs))
          : uiText('{0} voltas', session.lapCount)
      }
      actions={
        <>
          <a
            className="ui-btn"
            data-variant="secondary"
            data-size="sm"
            href={routes.summary(session.id)}
            onClick={markSeen}
          >
            {uiText('Ver resumo')}
          </a>
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={markSeen}
          >
            {uiText('Dispensar')}
          </button>
        </>
      }
    >
      <p className="dim a-small">
        {uiText('Melhor volta, ritmo, regularidade e o que fazer na próxima, numa tela só.')}
      </p>
    </Panel>
  );
}
