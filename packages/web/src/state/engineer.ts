import {
  ENGINEER_PACES,
  type EngineerPace,
  type EngineerRadioSettings,
  type Language,
  normalizeRadioControls,
  type RadioControls,
} from '@gt7/shared';
import { create } from 'zustand';
import {
  pickRadioPack,
  playRadioUtterance,
  prepareRadioPack,
  type RadioPack,
  radioAudioRunning,
  radioPack,
  radioPackStatus,
  radioUtteranceMs,
  setRadioClipVolume,
  stopRadioClip,
} from '../lib/engineerClips.ts';
import { getLanguage, subscribeLanguage, t } from '../lib/i18n.ts';
import { RADIO_HELLO, RADIO_PREVIEW_KEY, type RadioUtterance } from '../lib/radioPhrases.ts';
import { defaultRadioVoice, migrateRadioVoice, radioVoice } from '../lib/radioVoices.ts';
import { loadJson, saveJson } from '../lib/storage.ts';
import { send } from '../net/transport.ts';
import { offerHint } from './tourHints.ts';
import { addNotice, useUi } from './uiStore.ts';

const KEY = 'gt7.engineer.muted';
const HUD_KEY = 'gt7.engineer.hudVisible';
const VOICE_KEY = 'gt7.engineer.voice';
const LEGACY_RADIO_KEY = 'gt7.engineer.controls';
const RADIO_KEY = 'gt7.engineer.controls.v2';
const ENABLED_KEY = 'gt7.engineer.enabled';

/** Saved `gt7.engineer.enabled` → on/off. Nothing saved (or anything but `true`) = off, as before. */
export function migrateEngineerEnabled(saved: unknown): boolean {
  return saved === true;
}
export { ENGINEER_PACES, type EngineerPace, type RadioControls };
export const migrateRadioControls = normalizeRadioControls;

const savedControls = loadJson<unknown>(RADIO_KEY);
const legacyControls = savedControls ? null : loadJson<unknown>(LEGACY_RADIO_KEY);
const initialControls = normalizeRadioControls(savedControls ?? legacyControls);
// The previous default was stored even for drivers who had never edited the mode list.
if (legacyControls && initialControls.taskModes.join(',') === 'training,qualifying')
  initialControls.taskModes = ['training'];
if (legacyControls) saveJson(RADIO_KEY, initialControls);

/** Saved `gt7.engineer.voice` → current voice ID and pace (see migrateRadioVoice). */
export function migrateVoicePrefs(saved: unknown): { voiceUri: string; pace: EngineerPace } {
  const prefs = (saved && typeof saved === 'object' ? saved : {}) as {
    voiceUri?: unknown;
    pace?: unknown;
  };
  // `calma` and `rapida` are the ids saved before they were renamed to English
  const named = prefs.pace === 'calma' ? 'calm' : prefs.pace === 'rapida' ? 'fast' : prefs.pace;
  const pace: EngineerPace = named === 'calm' || named === 'fast' ? named : 'normal';
  return { voiceUri: migrateRadioVoice(prefs.voiceUri), pace };
}

const voiceKey = (language: Language) =>
  language === 'pt-BR' ? VOICE_KEY : `${VOICE_KEY}.${language}`;

function loadVoice(language: Language) {
  const prefs = migrateVoicePrefs(loadJson(voiceKey(language)));
  if (radioVoice(prefs.voiceUri)?.language !== language)
    prefs.voiceUri = defaultRadioVoice(language).id;
  return prefs;
}

const initialVoice = loadVoice(getLanguage());

