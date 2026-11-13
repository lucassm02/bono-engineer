/**
 * Engineer tasks in the app (spec 20): the count of proposals waiting for the driver (the Home card
 * and the badge), the state of the downloaded task voice, and what the radio did with a task.
 */

import { type ApiTaskVoice, taskPieceKey } from '@gt7/shared';
import { create } from 'zustand';
import { api } from '../analysis/api.ts';
import { pickRadioPack, prepareRadioPack, setTaskPack } from '../lib/engineerClips.ts';
import { t } from '../lib/i18n.ts';
import { radioVoice } from '../lib/radioVoices.ts';
import { playEngineerVoice, useEngineer } from './engineer.ts';
import { addNotice } from './uiStore.ts';

interface TasksState {
  /** Proposals waiting for the driver, all tracks. */
  proposals: number;
  /** State of the task voice of the voice in use. */
  voice: ApiTaskVoice | null;
}

export const useTasks = create<TasksState>(() => ({ proposals: 0, voice: null }));

/** Reads the proposals count (page load and after the connection returns). */
export async function refreshTaskProposals(): Promise<void> {
  try {
    const { proposals } = await api.tasks({ status: 'proposed' });
    useTasks.setState({ proposals });
  } catch {
    // the badge only shows what is known
  }
}

/** The server said the proposals changed (WebSocket). A new one is announced once. */
export function noteTaskProposals(proposals: number): void {
  const before = useTasks.getState().proposals;
  useTasks.setState({ proposals });
  if (proposals > before) {
    addNotice(
      'info',
      proposals === 1
        ? t('O agente propôs uma tarefa para o engenheiro. Aprove em Tarefas.')
        : t('O agente propôs {0} tarefas para o engenheiro. Aprove em Tarefas.', proposals),
    );
  }
}

// ---- the downloaded voice of the tasks --------------------------------------------------------

let pollTimer: ReturnType<typeof setTimeout> | null = null;

function voicePack(): string | null {
  return radioVoice(useEngineer.getState().voiceUri)?.pack ?? null;
}

function apply(status: ApiTaskVoice): void {
  const voiceId = useEngineer.getState().voiceUri;
  if (radioVoice(voiceId)?.pack !== status.voice) return;
  useTasks.setState({ voice: status });
  const pack = setTaskPack(voiceId, status.status === 'ready' ? status.file : null);
  if (pack) void prepareRadioPack(pack).catch(() => {});
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (status.status === 'downloading') pollTimer = setTimeout(() => void syncTaskVoice(), 1200);
}

// Keep a read started by polling from replacing the result of a download action.
let voiceRequest: Promise<ApiTaskVoice | null> = Promise.resolve(null);

function requestTaskVoice(
  request: (voice: string) => Promise<ApiTaskVoice>,
  notifyError = false,
): Promise<ApiTaskVoice | null> {
  const voice = voicePack();
  if (!voice) return Promise.resolve(null);
  voiceRequest = voiceRequest.then(async () => {
    if (voicePack() !== voice) return null;
    try {
      const status = await request(voice);
      if (voicePack() !== voice) return null;
      apply(status);
      return status;
    } catch (error) {
      if (voicePack() !== voice) return null;
      const current = useTasks.getState().voice;
      if (current?.status === 'downloading') {
        apply({ ...current, status: 'failed', progress: null, error: null });
      }
      if (notifyError) addNotice('warn', (error as Error).message);
      return null;
    }
  });
  return voiceRequest;
}

/** Reads the selected voice and starts a missing download if the driver already opted in. */
export function syncTaskVoice(): Promise<ApiTaskVoice | null> {
  return requestTaskVoice(async (voice) => {
    const status = await api.taskVoice(voice);
    return status.enabled && status.status === 'idle' ? api.downloadTaskVoice(voice) : status;
  });
}

/** The driver allows (or stops) the download of the task voice. */
export function setTaskVoiceEnabled(enabled: boolean): Promise<ApiTaskVoice | null> {
  return requestTaskVoice((voice) => api.setTaskVoiceEnabled(enabled, voice), true);
}

/** Downloads again after a failure. */
export function retryTaskVoice(): Promise<ApiTaskVoice | null> {
  return requestTaskVoice(api.downloadTaskVoice, true);
}

let started = false;
/** Called once at start: reads the proposals and follows the voice in use. */
export function startTasks(): void {
  if (started) return;
  started = true;
  void refreshTaskProposals();
  void syncTaskVoice();
  let last = useEngineer.getState().voiceUri;
  useEngineer.subscribe((state) => {
    if (state.voiceUri === last) return;
    last = state.voiceUri;
    useTasks.setState({ voice: null });
    void syncTaskVoice();
  });
}

/** "Ouvir": plays the sentence with the task voice (downloaded) of the voice in use. */
export async function listenTask(keys: readonly string[]): Promise<boolean> {
  const { voiceUri } = useEngineer.getState();
  const pack = pickRadioPack(voiceUri, [...keys]);
  if (!pack) {
    addNotice(
      'warn',
      t('Para ouvir, baixe a voz das tarefas em Configurações → Engenheiro → Tarefas.'),
      6000,
    );
    return false;
  }
  try {
    await prepareRadioPack(pack);
  } catch {
    addNotice('warn', t('Não foi possível carregar o áudio das tarefas.'));
    return false;
  }
  return playEngineerVoice([...keys], true);
}

/** The clip keys of a stored task, in speaking order. */
export function taskKeys(ids: readonly string[]): string[] {
  return ids.flatMap((id) => taskPieceKey(id) ?? []);
}
