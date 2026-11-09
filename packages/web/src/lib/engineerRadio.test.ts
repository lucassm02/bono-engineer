import type { EngineerCue, LiveCar } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { RADIO_VOICES, radioClipMs, radioPack } from './engineerClips.ts';
import { ENGINEER_PHRASES, engineerCall, engineerDisplay } from './engineerRadio.ts';

const estimate = (_text: string, ms: number) => ms;
const driver = (speedKmh: number, brake = 0, throttle = 0) =>
  ({ speedKmh, brake, throttle, brakeRaw: null, throttleRaw: null }) as LiveCar;

describe('Engenheiro ao vivo', () => {
  it('ships a timed clip for every live instruction in both radio packs', () => {
    for (const voice of RADIO_VOICES) {
      const pack = radioPack(voice.value)!;
      expect(radioClipMs(pack, 'preview')).toBeGreaterThan(3000);
      for (const phrase of ENGINEER_PHRASES) {
        expect(radioClipMs(pack, phrase), `${voice.label} · ${phrase}`).toBeGreaterThan(200);
      }
    }
  });
  it('antecipates hard braking at speed and keeps the on-screen distance in meters', () => {
    const cue: EngineerCue = { id: 'T1', kind: 'brakeHard', aheadM: 198 };
    expect(engineerCall(cue, driver(250), estimate)?.text).toBe('Freada forte em duzentos.');
    expect(engineerDisplay([cue], driver(250))).toMatchObject({
      label: 'Freio forte',
      meters: 200,
    });
    expect(engineerCall({ ...cue, aheadM: 99 }, driver(250), estimate)).toBeNull();
    expect(engineerCall({ ...cue, aheadM: 48 }, driver(70), estimate)?.text).toBe(
      'Freada forte em cinquenta.',
    );
  });

  it('skips expired cues and calls that will arrive late on a slow voice', () => {
    const cue: EngineerCue = { id: 'T1', kind: 'brakeLight', aheadM: 98 };
    expect(engineerCall(cue, driver(140), estimate)?.text).toBe('Toque no freio em cem.');
    expect(engineerCall(cue, driver(140), () => 4000)).toBeNull();
    expect(engineerCall(cue, driver(140, 0.3), estimate)).toBeNull();
    expect(engineerCall({ ...cue, aheadM: -1 }, driver(140), estimate)).toBeNull();
  });

  it('only calls for coasting while there is time before the pickup', () => {
    const cue: EngineerCue = { id: 'roll', kind: 'coast', aheadM: 4, endAheadM: 28 };
    expect(engineerCall(cue, driver(80), estimate)?.text).toBe('Deixa rolar.');
    expect(engineerCall({ ...cue, endAheadM: 15 }, driver(80), estimate)).toBeNull();
    expect(engineerCall(cue, driver(80, 0, 0.4), estimate)).toBeNull();
    expect(engineerDisplay([{ ...cue, aheadM: -7 }], driver(80))?.label).toBe('Deixe rolar');
  });

  it('calls for release and progressive pickup according to the current pedals', () => {
    const cue: EngineerCue = { id: 'release', kind: 'releaseSmooth', aheadM: 12 };
    expect(engineerCall(cue, driver(80, 0.35), estimate)?.text).toBe('Vai soltando o freio.');
    expect(engineerCall(cue, driver(80), estimate)).toBeNull();
    const pickup = { ...cue, kind: 'throttleSmooth' } as const;
    expect(engineerCall(pickup, driver(80), estimate)?.text).toBe('Acelera, suave.');
    expect(engineerCall(pickup, driver(80, 0.35), estimate)).toBeNull();
  });
});
