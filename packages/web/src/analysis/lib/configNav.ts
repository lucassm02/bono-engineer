/**
 * Configurações: grupos, âncoras antigas, índice de busca, passos pendentes do assistente e o
 * resumo de saúde. Tudo puro (sem React), para ser testado.
 */

import {
  type ConsoleConnection,
  type DeviceProfile,
  type FirewallStatus,
  normalizeDeviceProfile,
  type ViewId,
} from '@gt7/shared';
import { describeLink, type LinkTone } from '../../lib/consoleLink.ts';
import { type EngineerAudioTarget, engineerStateText, recordingStateText } from '../../lib/copy.ts';
import { t as uiText } from '../../lib/i18n.ts';

// ---------------------------------------------------------------------------------------------
// Grupos e rota
// ---------------------------------------------------------------------------------------------

export type ConfigGroupId = 'inicio' | 'console' | 'engenheiro' | 'painel' | 'contas' | 'sobre';

export const CONFIG_GROUP_IDS: readonly ConfigGroupId[] = [
  'inicio',
  'console',
  'engenheiro',
  'painel',
  'contas',
  'sobre',
];

export const DEFAULT_CONFIG_GROUP: ConfigGroupId = 'inicio';

/** Âncoras de seção dentro dos grupos (ids dos cartões; os mesmos das abas antigas). */
export type ConfigAnchor =
  | 'conexao'
  | 'captura'
  | 'acesso-remoto'
  | 'dispositivos'
  | 'firewall'
  | 'telas'
  | 'discord'
  | 'coach'
  | 'dados'
  | 'mcp'
  | 'idioma'
  | 'sobre';

export interface ConfigTarget {
  group: ConfigGroupId;
  /** Cartão a rolar até (e, no caso do MCP, abrir). */
  anchor?: ConfigAnchor;
}

/**
 * Âncoras de antes da reorganização (links do README, do menu ao vivo, de outras páginas) → grupo
 * novo. Os ids dos próprios grupos também valem em `#/config?s=<grupo>`.
 */
const LEGACY: Record<string, ConfigTarget> = {
  // abas antigas
  idioma: { group: 'contas', anchor: 'idioma' },
  conexao: { group: 'console', anchor: 'conexao' },
  captura: { group: 'console', anchor: 'captura' },
  'acesso-remoto': { group: 'painel', anchor: 'acesso-remoto' },
  dispositivos: { group: 'painel', anchor: 'dispositivos' },
  discord: { group: 'contas', anchor: 'discord' },
  coach: { group: 'contas', anchor: 'coach' },
  dados: { group: 'contas', anchor: 'dados' },
  mcp: { group: 'contas', anchor: 'mcp' },
  sobre: { group: 'sobre', anchor: 'sobre' },
  // apelidos que já existiam
  lan: { group: 'painel', anchor: 'acesso-remoto' },
  celular: { group: 'painel', anchor: 'acesso-remoto' },
  // nomes usados nas conversas e nas specs
  remoto: { group: 'painel', anchor: 'acesso-remoto' },
  aparelhos: { group: 'painel', anchor: 'dispositivos' },
  firewall: { group: 'painel', anchor: 'firewall' },
  telas: { group: 'painel', anchor: 'telas' },
  ia: { group: 'contas', anchor: 'mcp' },
  radio: { group: 'engenheiro' },
  voz: { group: 'engenheiro' },
  engineer: { group: 'engenheiro' },
  painel: { group: 'painel' },
  contas: { group: 'contas' },
};

function isGroup(id: string): id is ConfigGroupId {
  return (CONFIG_GROUP_IDS as readonly string[]).includes(id);
}

/** `#/config?s=<valor>` → grupo (e cartão) a abrir. Valor ausente ou desconhecido = Início. */
export function resolveConfigTarget(s: string | null | undefined): ConfigTarget {
  const key = (s ?? '').trim().toLowerCase();
  if (!key) return { group: DEFAULT_CONFIG_GROUP };
  // "console" é grupo novo e âncora antiga ao mesmo tempo: os dois levam ao grupo Console.
  if (isGroup(key)) return { group: key };
  return LEGACY[key] ?? { group: DEFAULT_CONFIG_GROUP };
}

export interface ConfigGroupInfo {
  id: ConfigGroupId;
  label: string;
  description: string;
  /** Só na janela do Bono para Windows. */
  desktopOnly?: boolean;
}

