import {
  composeTask,
  TASK_BUDGET,
  TASK_VOICE_MANIFEST,
  taskCatalog,
  taskDictionaryView,
} from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { pickRadioPack, radioUtteranceMs, setTaskPack, taskPack } from './engineerClips.ts';
import { RADIO_VOICES } from './radioVoices.ts';

describe('the task packs', () => {
  it('has a pack for every voice with every piece a task sentence uses', () => {
    for (const voice of RADIO_VOICES) {
      const pack = TASK_VOICE_MANIFEST.voices[voice.pack];
      expect(pack, voice.pack).toBeDefined();
      expect(pack!.file).toMatch(new RegExp(`^tasks-${voice.pack}-[0-9a-f]{10}.wav$`));
      expect(pack!.sha256).toMatch(/^[0-9a-f]{64}$/);
      const missing = taskCatalog(voice.language)
        .map((e) => e.text)
        .filter((key) => !pack!.clips[key]);
      expect(missing, voice.pack).toEqual([]);
    }
  });

  it('plays a task sentence only once the server reports the voice as downloaded', () => {
    const example = taskDictionaryView().examples[0]!;
    const composed = composeTask(example.request);
    if (!composed.ok) throw new Error('example does not compose');
    const keys = composed.composition.keys;
    const voice = 'radio:alex';
    expect(taskPack(voice)).toBeNull();
    expect(pickRadioPack(voice, keys)).toBeNull();

    const file = TASK_VOICE_MANIFEST.voices.alex!.file;
    const pack = setTaskPack(voice, file);
    expect(pack?.url).toBe(`/api/tasks/voice/file/${file}`);
    expect(pickRadioPack(voice, keys)).toBe(pack);
    const ms = radioUtteranceMs(pack!, keys)!;
    expect(ms).toBeGreaterThan(1000);
    expect(ms).toBeLessThanOrEqual(TASK_BUDGET.maxMs);

    // a wrong file name never registers a pack
    expect(setTaskPack(voice, 'tasks-alex-0000000000.wav')).toBeNull();
    expect(taskPack(voice)).toBeNull();
  });

  it('keeps every dictionary example inside the speech budget with the real clips', () => {
    for (const voice of RADIO_VOICES) {
      const pack = setTaskPack(voice.id, TASK_VOICE_MANIFEST.voices[voice.pack]!.file)!;
      for (const example of taskDictionaryView().examples) {
        const composed = composeTask(example.request);
        if (!composed.ok) throw new Error('example does not compose');
        const ms = radioUtteranceMs(pack, composed.composition.keys, 1)!;
        expect(ms, `${voice.pack}: ${example.text}`).toBeLessThanOrEqual(TASK_BUDGET.maxMs);
      }
    }
  });
});
