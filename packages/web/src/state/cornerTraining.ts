/**
 * "Treino de curva" preferences (zustand, persisted locally) and the optional spoken feedback.
 *
 * Audio uses the Web Speech API (`speechSynthesis`, pt-BR voice when available), is off by default
 * and speaks at most one phrase per corner pass, only while the Treino de curva view is on screen
 * (and, when a corner is pinned, only for that corner).
 */

import { create } from 'zustand';
import type { CornerPass, PassAssessment } from '../lib/cornerPass.ts';
import { loadJson, saveJson } from '../lib/storage.ts';
import { useUi } from './uiStore.ts';

interface CornerTrainingState {
  audio: boolean;
  /** Focus on one corner (null = always the next one). */
  pinnedCornerId: string | null;
}

const KEY = 'gt7.cornerTraining';

function initial(): CornerTrainingState {
  const s = loadJson<Partial<CornerTrainingState>>(KEY);
  return {
    audio: s?.audio === true,
    pinnedCornerId: typeof s?.pinnedCornerId === 'string' ? s.pinnedCornerId : null,
  };
}

export const useCornerTraining = create<CornerTrainingState>()(initial);

function persist(): void {
  const { audio, pinnedCornerId } = useCornerTraining.getState();
  saveJson(KEY, { audio, pinnedCornerId });
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

let voice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (!speechSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === 'pt-BR') ??
    voices.find((v) => v.lang.toLowerCase().startsWith('pt')) ??
    null
  );
}

function speak(text: string): void {
  if (!speechSupported() || !text) return;
  try {
    const synth = window.speechSynthesis;
    voice ??= pickVoice();
    synth.cancel(); // never queue stale phrases
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    if (voice) u.voice = voice;
    u.rate = 1.1;
    synth.speak(u);
  } catch {
    // speech unavailable
  }
}

export function setCornerAudio(on: boolean): void {
  useCornerTraining.setState({ audio: on });
  persist();
  // Speaking inside the tap unlocks audio on iOS.
  if (on) speak('Áudio do treino ligado');
  else if (speechSupported()) window.speechSynthesis.cancel();
}

export function setPinnedCorner(id: string | null): void {
  useCornerTraining.setState({ pinnedCornerId: id });
  persist();
}

let lastSpokenSeq = -1;
let lastSpokenAt = 0;
/** Global minimum gap between phrases (back-to-back corners). */
const MIN_GAP_MS = 2500;

/** Called by the live pipeline when a corner pass completes. */
export function announceCornerPass(pass: CornerPass, a: PassAssessment): void {
  const { audio, pinnedCornerId } = useCornerTraining.getState();
  if (!audio || !a.phrase) return;
  if (useUi.getState().currentView !== 'treinoCurva') return;
  if (pinnedCornerId && pass.cornerId !== pinnedCornerId) return;
  const now = Date.now();
  if (pass.seq === lastSpokenSeq || now - lastSpokenAt < MIN_GAP_MS) return;
  lastSpokenSeq = pass.seq;
  lastSpokenAt = now;
  speak(a.phrase);
}