export const CONFIG_GROUPS: readonly ConfigGroupInfo[] = [
  {
    id: 'inicio',
    get label() {
      return uiText('Início');
    },
    get description() {
      return uiText('Como está tudo agora');
    },
  },
  {
    id: 'console',
    get label() {
      return uiText('Console');
    },
    get description() {
      return uiText('PS5 e gravação das sessões');
    },
  },
  {
    id: 'engenheiro',
    get label() {
      return uiText('Engenheiro');
    },
    get description() {
      return uiText('Voz, modo, volume e onde ele fala');
    },
  },
  {
    id: 'painel',
    get label() {
      return uiText('Painel e aparelhos');
    },
    get description() {
      return uiText('Telas de cada aparelho e acesso pelo celular');
    },
  },
  {
    id: 'contas',
    get label() {
      return uiText('Contas e dados');
    },
    get description() {
      return uiText('Discord, Coach IA, idioma e seus dados');
    },
  },
  {
    id: 'sobre',
    get label() {
      return uiText('Sobre');
    },
    get description() {
      return uiText('Versão, assistente e avisos');
    },
  },
];

// ---------------------------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------------------------

export interface ConfigEntry {
  /** Id da linha (`cfg-row-<id>` no DOM). */
  id: string;
  group: ConfigGroupId;
  anchor?: ConfigAnchor;
  title: string;
  description: string;
  /** Palavras que o piloto pode digitar e que não aparecem no texto. */
  keywords?: string;
  /** Linha recolhida em "Avançado" / "Mais opções". */
  advanced?: boolean;
  desktopOnly?: boolean;
}

/**
 * Uma entrada por linha de configuração. A busca filtra títulos, descrições e palavras-chave, e
 * leva ao grupo certo. A referência do delta existe UMA vez aqui, de propósito (fonte única).
 */
