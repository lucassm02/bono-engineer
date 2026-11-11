import { buffer } from 'node:stream/consumers';
import { createAudioResource, StreamType } from '@discordjs/voice';
import { detailedBrakeUtterance } from '@gt7/shared/radio-phrases';
import { describe, expect, it } from 'vitest';
import { calibrationTone, radioAudio } from './audio.ts';
import { calibratedDelay } from './config.ts';

describe('rádio do Discord', () => {
  it('uses the 90th percentile of the headset measurements', () => {
    expect(calibratedDelay('300,220,280,500,270,290,310,260,305,295')).toBe(310);
    expect(calibratedDelay(undefined)).toBeNull();
    expect(() => calibratedDelay('280,')).toThrow();
    expect(() => calibratedDelay('1600')).toThrow();
  });

  it.each(['alex', 'en-michael', 'es-alex'])(
    'matches the clip duration to the PCM sent to Discord for %s',
    async (pack) => {
      const radio = radioAudio(pack, 0.5);
      const phrase = detailedBrakeUtterance(50, 100);
      const pcm = await buffer(radio.stream(phrase)!);
      expect(pcm.length).toBeGreaterThan(0);
      expect(pcm.length / 192).toBe(radio.durationMs(phrase));
      expect(radio.stream('inexistente')).toBeNull();
      expect(await buffer(calibrationTone())).toHaveLength(19_200);
    },
  );

  it('encodes the calibration tone as Opus with the installed voice dependencies', async () => {
    const resource = createAudioResource(calibrationTone(), { inputType: StreamType.Raw });
    const encoded = await buffer(resource.playStream);
    expect(encoded.length).toBeGreaterThan(0);
  });
});
