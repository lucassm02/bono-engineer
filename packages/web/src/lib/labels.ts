import {
  type ConnectionState,
  type DeltaReferenceKind,
  type SurfaceChar,
  VIEW_IDS,
  type ViewId,
} from '@gt7/shared';

export const VIEW_LABELS: Record<ViewId, string> = {
  corrida: 'Corrida',
  deltaGrande: 'Delta grande',
  pneus: 'Pneus',
  inputs: 'Inputs',
  motor: 'Motor e câmbio',
  mapa: 'Mapa',
  tempos: 'Tempos',
  combustivel: 'Combustível',
  forcasG: 'Forças G',
  treinoCurva: 'Treino de curva',
  personalizada: 'Personalizada',
};

export const VIEW_DESCRIPTIONS: Record<ViewId, string> = {
  corrida: 'Delta, tempos, setores, marcha e velocidade',
  deltaGrande: 'Só o delta, enorme, para ler de longe',
  pneus: 'Temperatura, patinagem e suspensão por roda',
  inputs: 'Acelerador, freio, volante e gráfico de 10 s',
  motor: 'RPM, marchas, turbo e óleo',
  mapa: 'Traçado com sua posição e microssetores',
  tempos: 'Tabela de voltas e setores da sessão',
  combustivel: 'Consumo, voltas restantes e energia',
  forcasG: 'Círculo de G com rastro',
  treinoCurva: 'Metas da próxima curva contra a referência',
  personalizada: 'Grade de widgets montada por você',
};

/** Views implemented in this build; the others show a placeholder. */
export const IMPLEMENTED_VIEWS: ReadonlySet<ViewId> = new Set<ViewId>(VIEW_IDS);

export const DELTA_REFERENCE_LABELS: Record<DeltaReferenceKind, string> = {
  personalBest: 'Melhor pessoal',
  sessionBest: 'Melhor da sessão',
  reference: 'Top capturado',
};

export const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  disconnected: 'Console desconectado',
  connecting: 'Procurando o console',
  switchingFormat: 'Trocando formato',
  menu: 'No menu',
  onTrack: 'Na pista',
  paused: 'Pausado',
  replay: 'Replay',
};

const SURFACE_LABELS: Record<string, string> = {
  T: 'Asfalto',
  C: 'Zebra',
  D: 'Terra',
  G: 'Grama',
  S: 'Areia',
  s: 'Neve',
};

export function surfaceLabel(c: SurfaceChar): string {
  return SURFACE_LABELS[c] ?? `?${c}`;
}

export const WHEEL_LABELS = ['DE', 'DD', 'TE', 'TD'] as const;