export const CONFIG_ENTRIES: readonly ConfigEntry[] = [
  {
    id: 'ps5',
    group: 'console',
    anchor: 'conexao',
    get title() {
      return uiText('PS5');
    },
    get description() {
      return uiText('Estado da conexão e busca do console na rede.');
    },
    keywords: 'console conexão procurar playstation sinal',
  },
  {
    id: 'auto-record',
    group: 'console',
    anchor: 'captura',
    get title() {
      return uiText('Gravar sessões automaticamente');
    },
    get description() {
      return uiText('Salva sessões, voltas e pistas sozinho, sem botão de iniciar.');
    },
    keywords: 'captura salvar histórico',
  },
  {
    id: 'manual-ip',
    group: 'console',
    anchor: 'conexao',
    advanced: true,
    get title() {
      return uiText('Usar outro IP');
    },
    get description() {
      return uiText('Só se a busca automática não achar o console.');
    },
    keywords: 'endereço manual rede',
  },
  {
    id: 'packet-format',
    group: 'console',
    anchor: 'conexao',
    advanced: true,
    get title() {
      return uiText('Formato do pacote');
    },
    get description() {
      return uiText('Automático por padrão; fixe só se o console não responder.');
    },
    keywords: 'udp protocolo avançado replay',
  },
  {
    id: 'raw-record',
    group: 'console',
    anchor: 'conexao',
    advanced: true,
    get title() {
      return uiText('Gravar pacotes brutos');
    },
    get description() {
      return uiText('Guarda tudo o que o console envia (cerca de 20 KB/s). Deixe desligado.');
    },
    keywords: 'gt7rec disco espaço reprocessar',
  },
  {
    id: 'engineer-on',
    group: 'engenheiro',
    get title() {
      return uiText('Ligar o engenheiro');
    },
    get description() {
      return uiText('Instruções em voz e na tela. Em silêncio quando tudo corre bem.');
    },
    keywords: 'rádio ligar desligar',
  },
  {
    id: 'voice',
    group: 'engenheiro',
    get title() {
      return uiText('Voz');
    },
    get description() {
      return uiText('Quem fala com você. Use “Testar voz” para ouvir.');
    },
    keywords: 'testar ouvir som',
  },
  {
    id: 'mode',
    group: 'engenheiro',
    get title() {
      return uiText('Modo do engenheiro');
    },
    get description() {
      return uiText('Treino, classificação ou corrida; no treino, aprender pista ou ganhar tempo.');
    },
    keywords: 'perfil aprender pista ganhar tempo consistência livre treino',
  },
  {
    id: 'volume',
    group: 'engenheiro',
    get title() {
      return uiText('Volume');
    },
    get description() {
      return uiText('Volume da voz do engenheiro neste aparelho.');
    },
    keywords: 'som áudio',
  },
  {
    id: 'audio-device',
    group: 'engenheiro',
    get title() {
      return uiText('Onde ele fala');
    },
    get description() {
      return uiText('Este aparelho, o Discord ou outro aparelho conectado.');
    },
    keywords: 'aparelho áudio saída discord tocar',
  },
  {
    id: 'speech-level',
    group: 'engenheiro',
    advanced: true,
    get title() {
      return uiText('Nível de fala');
    },
    get description() {
      return uiText('Essencial, detalhado ou mudo.');
    },
    keywords: 'silenciar mudo',
  },
  {
    id: 'pace',
    group: 'engenheiro',
    advanced: true,
    get title() {
      return uiText('Ritmo da fala');
    },
    get description() {
      return uiText('Calmo, normal ou rápido.');
    },
    keywords: 'velocidade',
  },
  {
    id: 'anticipation',
    group: 'engenheiro',
    advanced: true,
    get title() {
      return uiText('Antecipação');
    },
    get description() {
      return uiText('Quanto antes da curva o aviso é dado.');
    },
    keywords: 'atraso mais cedo',
  },
  {
    id: 'summary',
    group: 'engenheiro',
    advanced: true,
    get title() {
      return uiText('Resumo do treino');
    },
    get description() {
      return uiText('Com que frequência ele resume o treino.');
    },
  },
  {
    id: 'praise',
    group: 'engenheiro',
    advanced: true,
    get title() {
      return uiText('Reforço positivo');
    },
    get description() {
      return uiText('Avisa também quando você acerta a curva.');
    },
    keywords: 'elogio acerto',
  },
  {
    id: 'delta-ref',
    group: 'engenheiro',
    advanced: true,
    get title() {
      return uiText('Volta de referência');
    },
    get description() {
      return uiText('Contra o que o ao vivo e o engenheiro comparam você.');
    },
    keywords: 'delta comparar melhor pessoal melhor da sessão',
  },
  {
    id: 'screens',
    group: 'painel',
    anchor: 'telas',
    get title() {
      return uiText('Telas de cada aparelho');
    },
    get description() {
      return uiText('Simples, Completo ou Corrida de endurance, por aparelho.');
    },
    keywords: 'preset carrossel pneus motor inputs combustível mapa',
  },
  {
    id: 'lap-popup',
    group: 'painel',
    anchor: 'telas',
    get title() {
      return uiText('Cartão ao fechar a volta');
    },
    get description() {
      return uiText('Mostra o tempo e os setores quando você completa uma volta.');
    },
    keywords: 'pop-up popup aviso',
  },
  {
    id: 'lock',
    group: 'painel',
    anchor: 'telas',
    get title() {
      return uiText('Travar gestos');
    },
    get description() {
      return uiText('Evita trocar de tela sem querer.');
    },
    keywords: 'cadeado deslizar',
  },
  {
    id: 'open-phone',
    group: 'painel',
    anchor: 'acesso-remoto',
    get title() {
      return uiText('Abrir no celular ou tablet');
    },
    get description() {
      return uiText('QR Code e endereços para a mesma rede.');
    },
    keywords: 'qr code remoto lan endereço',
  },
  {
    id: 'firewall',
    group: 'painel',
    anchor: 'firewall',
    get title() {
      return uiText('Acesso pela rede (Windows)');
    },
    get description() {
      return uiText('Mostra se o Windows está liberando o acesso e corrige quando preciso.');
    },
    keywords: 'firewall bloqueado liberado netsh powershell',
  },
  {
    id: 'devices',
    group: 'painel',
    anchor: 'dispositivos',
    get title() {
      return uiText('Aparelhos conectados');
    },
    get description() {
      return uiText('Quem está online e o que cada um mostra agora.');
    },
    keywords: 'dispositivos online mostrar tela',
  },
  {
    id: 'discord',
    group: 'contas',
    anchor: 'discord',
    desktopOnly: true,
    get title() {
      return uiText('Rádio no Discord');
    },
    get description() {
      return uiText('Bot no seu canal de voz para ouvir o engenheiro no PS5.');
    },
    keywords: 'bot token canal',
  },
  {
    id: 'coach',
    group: 'contas',
    anchor: 'coach',
    get title() {
      return uiText('Coach IA');
    },
    get description() {
      return uiText('Sua chave da Anthropic e o modelo usado nas análises.');
    },
    keywords: 'chave api claude anthropic modelo esforço relatórios',
  },
  {
    id: 'data-folder',
    group: 'contas',
    anchor: 'dados',
    get title() {
      return uiText('Pasta dos dados');
    },
    get description() {
      return uiText('Onde ficam suas sessões e como fazer uma cópia de segurança.');
    },
    keywords: 'backup cópia arquivos caminho',
  },
  {
    id: 'language',
    group: 'contas',
    anchor: 'idioma',
    get title() {
      return uiText('Idioma do app');
    },
    get description() {
      return uiText('Português, inglês ou espanhol, na tela e na voz.');
    },
    keywords: 'english español língua',
  },
  {
    id: 'mcp',
    group: 'contas',
    anchor: 'mcp',
    advanced: true,
    get title() {
      return uiText('Conectar ao Claude ou ao Codex');
    },
    get description() {
      return uiText('Deixa um assistente de IA consultar suas voltas (MCP).');
    },
    keywords: 'mcp codex claude code desktop integração ia',
  },
  {
    id: 'setup-again',
    group: 'sobre',
    anchor: 'sobre',
    get title() {
      return uiText('Refazer o assistente');
    },
    get description() {
      return uiText('Passa de novo pela configuração inicial.');
    },
    keywords: 'onboarding boas-vindas começar',
  },
];

