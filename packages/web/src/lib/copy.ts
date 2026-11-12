/**
 * Glossário e textos de estado compartilhados (spec 01). Uma palavra para cada coisa, em toda a
 * interface: o piloto aprende o vocabulário uma vez. Os textos são funções/getters para seguir o
 * idioma escolhido (`uiText` consulta o idioma na hora do uso).
 *
 * Só acrescente aqui; mudar um termo existente muda a tela inteira.
 */

import type { DeltaReferenceKind } from '@gt7/shared';
import { t as uiText } from './i18n.ts';

/** Termos oficiais. */
export const TERMS = {
  get live() {
    return uiText('Ao vivo');
  },
  get engineer() {
    return uiText('Engenheiro');
  },
  get referenceLap() {
    return uiText('Volta de referência');
  },
  get recognizeTrack() {
    return uiText('Reconhecer a pista');
  },
  get replayCapture() {
    return uiText('Gravar volta de replay');
  },
  get device() {
    return uiText('Aparelho');
  },
  get devices() {
    return uiText('Aparelhos');
  },
} as const;

/** "Use em vez de": termos antigos que não devem voltar para a interface. */
export const DISCOURAGED_TERMS: readonly { avoid: string; use: string }[] = [
  { avoid: 'painel', use: 'Ao vivo' },
  { avoid: 'dashboard', use: 'Ao vivo' },
  { avoid: 'rádio', use: 'Engenheiro' },
  { avoid: 'top capturado', use: 'Volta de referência' },
  { avoid: 'melhor capturada', use: 'Volta de referência' },
  { avoid: 'tracking', use: 'Reconhecer a pista' },
  { avoid: 'fingerprint', use: 'Reconhecer a pista' },
  { avoid: 'captura de referência', use: 'Gravar volta de replay' },
  { avoid: 'dispositivo remoto', use: 'Aparelho' },
  { avoid: 'device', use: 'Aparelho' },
];

// ---------------------------------------------------------------------------------------------
// Estado do engenheiro
// ---------------------------------------------------------------------------------------------

export type EngineerAudioTarget = 'here' | 'discord' | 'other';

export interface EngineerStateInput {
  enabled: boolean;
  muted: boolean;
  /** Rótulo da voz escolhida ("Voz 1"), quando conhecido. */
  voiceName?: string | null;
  audio: EngineerAudioTarget;
}

export interface StateText {
  title: string;
  detail: string;
}

const AUDIO_TARGET_TEXT: Record<EngineerAudioTarget, () => string> = {
  here: () => uiText('fala neste aparelho'),
  discord: () => uiText('fala pelo Discord'),
  other: () => uiText('fala em outro aparelho'),
};

/** Resumo do engenheiro para o resumo de saúde, a faixa de contexto e o menu. */
export function engineerStateText(i: EngineerStateInput): StateText {
  if (!i.enabled) {
    return {
      title: uiText('Engenheiro desligado'),
      detail: uiText('Ligue para receber instruções em voz e na tela.'),
    };
  }
  if (i.muted) {
    return {
      title: uiText('Engenheiro sem som'),
      detail: uiText('As instruções aparecem só na tela. Ative o som para ouvir.'),
    };
  }
  const voice = i.voiceName ? i.voiceName : null;
  return {
    title: uiText('Engenheiro ligado'),
    detail: [voice, AUDIO_TARGET_TEXT[i.audio]()].filter(Boolean).join(' · '),
  };
}

// ---------------------------------------------------------------------------------------------
// Gravação das sessões
// ---------------------------------------------------------------------------------------------

export function recordingStateText(autoCapture: boolean, rawPackets: boolean): StateText {
  if (!autoCapture) {
    return {
      title: uiText('Gravação automática desligada'),
      detail: uiText('O ao vivo funciona, mas nenhuma sessão, volta ou pista nova é salva.'),
    };
  }
  return {
    title: uiText('Gravação automática ligada'),
    detail: rawPackets
      ? uiText('Salva sessões e voltas sozinha, e guarda também os pacotes brutos.')
      : uiText('Salva sessões e voltas sozinha quando você entra numa pista.'),
  };
}

// ---------------------------------------------------------------------------------------------
// Aparelhos
// ---------------------------------------------------------------------------------------------

export function devicesStateText(online: number): StateText {
  if (online <= 0) {
    return {
      title: uiText('Nenhum aparelho conectado'),
      detail: uiText('Abra o ao vivo no celular ou no tablet pelo QR Code.'),
    };
  }
  return {
    title:
      online === 1 ? uiText('1 aparelho online') : uiText('{0} aparelhos online', String(online)),
    detail: uiText('Cada um mostra as telas que você escolheu para ele.'),
  };
}

// ---------------------------------------------------------------------------------------------
// Volta sem referência (aviso ao fechar a volta)
// ---------------------------------------------------------------------------------------------

/** Diz o que fazer quando a volta fechou sem delta: nunca só "Sem referência". */
export function noReferenceHint(kind: DeltaReferenceKind): string {
  return kind === 'reference'
    ? uiText('Grave uma volta de replay para ter com o que comparar.')
    : uiText('Dê mais uma volta: ela passa a ser a referência.');
}

// ---------------------------------------------------------------------------------------------
// Erros: texto humano na frente, detalhe técnico recolhido
// ---------------------------------------------------------------------------------------------

export interface HumanError {
  /** Frase para o piloto, já no idioma da interface. */
  text: string;
  /** Mensagem original, só quando ela é técnica demais para ficar à vista. */
  detail: string | null;
}

const ELECTRON_PREFIX = /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/;
const ERROR_CLASS_PREFIX = /^(?:[A-Z][A-Za-z]*Error):\s*/;

export function humanizeError(raw: unknown): HumanError {
  const original = (typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '').trim();
  if (!original) return { text: uiText('Algo deu errado. Tente de novo.'), detail: null };
  const msg = original.replace(ELECTRON_PREFIX, '').replace(ERROR_CLASS_PREFIX, '').trim();
  if (
    /failed to fetch|networkerror|load failed|fetch failed|econnrefused|econnreset|socket hang up/i.test(
      msg,
    )
  ) {
    return {
      text: uiText(
        'Não foi possível falar com o Bono. Confira se ele está aberto e tente de novo.',
      ),
      detail: original,
    };
  }
  if (/unexpected token|not valid json|unexpected end of json/i.test(msg)) {
    return {
      text: uiText(
        'O Bono respondeu algo que não deu para ler. Atualize a página e tente de novo.',
      ),
      detail: original,
    };
  }
  if (/\b(?:EADDRINUSE|EACCES|EPERM|ENOENT|ETIMEDOUT|EBUSY)\b/.test(msg)) {
    return {
      text: uiText('O Windows impediu essa ação. Tente de novo ou reinicie o Bono.'),
      detail: original,
    };
  }
  const firstLine = msg.split('\n')[0]?.trim() ?? msg;
  if (/\n\s+at\s/.test(msg)) {
    return { text: firstLine || uiText('Algo deu errado. Tente de novo.'), detail: original };
  }
  return {
    text: msg || uiText('Algo deu errado. Tente de novo.'),
    detail: msg === original ? null : original,
  };
}
