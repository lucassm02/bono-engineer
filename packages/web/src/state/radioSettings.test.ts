import { describe, expect, it } from 'vitest';
import { TYRE_TEMP_SCALE } from '../config.ts';
import {
  migrateRadioControls,
  setEngineerMuted,
  setRadioControls,
  useEngineer,
} from './engineer.ts';
import { currentRadioConfig, radioEngine } from './radio.ts';

describe('configuração do rádio', () => {
  it('migrates the saved controls: keeps volume and anticipation, maps the old detail', () => {
    expect(migrateRadioControls({ volume: 0.4, anticipationMs: 350, detail: 'full' })).toEqual({
      volume: 0.4,
      anticipationMs: 350,
      mode: 'training',
      level: 'detailed',
      trainingProfile: 'learnTrack',
      learningBrakePercent: false,
      summary: 'onDemand',
      praise: false,
      consistencyTargetMs: null,
    });
    expect(migrateRadioControls(null)).toMatchObject({
      volume: 1,
      anticipationMs: 0,
      level: 'essential',
    });
    expect(migrateRadioControls({ volume: 3, anticipationMs: -5 })).toMatchObject({
      volume: 1,
      anticipationMs: 0,
    });
  });

  it('feeds the engine with the preferences, Mudo and the panel tyre scale', () => {
    setRadioControls({ mode: 'race', level: 'detailed' });
    setEngineerMuted(true, false);
    expect(currentRadioConfig()).toMatchObject({
      mode: 'race',
      speechLevel: 'mute',
      tyreScale: TYRE_TEMP_SCALE,
    });
    expect(radioEngine.config.speechLevel).toBe('mute');
    setEngineerMuted(false, false);
    expect(radioEngine.config).toMatchObject({ mode: 'race', speechLevel: 'detailed' });
    expect(useEngineer.getState().controls.volume).toBe(1);
  });
});