/** Mais que isto e o campo de busca aparece (RF8). */
export const SEARCH_MIN_ROWS = 12;

export function shouldShowSearch(rowCount: number): boolean {
  return rowCount > SEARCH_MIN_ROWS;
}

/** Minúsculas e sem acentos: “gravação” encontra “gravacao”. */
export function normalizeSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
}

/** Entradas cujo título, descrição ou palavras-chave contêm TODAS as palavras digitadas. */
export function searchConfig(
  query: string,
  entries: readonly ConfigEntry[] = CONFIG_ENTRIES,
  opts: { desktop?: boolean } = {},
): ConfigEntry[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return entries.filter((e) => {
    if (e.desktopOnly && !opts.desktop) return false;
    const hay = normalizeSearch(`${e.title} ${e.description} ${e.keywords ?? ''}`);
    return words.every((w) => hay.includes(w));
  });
}

// ---------------------------------------------------------------------------------------------
// Passos pendentes do assistente (spec 03: `gt7.setup.v2`)
// ---------------------------------------------------------------------------------------------

/** Chave do estado do assistente novo. Se não existir, o cartão "Falta configurar" não aparece. */
export const SETUP_STATE_KEY = 'gt7.setup.v2';

export type SetupStepId = 'welcome' | 'console' | 'mode' | 'engineer' | 'panel';

export const SETUP_STEP_IDS: readonly SetupStepId[] = [
  'welcome',
  'console',
  'mode',
  'engineer',
  'panel',
];

export interface PendingStep {
  id: SetupStepId;
  title: string;
  /** Onde o passo se resolve nas Configurações. */
  group: ConfigGroupId;
  anchor?: ConfigAnchor;
}

const STEP_INFO: Record<SetupStepId, () => Omit<PendingStep, 'id'>> = {
  welcome: () => ({
    title: uiText('Escolher a voz do engenheiro'),
    group: 'engenheiro',
  }),
  console: () => ({
    title: uiText('Conectar o PS5'),
    group: 'console',
    anchor: 'conexao',
  }),
  mode: () => ({
    title: uiText('Escolher como treinar'),
    group: 'engenheiro',
  }),
  engineer: () => ({
    title: uiText('Ligar o engenheiro'),
    group: 'engenheiro',
  }),
  panel: () => ({
    title: uiText('Escolher as telas do ao vivo'),
    group: 'painel',
    anchor: 'telas',
  }),
};

function stepDone(value: unknown): boolean {
  return value === true || value === 'done' || value === 'completed';
}

/**
 * Lê o texto salvo em `gt7.setup.v2` e devolve os passos ainda pendentes (na ordem do assistente).
 * `null` = não há estado do assistente (instalação sem ele, texto inválido): não mostrar nada.
 * Lista vazia = tudo feito (ou o assistente foi encerrado): também não mostrar o cartão.
 */
