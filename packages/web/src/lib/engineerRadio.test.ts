import type { EngineerCue, LiveCar } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { radioClipMs, radioPack } from './engineerClips.ts';
import { ENGINEER_PHRASES, engineerCall, engineerDisplay } from './engineerRadio.ts';
import { RADIO_VOICES } from './radioVoices.ts';

const estimate = (_utterance: unknown, ms: number) => ms;
const driver = (speedKmh: number, brake = 0, throttle = 0) =>
  ({ speedKmh, brake, throttle, brakeRaw: null, throttleRaw: null }) as LiveCar;

describe('Engenheiro ao vivo', () => {
  it('ships a timed clip for every live instruction in every radio pack', () => {
    for (const voice of RADIO_VOICES) {
      const pack = radioPack(voice.id)!;
      expect(radioClipMs(pack, 'preview')).toBeGreaterThan(3000);
      for (const phrase of ENGINEER_PHRASES) {
        expect(radioClipMs(pack, phrase), `${voice.name} · ${phrase}`).toBeGreaterThan(200);
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

  it('uses the rounded reference brake percentage in detailed instructions when it fits', () => {
    const cue: EngineerCue = { id: 'T1', kind: 'brake', aheadM: 100, brakePeak: 0.52 };
    const duration = (utterance: unknown) => (typeof utterance === 'string' ? 1800 : 2400);
    expect(engineerCall(cue, driver(120), duration, 0, true)?.utterance).toEqual([
      'cinquenta por cento de freio',
      'em cem metros.',
    ]);
    expect(engineerDisplay([cue], driver(120), true)?.label).toBe('Freio · 50%');
    expect(engineerCall(cue, driver(150), duration, 0, true)?.text).toBe('Freio em cem.');
    expect(
      engineerCall({ ...cue, brakePeak: undefined }, driver(120), duration, 0, true)?.text,
    ).toBe('Freio em cem.');
    expect(engineerCall(cue, driver(120), duration)?.text).toBe('Freio em cem.');
  });

  it('waits for the closest safe braking call and advances it when more anticipation is requested', () => {
    const cue: EngineerCue = { id: 'T1', kind: 'brake', aheadM: 100 };
    const duration = () => 1200;
    expect(engineerCall(cue, driver(100), duration)).toBeNull();
    expect(engineerCall(cue, driver(100), duration, 700)?.text).toBe('Freio em cem.');
    expect(engineerCall({ ...cue, aheadM: 50 }, driver(100), duration)?.text).toBe(
      'Freio em cinquenta.',
    );
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
