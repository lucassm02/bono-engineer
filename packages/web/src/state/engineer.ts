import { normalizeRadioPreferences, type RadioPreferences } from '@gt7/shared';
import { create } from 'zustand';
import {
  pickRadioPack,
  playRadioUtterance,
  prepareRadioPack,
  type RadioPack,
  radioPack,
  radioPackStatus,
  radioUtteranceMs,
  setRadioClipVolume,
  stopRadioClip,
} from '../lib/engineerClips.ts';
import { RADIO_HELLO, RADIO_PREVIEW_KEY, type RadioUtterance } from '../lib/radioPhrases.ts';
import { DEFAULT_RADIO_VOICE, migrateRadioVoice } from '../lib/radioVoices.ts';
import { loadJson, saveJson } from '../lib/storage.ts';

const KEY = 'gt7.engineer.muted';
const HUD_KEY = 'gt7.engineer.hudVisible';
const VOICE_KEY = 'gt7.engineer.voice';
const RADIO_KEY = 'gt7.engineer.controls';
/**
 * Radio controls saved under `gt7.engineer.controls`: audio (volume, anticipation) plus the radio
 * preferences (mode, Essencial/Detalhado, Treino profile, summary, praise). Mudo is the separate
 * `gt7.engineer.muted` switch. The old `detail` field migrates in normalizeRadioPreferences.
 */
export interface RadioControls extends RadioPreferences {
  volume: number;
  anticipationMs: number;
}

/** Saved controls → current model (unknown fields dropped, old `detail` migrated). */
export function migrateRadioControls(saved: unknown): RadioControls {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Record<string, unknown>>;
  return {
    volume: typeof s.volume === 'number' ? Math.min(1, Math.max(0, s.volume)) : 1,
    anticipationMs:
      typeof s.anticipationMs === 'number' ? Math.min(700, Math.max(0, s.anticipationMs)) : 0,
    ...normalizeRadioPreferences(saved),
  };
}

const savedControls = loadJson<unknown>(RADIO_KEY);
const initialControls = migrateRadioControls(savedControls);
if (savedControls && JSON.stringify(savedControls) !== JSON.stringify(initialControls))
  saveJson(RADIO_KEY, initialControls);
/** Playback rate of the neural clips per pace (pitch follows the rate). */
export const ENGINEER_PACES = { calma: 0.94, normal: 1, rapida: 1.08 } as const;
export type EngineerPace = keyof typeof ENGINEER_PACES;

/** Saved `gt7.engineer.voice` → current voice ID and pace (see migrateRadioVoice). */
export function migrateVoicePrefs(saved: unknown): { voiceUri: string; pace: EngineerPace } {
  const prefs = (saved && typeof saved === 'object' ? saved : {}) as {
    voiceUri?: unknown;
    pace?: unknown;
  };
  const pace = prefs.pace === 'calma' || prefs.pace === 'rapida' ? prefs.pace : 'normal';
  return { voiceUri: migrateRadioVoice(prefs.voiceUri), pace };
}

const savedVoice = loadJson<unknown>(VOICE_KEY);
const initialVoice = migrateVoicePrefs(savedVoice);
if ((savedVoice as { voiceUri?: unknown } | null)?.voiceUri !== initialVoice.voiceUri)
  saveJson(VOICE_KEY, initialVoice);

export const useEngineer = create(() => ({
  enabled: false,
  hudVisible: loadJson<boolean>(HUD_KEY) !== false,
  muted: loadJson<boolean>(KEY) === true,
  /** No pack can play audio right now: the instructions stay on the panel only. */
  voiceError: false,
  /** The chosen voice failed and the default voice is playing instead. */
  voiceFallback: false,
  voiceLoading: false,
  previewPlaying: false,
  controls: initialControls,
  /** Neural voice ID (`radio:*`). Field name kept from the device-voice era. */
  voiceUri: initialVoice.voiceUri,
  pace: initialVoice.pace,
}));

let previewRequest = 0;

/**
 * Exact playback time (ms) of an utterance with the pack that would play it now, or null when
 * no pack can play it. The scheduler uses this to decide whether a call still fits.
 */
export function engineerUtteranceMs(utterance: RadioUtterance): number | null {
  const { voiceUri, pace } = useEngineer.getState();
  const pack = pickRadioPack(voiceUri, utterance);
  return (pack && radioUtteranceMs(pack, utterance, ENGINEER_PACES[pace])) ?? null;
}

