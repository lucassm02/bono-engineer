/** pt-BR labels of the radio engineer preferences (spec do engenheiro de rádio). */

import type { RadioMode, SummaryFrequency, TrainingProfile } from '@gt7/shared';

export const RADIO_MODE_LABELS: Record<RadioMode, string> = {
  training: 'Treino',
  qualifying: 'Classificação',
  race: 'Corrida',
};

export const RADIO_MODE_HINTS: Record<RadioMode, string> = {
  training: 'Orienta e corrige conforme o perfil.',
  qualifying: 'Pneus na volta de preparação, silêncio na volta rápida e o resultado após a linha.',
  race: 'Só o que muda uma decisão: pneus, combustível e condição do carro. Não precisa de referência.',
};

export const TRAINING_PROFILE_LABELS: Record<TrainingProfile, string> = {
  learnTrack: 'Aprender pista',
  gainTime: 'Ganhar tempo',
  consistency: 'Consistência',
  free: 'Livre · só alertas do carro',
};

export const SPEECH_LEVEL_LABELS = {
  essential: 'Essencial',
  detailed: 'Detalhado',
  mute: 'Mudo · só painel',
} as const;

export const SUMMARY_LABELS: Record<SummaryFrequency, string> = {
  lap: 'Por volta',
  block: 'Por bloco',
  onDemand: 'Sob demanda',
  off: 'Desligado',
};
