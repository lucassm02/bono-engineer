/**
 * "Minha meta" (spec 13): the lap time the driver wants on this track, with the distance to it,
 * the share of the way already done and the goals already reached.
 */

import { type ApiTrackGoal, goalProgress } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { formatFixed, formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { addNotice } from '../../state/uiStore.ts';
import { ApiError, api } from '../api.ts';
import { type DailyGoalSuggestion, dailyGoalSuggestion } from '../lib/dailies.ts';
import { carLabel, formatDateTime } from '../lib/labels.ts';
import { formatLapTimeInput, parseLapTime } from '../lib/lapTime.ts';
import { useFetch } from '../useFetch.ts';
import { Card, ConfirmButton, ErrorBox, Loading } from './ui.tsx';

const ANY_CAR = '';

const MEDAL_TEXT: Record<DailyGoalSuggestion['medal'], () => string> = {
  platinum: () => uiText('Platina'),
  gold: () => uiText('Ouro'),
  silver: () => uiText('Prata'),
  bronze: () => uiText('Bronze'),
};

export function GoalCard({
  trackId,
  cars,
}: {
  trackId: string;
  /** Cars driven on the track, to scope a goal to one of them. */
  cars: { carCode: number }[];
}) {
  const [scope, setScope] = useState<string>(ANY_CAR);
  const carCode = scope === ANY_CAR ? null : Number(scope);
  const goal = useFetch(`goal:${trackId}:${scope}`, () => api.trackGoal(trackId, carCode));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; slower: boolean } | null>(null);
  const data: ApiTrackGoal | null = goal.data;
  // A goal from this week's Daily Races (only when the driver turned them on): the next medal.
  const dailies = useFetch('dailies', () => api.dailyRaces());
  const track = useFetch(`track:${trackId}`, () => api.track(trackId));
  const daily: DailyGoalSuggestion | null =
    dailies.data?.enabled && track.data && data?.bestLapMs != null
      ? dailyGoalSuggestion(track.data, data.bestLapMs, dailies.data.races)
      : null;

  const parsed = parseLapTime(text);
  const activeId = data?.active?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: refill only when another goal loads
  useEffect(() => {
    setText(data?.active ? formatLapTimeInput(data.active.targetMs) : '');
    setProblem(null);
  }, [activeId]);

  const save = async (allowSlower = false) => {
    if (parsed === null) {
      setProblem({ message: uiText('Digite o tempo no formato 1:45.000.'), slower: false });
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await api.setGoal(trackId, { targetMs: parsed, carCode, allowSlower });
      addNotice('info', uiText('Meta definida: {0}', formatLapTime(parsed)));
      goal.reload();
    } catch (e) {
      const err = e instanceof ApiError ? e : null;
      setProblem({
        message: err ? uiText(err.message) : uiText('Não foi possível salvar a meta.'),
        slower: err?.code === 'goalSlower',
      });
    } finally {
      setBusy(false);
    }
  };

  const progress =
    data?.active && data.bestLapMs !== null
      ? goalProgress(data.active.targetMs, data.bestLapMs, data.baselineMs)
      : null;

  return (
    <Card
      title={uiText('Minha meta')}
      id="meta"
      className="a-goal-card"
      actions={
        cars.length > 1 && (
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            aria-label={uiText('Meta para')}
          >
            <option value={ANY_CAR}>{uiText('Qualquer carro')}</option>
            {cars.map((c) => (
              <option key={c.carCode} value={String(c.carCode)}>
                {carLabel(c.carCode)}
              </option>
            ))}
          </select>
        )
      }
    >
      {goal.error && !data ? (
        <ErrorBox error={goal.error} onRetry={goal.reload} compact />
      ) : !data ? (
        <Loading />
      ) : (
        <>
          {data.active ? (
            <div className="a-goal-now">
              <div className="a-stats">
                <div className="a-stat" data-emph="1">
                  <span className="a-stat-k">{uiText('Meta')}</span>
                  <span className="a-stat-v num">{formatLapTime(data.active.targetMs)}</span>
                </div>
                <div className="a-stat">
                  <span className="a-stat-k">{uiText('Sua melhor')}</span>
                  <span className="a-stat-v num">{formatLapTime(data.bestLapMs)}</span>
                </div>
                <div className="a-stat">
                  <span className="a-stat-k">{uiText('Falta')}</span>
                  <span className="a-stat-v num" data-tone={progress?.reached ? 'gain' : undefined}>
                    {progress === null
                      ? '–'
                      : progress.reached
                        ? uiText('Batida!')
                        : `${formatFixed(progress.remainingMs / 1000, 3)} s`}
                  </span>
                </div>
              </div>
              {progress?.fraction != null && (
                <div
                  className="a-goal-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(progress.fraction * 100)}
                  aria-label={uiText('Caminho percorrido até a meta')}
                >
                  <span style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
                  <em className="num">{Math.round(progress.fraction * 100)}%</em>
                </div>
              )}
            </div>
          ) : (
            <p className="dim">
              {uiText(
                'Defina o tempo que você quer fazer nesta pista. O delta ao vivo, o engenheiro e o resumo passam a mostrar quanto falta.',
              )}
            </p>
          )}

          <form
            className="a-goal-form"
            onSubmit={(e) => {
              e.preventDefault();
              void save(false);
            }}
          >
            <div className="ui-field">
              <label className="ui-label" htmlFor="goal-time">
                {data.active ? uiText('Mudar a meta') : uiText('Tempo da meta')}
              </label>
              <input
                id="goal-time"
                className="ui-input num"
                value={text}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="1:45.000"
                aria-invalid={problem !== null || (text.trim() !== '' && parsed === null)}
                aria-describedby="goal-help"
                onChange={(e) => {
                  setText(e.target.value);
                  setProblem(null);
                }}
                onBlur={() => {
                  if (parsed !== null) setText(formatLapTimeInput(parsed));
                }}
              />
              <span
                id="goal-help"
                className={problem ? 'ui-error' : 'ui-help'}
                role={problem ? 'alert' : undefined}
              >
                {problem
                  ? problem.message
                  : data.suggestion
                    ? data.suggestion.basis === 'idealLap'
                      ? uiText(
                          'Sugestão: {0}, a sua volta ideal (soma dos melhores setores).',
                          formatLapTime(data.suggestion.targetMs),
                        )
                      : uiText(
                          'Sugestão: {0}, 0,5% abaixo da sua melhor volta.',
                          formatLapTime(data.suggestion.targetMs),
                        )
                    : uiText('Minutos, segundos e milésimos, como no jogo.')}
              </span>
            </div>
            {daily && (
              <div className="a-goal-daily">
                <p>
                  {uiText(
                    'Corrida diária {0} desta semana ({1}): a medalha de {2} é {3}, a {4} s da sua melhor volta.',
                    daily.race.type,
                    daily.race.carLabel,
                    MEDAL_TEXT[daily.medal]().toLowerCase(),
                    formatLapTime(daily.targetMs),
                    formatFixed(daily.gapMs / 1000, 3),
                  )}
                </p>
                <button
                  type="button"
                  className="a-btn a-btn-ghost a-btn-sm"
                  onClick={() => {
                    setText(formatLapTimeInput(daily.targetMs));
                    setProblem(null);
                  }}
                >
                  {uiText('Usar a medalha como meta')}
                </button>
              </div>
            )}
            <div className="a-goal-actions">
              <button type="submit" className="a-btn" disabled={busy || parsed === null}>
                {data.active ? uiText('Atualizar meta') : uiText('Definir meta')}
              </button>
              {data.suggestion && (
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  onClick={() => {
                    setText(formatLapTimeInput(data.suggestion!.targetMs));
                    setProblem(null);
                  }}
                >
                  {uiText('Sugerir')}
                </button>
              )}
              {problem?.slower && (
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  disabled={busy}
                  onClick={() => void save(true)}
                >
                  {uiText('Definir mesmo assim')}
                </button>
              )}
              {data.active && (
                <ConfirmButton
                  label={uiText('Remover meta')}
                  question={uiText('Remover a meta?')}
                  onConfirm={async () => {
                    await api.clearGoal(trackId, carCode);
                    goal.reload();
                  }}
                />
              )}
            </div>
          </form>

          {data.history.length > 0 && (
            <div className="a-goal-history">
              <h3 className="a-h3">{uiText('Metas batidas')}</h3>
              <ul>
                {data.history.map((g) => (
                  <li key={g.id}>
                    <span className="num">{formatLapTime(g.targetMs)}</span>
                    <span className="dim">
                      {` · ${uiText('batida em {0}', formatDateTime(g.achievedAt))}`}
                      {g.carCode !== null ? ` · ${carLabel(g.carCode)}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