/** `engineerCall` estimator: phrases without a playable clip never fit (panel only). */
export function engineerVoiceMs(phrase: RadioUtterance, _estimateMs?: number): number {
  return engineerUtteranceMs(phrase) ?? Number.POSITIVE_INFINITY;
}

export function setRadioControls(change: Partial<RadioControls>): void {
  const controls = { ...useEngineer.getState().controls, ...change };
  setRadioClipVolume(controls.volume);
  useEngineer.setState({ controls });
  saveJson(RADIO_KEY, controls);
}

/** Decode the chosen pack; when it fails, prepare the default pack for the fallback. */
function prepareVoice(voiceId: string): Promise<RadioPack | null> {
  const chosen = radioPack(voiceId);
  const fallback = radioPack(DEFAULT_RADIO_VOICE);
  const tryPack = (pack: RadioPack | null) =>
    pack ? prepareRadioPack(pack).then(() => pack) : Promise.reject(new Error('Sem pacote'));
  return tryPack(chosen).catch(() =>
    fallback && fallback.file !== chosen?.file ? tryPack(fallback).catch(() => null) : null,
  );
}

export function playEngineerVoice(
  utterance: RadioUtterance,
  test = false,
  done?: () => void,
  onStart?: () => void,
): boolean {
  if (!test && useEngineer.getState().previewPlaying) stopEngineerPreview();
  const { voiceUri, pace, controls } = useEngineer.getState();
  const pack = pickRadioPack(voiceUri, utterance, (p) => radioPackStatus(p) === 'ready');
  const started =
    !!pack &&
    playRadioUtterance(pack, utterance, test, done, controls.volume, ENGINEER_PACES[pace]);
  if (started) {
    onStart?.();
    const voiceFallback = pack.voiceId !== voiceUri;
    if (useEngineer.getState().voiceError || useEngineer.getState().voiceFallback !== voiceFallback)
      useEngineer.setState({ voiceError: false, voiceFallback });
  } else if (!pickRadioPack(voiceUri, utterance, (p) => radioPackStatus(p) === 'loading'))
    useEngineer.setState({ voiceError: true });
  return started;
}

export function setEngineerVoice(voiceUri: string, pace: EngineerPace): void {
  const voice = migrateRadioVoice(voiceUri);
  stopEngineerVoice();
  stopEngineerPreview();
  useEngineer.setState({ voiceUri: voice, pace, voiceError: false, voiceFallback: false });
  saveJson(VOICE_KEY, { voiceUri: voice, pace });
  const { enabled, muted } = useEngineer.getState();
  if (enabled && !muted) testEngineerVoice(false);
}

export function stopEngineerVoice(): void {
  stopRadioClip(false);
}

export function stopEngineerPreview(): void {
  previewRequest++;
  stopRadioClip(true);
  useEngineer.setState({ voiceLoading: false, previewPlaying: false });
}

/** Preview (`sample`) or the short call played when the radio is enabled. */
export function testEngineerVoice(sample = true): void {
  stopEngineerVoice();
  stopEngineerPreview();
  const request = previewRequest;
  useEngineer.setState({ voiceLoading: true, voiceError: false });
  void prepareVoice(useEngineer.getState().voiceUri).then((pack) => {
    if (request !== previewRequest) return;
    if (!pack) {
      useEngineer.setState({ voiceLoading: false, voiceError: true });
      return;
    }
    const started = playEngineerVoice(sample ? RADIO_PREVIEW_KEY : RADIO_HELLO, true, () =>
      useEngineer.setState({ previewPlaying: false }),
    );
    useEngineer.setState({ voiceLoading: false, previewPlaying: started });
  });
}

export function setEngineerEnabled(enabled: boolean, playVoice = true): void {
  useEngineer.setState({ enabled });
  if (enabled && playVoice && !useEngineer.getState().muted) testEngineerVoice(false);
  if (!enabled) {
    stopEngineerVoice();
    stopEngineerPreview();
  }
}

export function toggleEngineerHud(): void {
  const hudVisible = !useEngineer.getState().hudVisible;
  useEngineer.setState({ hudVisible });
  saveJson(HUD_KEY, hudVisible);
}

export function setEngineerMuted(muted: boolean, playVoice = true): void {
  useEngineer.setState({ muted });
  saveJson(KEY, muted);
  if (muted) {
    stopEngineerVoice();
    stopEngineerPreview();
  } else if (playVoice) testEngineerVoice(false);
}
