import {
  type ConnectionState,
  type DeltaReferenceKind,
  type SurfaceChar,
  VIEW_IDS,
  type ViewId,
} from '@gt7/shared';
import { getLanguage, t as uiText } from './i18n.ts';

export const VIEW_LABELS: Record<ViewId, string> = {
  get corrida() {
    return uiText('Corrida');
  },
  get deltaGrande() {
    return uiText('Delta grande');
  },
  get pneus() {
    return uiText('Pneus');
  },
  get inputs() {
    return uiText('Inputs');
  },
  get motor() {
    return uiText('Motor e câmbio');
  },
  get mapa() {
    return uiText('Mapa');
  },
  get tempos() {
    return uiText('Tempos');
  },
  get combustivel() {
    return uiText('Combustível');
  },
  get forcasG() {
    return uiText('Forças G');
  },
  get treinoCurva() {
    return uiText('Treino de curva');
  },
  get personalizada() {
    return uiText('Personalizada');
  },
};

export const VIEW_DESCRIPTIONS: Record<ViewId, string> = {
  get corrida() {
    return uiText('Delta, tempos, setores, marcha e velocidade');
  },
  get deltaGrande() {
    return uiText('Só o delta, enorme, para ler de longe');
  },
  get pneus() {
    return uiText('Temperatura, patinagem e suspensão por roda');
  },
  get inputs() {
    return uiText('Acelerador, freio, volante e gráfico de 10 s');
  },
  get motor() {
    return uiText('RPM, marchas, turbo e óleo');
  },
  get mapa() {
    return uiText('Traçado com sua posição e microssetores');
  },
  get tempos() {
    return uiText('Tabela de voltas e setores da sessão');
  },
  get combustivel() {
    return uiText('Consumo, voltas restantes e energia');
  },
  get forcasG() {
    return uiText('Círculo de G com rastro');
  },
  get treinoCurva() {
    return uiText('Metas da próxima curva contra a referência');
  },
  get personalizada() {
    return uiText('Grade de widgets montada por você');
  },
};

/** Views implemented in this build; the others show a placeholder. */
export const IMPLEMENTED_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(VIEW_IDS);

export const DELTA_REFERENCE_LABELS: Record<DeltaReferenceKind, string> = {
  get personalBest() {
    return uiText('Melhor pessoal');
  },
  get sessionBest() {
    return uiText('Melhor da sessão');
  },
  get reference() {
    return uiText('Volta de referência');
  },
};

export const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  get disconnected() {
    return uiText('Console desconectado');
  },
  get connecting() {
    return uiText('Procurando o console');
  },
  get switchingFormat() {
    return uiText('Trocando formato');
  },
  get menu() {
    return uiText('No menu');
  },
  get onTrack() {
    return uiText('Na pista');
  },
  get paused() {
    return uiText('Pausado');
  },
  get replay() {
    return uiText('Replay');
  },
};

const SURFACE_LABELS: Record<string, string> = {
  get T() {
    return uiText('Asfalto');
  },
  get C() {
    return uiText('Zebra');
  },
  get D() {
    return uiText('Terra');
  },
  get G() {
    return uiText('Grama');
  },
  get S() {
    return uiText('Areia');
  },
  get s() {
    return uiText('Neve');
  },
};

export function surfaceLabel(c: SurfaceChar): string {
  return SURFACE_LABELS[c] ?? `?${c}`;
}

const WHEEL_LABELS = {
  'pt-BR': ['DE', 'DD', 'TE', 'TD'],
  en: ['FL', 'FR', 'RL', 'RR'],
  es: ['DI', 'DD', 'TI', 'TD'],
} as const;

export function wheelLabel(index: number): string {
  return WHEEL_LABELS[getLanguage()][index] ?? '';
}