export function pendingSetupSteps(raw: string | null | undefined): PendingStep[] | null {
  if (!raw) return null;
  let state: unknown;
  try {
    state = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof state !== 'object' || state === null) return null;
  const { steps, done } = state as { steps?: unknown; done?: unknown };
  if (done === true) return [];
  const map = typeof steps === 'object' && steps !== null ? (steps as Record<string, unknown>) : {};
  return SETUP_STEP_IDS.filter((id) => !stepDone(map[id])).map((id) => ({
    id,
    ...STEP_INFO[id](),
  }));
}

// ---------------------------------------------------------------------------------------------
// Resumo de saúde
// ---------------------------------------------------------------------------------------------

export type HealthTone = 'ok' | 'busy' | 'warn' | 'bad' | 'off';

export type HealthAction =
  | { kind: 'rescan'; label: string }
  | { kind: 'toggleEngineer'; label: string }
  | { kind: 'toggleRecording'; label: string }
  | { kind: 'goto'; label: string; target: ConfigTarget };

export interface HealthItem {
  id: 'console' | 'engineer' | 'recording' | 'discord' | 'devices';
  tone: HealthTone;
  title: string;
  detail: string;
  action: HealthAction | null;
}

export interface HealthInput {
  /** Estado do link com o console (null = o servidor ainda não disse). */
  link: ConsoleConnection | null;
  engineer: {
    enabled: boolean;
    muted: boolean;
    voiceName?: string | null;
    audio: EngineerAudioTarget;
  };
  /** "Gravar sessões automaticamente" e "pacotes brutos" (null = ainda carregando). */
  recording: { autoCapture: boolean; raw: boolean } | null;
  /** Só na janela do Bono para Windows; null = sem Discord. */
  discord: { configured: boolean; enabled: boolean; error: boolean; message?: string } | null;
  devicesOnline: number;
  firewall: FirewallStatus['state'] | null;
}

const LINK_TONE: Record<LinkTone, HealthTone> = {
  ok: 'ok',
  busy: 'busy',
  info: 'busy',
  warn: 'warn',
  bad: 'bad',
};

/** Itens do resumo, na ordem em que aparecem: PS5, Engenheiro, Gravação, Discord, Aparelhos. */
export function buildHealth(i: HealthInput): HealthItem[] {
  const items: HealthItem[] = [];

  // PS5
  const link = describeLink(i.link);
  const receiving = i.link?.state === 'receiving';
  items.push({
    id: 'console',
    tone: LINK_TONE[link.tone],
    title: receiving ? uiText('PS5 conectado') : link.short,
    detail: receiving
      ? i.link?.consoleIp
        ? uiText('Recebendo telemetria de {0}.', i.link.consoleIp)
        : uiText('Recebendo telemetria.')
      : (link.detail ?? link.title),
    action: receiving ? null : { kind: 'rescan', label: uiText('Procurar de novo') },
  });

  // Engenheiro
  const eng = engineerStateText(i.engineer);
  items.push({
    id: 'engineer',
    tone: !i.engineer.enabled ? 'off' : i.engineer.muted ? 'warn' : 'ok',
    title: eng.title,
    detail: eng.detail,
    action: {
      kind: 'toggleEngineer',
      label: i.engineer.enabled ? uiText('Desligar') : uiText('Ligar'),
    },
  });

  // Gravação
  if (i.recording) {
    const rec = recordingStateText(i.recording.autoCapture, i.recording.raw);
    items.push({
      id: 'recording',
      tone: i.recording.autoCapture ? 'ok' : 'warn',
      title: rec.title,
      detail: rec.detail,
      action: {
        kind: 'toggleRecording',
        label: i.recording.autoCapture ? uiText('Desligar') : uiText('Ligar'),
      },
    });
  }

  // Discord (só no app para Windows)
  if (i.discord) {
    const d = i.discord;
    const target: ConfigTarget = { group: 'contas', anchor: 'discord' };
    if (!d.configured) {
      items.push({
        id: 'discord',
        tone: 'off',
        title: uiText('Discord sem configurar'),
        detail: uiText('Configure o bot uma vez para ouvir o engenheiro pelo PS5.'),
        action: { kind: 'goto', label: uiText('Configurar'), target },
      });
    } else if (d.error) {
      items.push({
        id: 'discord',
        tone: 'bad',
        title: uiText('Discord com problema'),
        detail: d.message || uiText('Abra as configurações do Discord para ver o que houve.'),
        action: { kind: 'goto', label: uiText('Ver'), target },
      });
    } else {
      items.push({
        id: 'discord',
        tone: d.enabled ? 'ok' : 'off',
        title: d.enabled ? uiText('Discord ligado') : uiText('Discord desligado'),
        detail:
          d.message ||
          (d.enabled
            ? uiText('O bot entra no canal quando você entra.')
            : uiText('Ligue para o engenheiro falar no canal de voz.')),
        action: { kind: 'goto', label: uiText('Ajustar'), target },
      });
    }
  }

  // Aparelhos
  const remote: ConfigTarget = { group: 'painel', anchor: 'acesso-remoto' };
  if (i.devicesOnline > 0) {
    items.push({
      id: 'devices',
      tone: 'ok',
      title:
        i.devicesOnline === 1
          ? uiText('1 aparelho online')
          : uiText('{0} aparelhos online', String(i.devicesOnline)),
      detail: uiText('Cada um mostra as telas que você escolheu para ele.'),
      action: { kind: 'goto', label: uiText('Ver aparelhos'), target: { group: 'painel' } },
    });
  } else if (i.firewall === 'missing') {
    items.push({
      id: 'devices',
      tone: 'warn',
      title: uiText('Windows bloqueando o acesso'),
      detail: uiText('Celular e tablet não conseguem abrir o ao vivo até liberar.'),
      action: {
        kind: 'goto',
        label: uiText('Corrigir'),
        target: { group: 'painel', anchor: 'firewall' },
      },
    });
  } else {
    items.push({
      id: 'devices',
      tone: 'off',
      title: uiText('Nenhum aparelho conectado'),
      detail: uiText('Abra o ao vivo no celular ou no tablet pelo QR Code.'),
      action: { kind: 'goto', label: uiText('Abrir no celular'), target: remote },
    });
  }

  return items;
}

