import type { Id, LapCompletedEvent } from '@gt7/shared';
import { create } from 'zustand';
import { api } from '../analysis/api.ts';
import { useUi } from './uiStore.ts';

export const TRAINING_LAPS = 5;

interface TrainingLap {
  id: Id;
  results: Record<string, number> | null;
  failed?: boolean;
}

export interface EngineerTrainingRun {
  trackId: Id;
  carCode: number;
  referenceId: Id;
  sessionId: Id | null;
  after: number;
  corners: { id: Id; name: string }[];
  laps: TrainingLap[];
  notice: string | null;
}

export const useEngineerTraining = create<{ run: EngineerTrainingRun | null }>()(() => ({
  run: null,
}));

export function startEngineerTraining(config: Omit<EngineerTrainingRun, 'laps' | 'notice'>): void {
  useEngineerTraining.setState({ run: { ...config, laps: [], notice: null } });
}

export function completeEngineerTrainingLap(event: LapCompletedEvent): void {
  const run = useEngineerTraining.getState().run;
  if (
    !run ||
    run.laps.length >= TRAINING_LAPS ||
    event.startedAt == null ||
    event.startedAt <= run.after
  )
    return;
  if (
    event.trackId !== run.trackId ||
    event.carCode !== run.carCode ||
    (run.sessionId && run.sessionId !== event.sessionId)
  ) {
    useEngineerTraining.setState({
      run: {
        ...run,
        notice: 'A sessão, o carro ou o traçado mudou. Inicie um novo treino para continuar.',
      },
    });
    return;
  }
  if (run.laps.some((lap) => lap.id === event.lapId)) return;
  const { profile, serverStatus } = useUi.getState();
  if (serverStatus?.sessionCapture?.enabled === false) {
    useEngineerTraining.setState({
      run: { ...run, notice: 'Ative a gravação automática para retomar a contagem do treino.' },
    });
    return;
  }
  const speaker = serverStatus?.engineerAudioDeviceId;
  if (speaker && speaker !== profile.deviceId) {
    useEngineerTraining.setState({
      run: {
        ...run,
        notice: 'O engenheiro mudou de aparelho. Selecione este aparelho para retomar o treino.',
      },
    });
    return;
  }
  if (!event.valid || event.engineerReferenceLapId !== run.referenceId) {
    const notice = event.valid
      ? 'Volta sem a referência do treino. Confira a referência antes de continuar.'
      : 'Volta inválida. A próxima volta válida entra na contagem.';
    useEngineerTraining.setState({ run: { ...run, notice } });
    return;
  }
  useEngineerTraining.setState({
    run: {
      ...run,
      sessionId: event.sessionId,
      notice: null,
      laps: [...run.laps, { id: event.lapId, results: null }],
    },
  });
  const update = (change: Partial<TrainingLap>) => {
    const current = useEngineerTraining.getState().run;
    if (!current || current.after !== run.after || current.referenceId !== run.referenceId) return;
    useEngineerTraining.setState({
      run: {
        ...current,
        laps: current.laps.map((lap) => (lap.id === event.lapId ? { ...lap, ...change } : lap)),
      },
    });
  };
  void api.compare(event.lapId, run.referenceId).then(
    (data) => {
      const focused = new Set(run.corners.map((corner) => corner.id));
      const results = Object.fromEntries(
        data.comparison.rows
          .filter((row) => focused.has(row.corner.id))
          .map((row) => [row.corner.id, row.timeLostMs]),
      );
      update({ results });
    },
    () => update({ failed: true }),
  );
}
