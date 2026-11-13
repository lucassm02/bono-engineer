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

/**
 * Reads the state of the task voice of the voice in use and, when the driver allowed the
 * download and the voice is missing (a language or voice change), starts it in the background.
 */
export async function syncTaskVoice(): Promise<void> {
  const voice = voicePack();
  if (!voice) return;
  try {
    let status = await api.taskVoice(voice);
    if (status.enabled && status.status === 'idle') status = await api.downloadTaskVoice(voice);
    apply(status);
  } catch {
    // offline or an old server: the tasks are then only shown on the panel
  }
}

/** The driver allows (or stops) the download of the task voice. */
export async function setTaskVoiceEnabled(enabled: boolean): Promise<void> {
  const voice = voicePack();
  if (!voice) return;
  try {
    apply(await api.setTaskVoiceEnabled(enabled, voice));
  } catch (e) {
    addNotice('warn', (e as Error).message);
  }
}

/** Downloads again after a failure. */
export async function retryTaskVoice(): Promise<void> {
  const voice = voicePack();
  if (!voice) return;
  try {
    apply(await api.downloadTaskVoice(voice));
  } catch (e) {
    addNotice('warn', (e as Error).message);
  }
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
