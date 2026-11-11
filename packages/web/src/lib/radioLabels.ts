/** pt-BR labels of the radio engineer preferences (spec do engenheiro de rádio). */

import type { RadioMode, SummaryFrequency, TrainingProfile } from '@gt7/shared';
import { t as uiText } from './i18n.ts';

export const RADIO_MODE_LABELS: Record<RadioMode, string> = {
  get training() {
    return uiText('Treino');
  },
  get qualifying() {
    return uiText('Classificação');
  },
  get race() {
    return uiText('Corrida');
  },
};

export const RADIO_MODE_HINTS: Record<RadioMode, string> = {
  get training() {
    return uiText('Orienta e corrige conforme o perfil.');
  },
  get qualifying() {
    return uiText(
      'Pneus na volta de preparação, silêncio na volta rápida e o resultado após a linha.',
    );
  },
  get race() {
    return uiText(
      'Só o que muda uma decisão: pneus, combustível e condição do carro. Não precisa de referência.',
    );
  },
};

export const TRAINING_PROFILE_LABELS: Record<TrainingProfile, string> = {
  get learnTrack() {
    return uiText('Aprender pista');
  },
  get gainTime() {
    return uiText('Ganhar tempo');
  },
  get consistency() {
    return uiText('Consistência');
  },
  get free() {
    return uiText('Livre · só alertas do carro');
  },
};

export const SPEECH_LEVEL_LABELS = {
  get essential() {
    return uiText('Essencial');
  },
  get detailed() {
    return uiText('Detalhado');
  },
  get mute() {
    return uiText('Mudo · só painel');
  },
} as const;

export const SUMMARY_LABELS: Record<SummaryFrequency, string> = {
  get lap() {
    return uiText('Por volta');
  },
  get block() {
    return uiText('Por bloco');
  },
  get onDemand() {
    return uiText('Sob demanda');
  },
  get off() {
    return uiText('Desligado');
  },
};