/** Frase do topo do resumo: tudo certo ou quantos itens pedem atenção. */
export function healthHeadline(items: readonly HealthItem[]): {
  tone: 'ok' | 'warn' | 'bad';
  text: string;
} {
  const bad = items.filter((x) => x.tone === 'bad').length;
  const warn = items.filter((x) => x.tone === 'warn').length;
  if (bad > 0) {
    return {
      tone: 'bad',
      text:
        bad === 1 ? uiText('1 item com problema') : uiText('{0} itens com problema', String(bad)),
    };
  }
  if (warn > 0) {
    return {
      tone: 'warn',
      text:
        warn === 1
          ? uiText('1 item pede atenção')
          : uiText('{0} itens pedem atenção', String(warn)),
    };
  }
  return { tone: 'ok', text: uiText('Tudo certo') };
}

// ---------------------------------------------------------------------------------------------
// Presets de telas (por aparelho)
// ---------------------------------------------------------------------------------------------

export type ScreenPresetId = 'simple' | 'full' | 'endurance';

export interface ScreenPreset {
  id: ScreenPresetId;
  label: string;
  description: string;
  views: readonly ViewId[];
}

export const SCREEN_PRESETS: readonly ScreenPreset[] = [
  {
    id: 'simple',
    get label() {
      return uiText('Simples');
    },
    get description() {
      return uiText('Só o essencial para olhar de relance.');
    },
    views: ['corrida', 'deltaGrande'],
  },
  {
    id: 'full',
    get label() {
      return uiText('Completo');
    },
    get description() {
      return uiText('Inclui pneus, inputs e motor.');
    },
    views: ['corrida', 'deltaGrande', 'pneus', 'inputs', 'motor'],
  },
  {
    id: 'endurance',
    get label() {
      return uiText('Corrida de endurance');
    },
    get description() {
      return uiText('Combustível, tempos e pneus para provas longas.');
    },
    views: ['corrida', 'combustivel', 'tempos', 'pneus'],
  },
];

/** Qual preset as telas ligadas formam, na mesma ordem. `null` = montagem própria. */
export function matchScreenPreset(views: readonly ViewId[]): ScreenPresetId | null {
  const hit = SCREEN_PRESETS.find(
    (p) => p.views.length === views.length && p.views.every((v, i) => views[i] === v),
  );
  return hit?.id ?? null;
}

/**
 * Perfil do aparelho com outra lista de telas (a ordem do preset é a do carrossel). Mantém o resto
 * do perfil; a tela inicial continua a mesma se ainda estiver ligada, senão vira a primeira.
 */
export function profileWithViews(
  profile: DeviceProfile,
  views: readonly ViewId[],
  now: number,
): DeviceProfile {
  const next = normalizeDeviceProfile({ ...profile, views: [...views] }, profile.deviceId);
  return { ...next, updatedAt: now };
}