export const useEngineer = create(() => ({
  /** Persisted: the engineer stays on after restarting the app (spec 03 RF2). */
  enabled: migrateEngineerEnabled(loadJson<unknown>(ENABLED_KEY)),
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
let preparedVoice: string | null = null;
let radioEdits: Partial<EngineerRadioSettings> = {};

function publishRadioEdit(change: Partial<EngineerRadioSettings>): void {
  radioEdits = { ...radioEdits, ...change };
  const ui = useUi.getState();
  if (ui.source === 'server' && ui.serverStatus?.engineerRadio !== undefined) {
    syncEngineerRadio(ui.serverStatus.engineerRadio, false);
  }
}

/** Initialize once from the previous local choices, or receive another device's changes. */
export function syncEngineerRadio(
  saved: EngineerRadioSettings | null | undefined,
  receive = true,
): void {
  if (saved === undefined) return;
  const hasEdits = Object.keys(radioEdits).length > 0;
  const { controls, enabled, muted, pace, voiceUri } = useEngineer.getState();
  if (!saved) {
    if (hasEdits || savedControls || legacyControls || enabled || globalThis.window?.bonoDiscord) {
      if (
        send({
          type: 'setEngineerRadio',
          settings: radioEdits,
          initial: { ...controls, enabled, muted, pace },
        })
      )
        radioEdits = {};
    }
    return;
  }
  if (receive) {
    const next = { ...saved, ...radioEdits };
    const incoming = normalizeRadioControls(next);
    const changed = JSON.stringify(incoming) !== JSON.stringify(controls);
    if (changed) {
      setRadioClipVolume(incoming.volume);
      saveJson(RADIO_KEY, incoming);
    }
    if (enabled !== next.enabled) saveJson(ENABLED_KEY, next.enabled);
    if (muted !== next.muted) saveJson(KEY, next.muted);
    if (pace !== next.pace) saveJson(voiceKey(getLanguage()), { voiceUri, pace: next.pace });
    if (!next.enabled || next.muted || incoming.volume === 0) stopEngineerVoice();
    if (changed || enabled !== next.enabled || muted !== next.muted || pace !== next.pace)
      useEngineer.setState({
        controls: changed ? incoming : controls,
        enabled: next.enabled,
        muted: next.muted,
        pace: next.pace,
      });
  }
  if (hasEdits && send({ type: 'setEngineerRadio', settings: radioEdits })) radioEdits = {};
}

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
  publishRadioEdit(change);
}

/** Decode the chosen pack; when it fails, prepare the default pack for the fallback. */
function prepareVoice(voiceId: string): Promise<RadioPack | null> {
  const chosen = radioPack(voiceId);
  const fallback = radioPack(defaultRadioVoice(radioVoice(voiceId)?.language ?? getLanguage()).id);
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
    if (!test) offerHint('engineerSpoke');
    const voiceFallback = pack.voiceId !== voiceUri;
    if (useEngineer.getState().voiceError || useEngineer.getState().voiceFallback !== voiceFallback)
      useEngineer.setState({ voiceError: false, voiceFallback });
  } else if (!pickRadioPack(voiceUri, utterance, (p) => radioPackStatus(p) === 'loading'))
    useEngineer.setState({ voiceError: true });
  return started;
}

export function setEngineerVoice(voiceUri: string, pace: EngineerPace): void {
  const language = getLanguage();
  const choice = radioVoice(voiceUri);
  const voice = choice?.language === language ? choice.id : defaultRadioVoice(language).id;
  stopEngineerVoice();
  stopEngineerPreview();
  useEngineer.setState({ voiceUri: voice, pace, voiceError: false, voiceFallback: false });
  saveJson(voiceKey(language), { voiceUri: voice, pace });
  publishRadioEdit({ pace });
  syncDiscordVoice();
  const { enabled, muted } = useEngineer.getState();
  if (enabled && !muted) testEngineerVoice(false);
}

export function syncDiscordVoice(): void {
  const pack = radioVoice(useEngineer.getState().voiceUri)?.pack;
  if (!pack) return;
  void globalThis.window?.bonoDiscord?.setVoice?.(pack).catch(() => {
    addNotice('warn', t('Não foi possível atualizar a voz no Discord.'));
  });
}

subscribeLanguage(() => {
  const { voiceUri, pace } = loadVoice(getLanguage());
  setEngineerVoice(voiceUri, pace);
});

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
  const inRaceMode = useEngineer.getState().controls.mode === 'race';
  prepareEngineerVoice(sample ? RADIO_PREVIEW_KEY : inRaceMode ? null : RADIO_HELLO);
}

export function engineerAudioReady(): boolean {
  const { voiceUri } = useEngineer.getState();
  return preparedVoice === voiceUri && radioAudioRunning();
}

/** A saved On switch can prepare the voice silently at the next browser interaction. */
export function prepareSavedEngineerAudio(): void {
  const { enabled, muted, voiceLoading } = useEngineer.getState();
  const { profile, serverStatus } = useUi.getState();
  const outputDevice = serverStatus?.engineerAudioDeviceId;
  if (
    !enabled ||
    muted ||
    voiceLoading ||
    (outputDevice && outputDevice !== profile.deviceId) ||
    typeof AudioContext === 'undefined' ||
    engineerAudioReady()
  )
    return;
  prepareEngineerVoice(null);
}

function prepareEngineerVoice(utterance: RadioUtterance | null): void {
  const request = ++previewRequest;
  const { voiceUri } = useEngineer.getState();
  useEngineer.setState({ voiceLoading: true, voiceError: false });
  void prepareVoice(voiceUri).then((pack) => {
    if (request !== previewRequest) return;
    if (!pack) {
      useEngineer.setState({ voiceLoading: false, voiceError: true });
      return;
    }
    preparedVoice = voiceUri;
    const started =
      utterance !== null &&
      playEngineerVoice(utterance, true, () => useEngineer.setState({ previewPlaying: false }));
    useEngineer.setState({
      voiceLoading: false,
      previewPlaying: started,
      voiceFallback: pack.voiceId !== voiceUri,
    });
  });
}

export function setEngineerEnabled(enabled: boolean, playVoice = true): void {
  useEngineer.setState({ enabled });
  saveJson(ENABLED_KEY, enabled);
  publishRadioEdit({ enabled });
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
  publishRadioEdit({ muted });
  if (muted) {
    stopEngineerVoice();
    stopEngineerPreview();
  } else if (playVoice) testEngineerVoice(false);
}
