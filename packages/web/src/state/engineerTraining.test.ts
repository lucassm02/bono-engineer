import type { ApiComparison, LapCompletedEvent } from '@gt7/shared';
import { expect, it, vi } from 'vitest';
import { api } from '../analysis/api.ts';
import {
  completeEngineerTrainingLap,
  startEngineerTraining,
  useEngineerTraining,
} from './engineerTraining.ts';

it('counts five full valid laps against the fixed reference and retains only focused corners', async () => {
  const compare = vi.spyOn(api, 'compare').mockResolvedValue({
    comparison: {
      rows: [
        { corner: { id: 'T1' }, timeLostMs: 120 },
        { corner: { id: 'T2' }, timeLostMs: 170 },
      ],
    },
  } as ApiComparison);
  const event = (n: number, overrides: Partial<LapCompletedEvent> = {}) =>
    ({
      sessionId: 'session',
      trackId: 'track',
      carCode: 42,
      engineerReferenceLapId: 'ref',
      lapId: `lap-${n}`,
      startedAt: n,
      valid: true,
      ...overrides,
    }) as LapCompletedEvent;
  try {
    startEngineerTraining({
      trackId: 'track',
      sessionId: 'session',
      carCode: 42,
      referenceId: 'ref',
      after: 10,
      corners: [{ id: 'T2', name: 'T2' }],
    });
    completeEngineerTrainingLap(event(9));
    completeEngineerTrainingLap(event(11, { valid: false }));
    completeEngineerTrainingLap(event(12, { engineerReferenceLapId: 'wrong' }));
    completeEngineerTrainingLap(event(13, { sessionId: 'other' }));
    for (let i = 14; i <= 19; i++) completeEngineerTrainingLap(event(i));
    await Promise.resolve();
    expect(compare.mock.calls).toEqual([14, 15, 16, 17, 18].map((n) => [`lap-${n}`, 'ref']));
    expect(useEngineerTraining.getState().run?.laps.map((lap) => lap.results)).toEqual(
      Array.from({ length: 5 }, () => ({ T2: 170 })),
    );
  } finally {
    compare.mockRestore();
    useEngineerTraining.setState({ run: null });
  }
});
