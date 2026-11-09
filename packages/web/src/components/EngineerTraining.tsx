import type { Lap, Track } from '@gt7/shared';
import { useState } from 'react';
import { cornerLabel } from '../analysis/lib/chartData.ts';
import { formatDelta } from '../lib/format.ts';
import { routes } from '../lib/route.ts';
import { live } from '../live/liveStore.ts';
import { setEngineerEnabled, useEngineer } from '../state/engineer.ts';
import {
  startEngineerTraining,
  TRAINING_LAPS,
  useEngineerTraining,
} from '../state/engineerTraining.ts';
import { useUi } from '../state/uiStore.ts';

export function EngineerTraining({
  track,
  reference,
  audioHere,
  pin,
}: {
  track: Track | null;
  reference: Lap | null;
  audioHere: boolean;
  pin: (value: string) => Promise<boolean>;
}) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const run = useEngineerTraining((s) => s.run);
  const recording = useUi((s) => s.serverStatus?.sessionCapture?.enabled !== false);
  const active = !!run && run.laps.length < TRAINING_LAPS;
  const corners = track?.corners.filter((corner) => chosen.includes(corner.id)) ?? [];

  async function start() {
    const frame = live.frame;
    if (
      !track ||
      !reference ||
      !frame ||
      frame.track?.id !== track.id ||
      frame.car.carCode !== reference.carCode ||
      !corners.length ||
      !audioHere ||
      !recording
    )
      return;
    setStarting(true);
    if (!useEngineer.getState().enabled) setEngineerEnabled(true);
    const pinned = await pin(`lap:${reference.id}`);
    setStarting(false);
    if (!pinned) return;
    startEngineerTraining({
      trackId: track.id,
      carCode: reference.carCode,
      sessionId: frame.sessionId ?? null,
      referenceId: reference.id,
      after: live.frame?.t ?? frame.t,
      corners: corners.map((corner) => ({ id: corner.id, name: cornerLabel(corner) })),
    });
  }

  return (
    <details className="engineer-training">
      <summary>Treino por curvas{run && ` · ${run.laps.length}/${TRAINING_LAPS}`}</summary>
      {run ? (
        <>
          <p>
            {active ? `${run.laps.length} de ${TRAINING_LAPS} voltas válidas` : 'Treino concluído'}{' '}
            · {run.corners.map((corner) => corner.name).join(' e ')}
          </p>
          {run.notice && <p role="status">{run.notice}</p>}
          {run.laps.length > 0 && (
            <ol className="engineer-training-results">
              {run.laps.map((lap) => (
                <li key={lap.id}>
                  <a href={routes.compare({ lap: lap.id, ref: run.referenceId })}>
                    Abrir comparação
                  </a>
                  <span>
                    {lap.failed
                      ? 'Análise indisponível'
                      : lap.results
                        ? run.corners
                            .map(
                              (corner) => `${corner.name} ${formatDelta(lap.results?.[corner.id])}`,
                            )
                            .join(' · ')
                        : 'Analisando…'}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {!active &&
            run.corners.map((corner) => {
              const values = run.laps.flatMap((lap) => {
                const value = lap.results?.[corner.id];
                return value === undefined ? [] : [value];
              });
              if (values.length < 2) return null;
              const change = values.at(-1)! - values[0]!;
              const spread = Math.max(...values) - Math.min(...values);
              return (
                <p key={corner.id}>
                  {corner.name} · última vs. primeira {formatDelta(change)} · variação entre voltas{' '}
                  {formatDelta(spread)}
                </p>
              );
            })}
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => useEngineerTraining.setState({ run: null })}
          >
            {active ? 'Encerrar treino' : 'Novo treino'}
          </button>
        </>
      ) : (
        <>
          <p>
            Escolha até duas curvas. O rádio foca nelas por cinco voltas válidas e compara todas com
            a mesma referência.
          </p>
          {!audioHere && <p>Inicie o treino no aparelho que toca o rádio.</p>}
          {!recording && <p>Ative a gravação automática para analisar as voltas do treino.</p>}
          {!reference && <p>Escolha uma volta compatível para fixar a referência do treino.</p>}
          {track?.corners.length ? (
            <fieldset className="engineer-training-corners">
              <legend>Curvas do treino</legend>
              {track.corners.map((corner) => (
                <label key={corner.id}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(corner.id)}
                    disabled={corners.length >= 2 && !chosen.includes(corner.id)}
                    onChange={(event) => {
                      setChosen(
                        event.currentTarget.checked
                          ? [...corners.map((item) => item.id), corner.id]
                          : chosen.filter((id) => id !== corner.id),
                      );
                    }}
                  />
                  {cornerLabel(corner)}
                </label>
              ))}
            </fieldset>
          ) : (
            <p>Aguardando as curvas do traçado atual.</p>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={starting || !audioHere || !recording || !reference || !corners.length}
            onClick={() => void start()}
          >
            {starting ? 'Preparando treino…' : 'Iniciar treino de 5 voltas'}
          </button>
        </>
      )}
    </details>
  );
}
