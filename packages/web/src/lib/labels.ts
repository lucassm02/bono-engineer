import {
  type ConnectionState,
  type DeltaReferenceKind,
  type SurfaceChar,
  VIEW_IDS,
  type ViewId,
} from '@gt7/shared';
import { getLanguage, t as uiText } from './i18n.ts';

export const VIEW_LABELS: Record<ViewId, string> = {
  get race() {
    return uiText('Corrida');
  },
  get bigDelta() {
    return uiText('Delta grande');
  },
  get tyres() {
    return uiText('Pneus');
  },
  get inputs() {
    return uiText('Inputs');
  },
  get engine() {
    return uiText('Motor e câmbio');
  },
  get map() {
    return uiText('Mapa');
  },
  get times() {
    return uiText('Tempos');
  },
  get fuel() {
    return uiText('Combustível');
  },
  get gForces() {
    return uiText('Forças G');
  },
  get cornerDrill() {
    return uiText('Treino de curva');
  },
  get custom() {
    return uiText('Personalizada');
  },
};

export const VIEW_DESCRIPTIONS: Record<ViewId, string> = {
  get race() {
    return uiText('Delta, tempos, setores, marcha e velocidade');
  },
  get bigDelta() {
    return uiText('Só o delta, enorme, para ler de longe');
  },
  get tyres() {
    return uiText('Temperatura, patinagem e suspensão por roda');
  },
  get inputs() {
    return uiText('Acelerador, freio, volante e gráfico de 10 s');
  },
  get engine() {
    return uiText('RPM, marchas, turbo e óleo');
  },
  get map() {
    return uiText('Traçado com sua posição e microssetores');
  },
  get times() {
    return uiText('Tabela de voltas e setores da sessão');
  },
  get fuel() {
    return uiText('Consumo, voltas restantes e energia');
  },
  get gForces() {
    return uiText('Círculo de G com rastro');
  },
  get cornerDrill() {
    return uiText('Metas da próxima curva contra a referência');
  },
  get custom() {
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
