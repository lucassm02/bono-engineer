import { create } from 'zustand';
import {
  playRadioClip,
  prepareRadioPack,
  radioClipMs,
  radioPack,
  setRadioClipVolume,
  stopRadioClip,
} from '../lib/engineerClips.ts';
import { ENGINEER_PREVIEW } from '../lib/engineerRadio.ts';
import { speakPtBr, stopSpeech } from '../lib/speech.ts';
import { loadJson, saveJson } from '../lib/storage.ts';

const KEY = 'gt7.engineer.muted';
const VOICE_KEY = 'gt7.engineer.voice';
const RADIO_KEY = 'gt7.engineer.controls';
export interface RadioControls {
  volume: number;
  anticipationMs: number;
  detail: 'essential' | 'full';
}
const savedControls = loadJson<Partial<RadioControls>>(RADIO_KEY);
export const ENGINEER_PACES = { calma: 0.95, normal: 1.1, rapida: 1.25 } as const;
export type EngineerPace = keyof typeof ENGINEER_PACES;
const savedVoice = loadJson<{ voiceUri?: string; pace?: EngineerPace }>(VOICE_KEY);
export const useEngineer = create(() => ({
  enabled: false,
  muted: loadJson<boolean>(KEY) === true,
  voiceError: false,
  voiceLoading: false,
  previewPlaying: false,
  controls: {
    volume:
      typeof savedControls?.volume === 'number'
        ? Math.min(1, Math.max(0, savedControls.volume))
        : 1,
    anticipationMs:
      typeof savedControls?.anticipationMs === 'number'
        ? Math.min(700, Math.max(0, savedControls.anticipationMs))
        : 0,
    detail: savedControls?.detail === 'essential' ? 'essential' : 'full',
  } as RadioControls,
  voiceUri: typeof savedVoice?.voiceUri === 'string' ? savedVoice.voiceUri : 'radio:dora',
  pace:
    savedVoice?.pace === 'calma' || savedVoice?.pace === 'rapida'
      ? savedVoice.pace
      : ('normal' as EngineerPace),
}));

const samples = new Map<string, number>();
let previewRequest = 0;

export function engineerVoiceMs(phrase: string, estimateMs: number): number {
  const { voiceUri, pace } = useEngineer.getState();
  const pack = radioPack(voiceUri);
  return (
    (pack && radioClipMs(pack, phrase)) ||
    samples.get(phrase) ||
    (estimateMs * 1.1) / ENGINEER_PACES[pace]
  );
}

export function setRadioControls(change: Partial<RadioControls>): void {
  const controls = { ...useEngineer.getState().controls, ...change };
  setRadioClipVolume(controls.volume);
  useEngineer.setState({ controls });
  saveJson(RADIO_KEY, controls);
}

export function playEngineerVoice(
  phrase: string,
  test = false,
  done?: () => void,
  onStart?: () => void,
): boolean {
  if (!test && useEngineer.getState().previewPlaying) stopEngineerPreview();
  const { voiceUri, pace, controls } = useEngineer.getState();
  const pack = radioPack(voiceUri);
  if (pack) {
    const started = playRadioClip(pack, phrase, test, done, controls.volume);
    if (started) onStart?.();
    if (!started) useEngineer.setState({ voiceError: true });
    return started;
  }
  const started = speakPtBr(
    test ? 'engineerTest' : 'engineer',
    phrase,
    (elapsed) => {
      if (elapsed === null) useEngineer.setState({ voiceError: true });
      else {
        samples.set(phrase, elapsed);
        useEngineer.setState({ voiceError: false });
      }
      done?.();
    },
    { voiceUri, rate: ENGINEER_PACES[pace], volume: controls.volume, onStart },
  );
  if (!started) useEngineer.setState({ voiceError: true });
  return started;
}

export function setEngineerVoice(voiceUri: string, pace: EngineerPace): void {
  stopEngineerVoice();
  stopEngineerPreview();
  samples.clear();
  useEngineer.setState({ voiceUri, pace, voiceError: false });
  saveJson(VOICE_KEY, { voiceUri, pace });
  const { enabled, muted } = useEngineer.getState();
  if (enabled && !muted && radioPack(voiceUri)) testEngineerVoice(false);
}

export function stopEngineerVoice(): void {
  stopSpeech('engineer');
  stopRadioClip(false);
}

export function stopEngineerPreview(): void {
  previewRequest++;
  stopSpeech('engineerTest');
  stopRadioClip(true);
  useEngineer.setState({ voiceLoading: false, previewPlaying: false });
}

export function testEngineerVoice(sample = true): void {
  stopEngineerVoice();
  stopEngineerPreview();
  const pack = radioPack(useEngineer.getState().voiceUri);
  const play = (phrase: string) => {
    const started = playEngineerVoice(phrase, true, () =>
      useEngineer.setState({ previewPlaying: false }),
    );
    useEngineer.setState({ voiceLoading: false, previewPlaying: started });
  };
  if (!pack) {
    play(ENGINEER_PREVIEW);
    return;
  }
  const request = previewRequest;
  useEngineer.setState({ voiceLoading: true, voiceError: false });
  void prepareRadioPack(pack).then(
    () => {
      if (request !== previewRequest) return;
      play(sample ? 'preview' : ENGINEER_PREVIEW);
    },
    () => {
      if (request === previewRequest)
        useEngineer.setState({ voiceLoading: false, voiceError: true });
    },
  );
}

export function setEngineerEnabled(enabled: boolean, playVoice = true): void {
  useEngineer.setState({ enabled });
  if (enabled && playVoice && !useEngineer.getState().muted) testEngineerVoice(false);
  if (!enabled) {
    stopEngineerVoice();
    stopEngineerPreview();
  }
}

export function setEngineerMuted(muted: boolean, playVoice = true): void {
  useEngineer.setState({ muted });
  saveJson(KEY, muted);
  if (muted) {
    stopEngineerVoice();
    stopEngineerPreview();
  } else if (playVoice) testEngineerVoice(false);
}
