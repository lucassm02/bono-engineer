/**
 * Central de ajuda (`#/ajuda`): tópicos e artigos curtos, escritos à mão em cada idioma (não passam
 * por `translations.json`: a explicação muda de forma entre idiomas, não só de palavras).
 *
 * Regras de escrita
 *  - Cada artigo cabe em 150 palavras (resumo + passos + itens + nota); `helpContent.test.ts` confere.
 *  - Os nomes de tela e botão são os mesmos da interface naquele idioma (ver `translations.json`).
 *  - Passos numerados para o que se faz em ordem; itens para o que se consulta; nota para o resto.
 *  - Todo link aponta para uma rota real do app (o teste também confere).
 */

import type { Language } from '@gt7/shared';
import { normalizeSearch } from '../analysis/lib/configNav.ts';
import type { IconName } from '../components/ui/Icon.tsx';
import { routes } from './route.ts';

export type HelpTopicId =
  | 'start'
  | 'engineer'
  | 'live'
  | 'tracks'
  | 'settings'
  | 'discord'
  | 'problems'
  | 'keys';

export const HELP_TOPIC_IDS: readonly HelpTopicId[] = [
  'start',
  'engineer',
  'live',
  'tracks',
  'settings',
  'discord',
  'problems',
  'keys',
];

/** Botões que um artigo pode oferecer; quem desenha a página liga cada um à ação existente. */
export type HelpActionId = 'tourLive' | 'tourAnalysis' | 'setup';

export interface HelpLink {
  label: string;
  /** Hash do app (`#/config?s=console`). */
  href: string;
}

export interface HelpShortcut {
  keys: string[];
  text: string;
}

export interface HelpArticle {
  id: string;
  topic: HelpTopicId;
  title: string;
  summary: string;
  /** Passos numerados. */
  steps?: string[];
  /** Lista sem ordem. */
  items?: string[];
  /** Teclas e o que fazem (artigo de atalhos). */
  shortcuts?: HelpShortcut[];
  /** Fecho curto: o porquê, o limite ou a saída. */
  note?: string;
  links?: HelpLink[];
  actions?: HelpActionId[];
  /** Palavras que o piloto digita e que não estão no texto. */
  keywords?: string;
}

export interface HelpTopic {
  id: HelpTopicId;
  icon: IconName;
  title: string;
  description: string;
}

export interface HelpContent {
  topics: HelpTopic[];
  articles: HelpArticle[];
}

/** Máximo de palavras por artigo (resumo, passos, itens, atalhos e nota). */
export const HELP_ARTICLE_MAX_WORDS = 150;

export function articleWords(a: HelpArticle): number {
  const text = [
    a.summary,
    ...(a.steps ?? []),
    ...(a.items ?? []),
    ...(a.shortcuts ?? []).map((s) => `${s.keys.join(' ')} ${s.text}`),
    a.note ?? '',
  ].join(' ');
  return text.split(/\s+/).filter(Boolean).length;
}

const lnk = (label: string, href: string): HelpLink => ({ label, href });

// ---------------------------------------------------------------------------------------------
// Português (Brasil)
// ---------------------------------------------------------------------------------------------

const PT: HelpContent = {
  topics: [
    {
      id: 'start',
      icon: 'play',
      title: 'Primeiros passos',
      description: 'Da instalação à primeira volta, e os tours.',
    },
    {
      id: 'engineer',
      icon: 'radio',
      title: 'O engenheiro e as vozes',
      description: 'Ligar, escolher a voz e ajustar como ele fala.',
    },
    {
      id: 'live',
      icon: 'live',
      title: 'Ao vivo e gestos',
      description: 'Telas, delta, gestos e outros aparelhos.',
    },
    {
      id: 'tracks',
      icon: 'home',
      title: 'Pistas e sessões',
      description: 'Como o Bono reconhece a pista e guarda suas voltas.',
    },
    {
      id: 'settings',
      icon: 'config',
      title: 'Configurações: onde fica cada coisa',
      description: 'Os seis grupos e o que há em cada um.',
    },
    {
      id: 'discord',
      icon: 'volume',
      title: 'Discord no PS5',
      description: 'Ouvir o engenheiro no headset do PS5.',
    },
    {
      id: 'problems',
      icon: 'alert',
      title: 'Problemas comuns',
      description: 'Sem sinal, engenheiro mudo, Discord e pista.',
    },
    {
      id: 'keys',
      icon: 'menu',
      title: 'Atalhos de teclado',
      description: 'As teclas do ao vivo e da ajuda.',
    },
  ],
  articles: [
    {
      id: 'primeiros-passos',
      topic: 'start',
      title: 'Da instalação à primeira volta',
      summary: 'O caminho mais curto para ouvir o engenheiro.',
      steps: [
        'Abra o Bono no PC, na mesma rede do PS5.',
        'Siga o assistente inicial: idioma e voz, PS5, jeito de treinar, engenheiro e telas. Dá para pular passos e voltar depois.',
        'No PS5, abra o Gran Turismo 7 e entre numa pista.',
        'No Bono, abra o Ao vivo. O chip de conexão indica quando os dados chegam.',
        'Dê a primeira volta. O Bono reconhece a pista quando a volta fecha e o engenheiro fala a partir da seguinte.',
      ],
      note: 'Já treinou nessa pista? Escolha-a antes de sair dos boxes e o engenheiro fala desde a volta 1.',
      links: [
        lnk('Abrir o Ao vivo', routes.live()),
        lnk('Conexão com o PS5', routes.config('console')),
      ],
      actions: ['setup', 'tourLive'],
      keywords: 'instalar começar iniciar comecar tutorial',
    },
    {
      id: 'refazer-assistente',
      topic: 'start',
      title: 'Refazer o assistente inicial',
      summary: 'Passa de novo por idioma, voz, PS5, engenheiro e telas.',
      steps: [
        'Abra Configurações → Sobre.',
        'Clique em Refazer o assistente. Ele recomeça do primeiro passo.',
        'Em cada passo, siga ou use Pular passo. “Fazer isso depois” fecha o assistente sem perder o que já foi feito.',
      ],
      note: 'Os passos que ficarem para depois aparecem no cartão “Falta configurar”, no topo da Início e das Configurações.',
      links: [lnk('Configurações → Sobre', routes.config('sobre'))],
      actions: ['setup'],
      keywords: 'onboarding boas-vindas reiniciar configuração inicial',
    },
    {
      id: 'ver-os-tours',
      topic: 'start',
      title: 'Ver os tours',
      summary: 'Dois passeios curtos: o do Ao vivo (numa demonstração, sem PS5) e o do histórico.',
      steps: [
        'Use os botões abaixo, o menu do Ao vivo (tecla M → Ajuda) ou Configurações → Sobre.',
        'Avance com o botão Próximo, a seta → ou Enter. Esc ou Pular tour sai.',
        'Para testar numa instalação nova, acrescente ?tour=live ou ?tour=analysis ao endereço do Bono (por exemplo http://localhost:8770/?tour=live). O tour começa ao abrir, sem depender da primeira abertura.',
      ],
      note: 'Com o carro andando no PS5, o tour espera você parar.',
      actions: ['tourLive', 'tourAnalysis'],
      keywords: 'passeio guiado demonstração demo qa teste url parametro',
    },

    {
      id: 'ligar-o-engenheiro',
      topic: 'engineer',
      title: 'Ligar o engenheiro e escolher o modo',
      summary: 'Ele fica em silêncio quando tudo corre bem e fala quando há o que corrigir.',
      steps: [
        'Abra o menu do Ao vivo (tecla M) e a aba Engenheiro, ou vá em Configurações → Engenheiro.',
        'Ligue o engenheiro. Ele continua ligado nas próximas aberturas.',
        'Escolha o modo: Treino (Aprender pista, Ganhar tempo, Consistência ou Livre), Classificação ou Corrida.',
        'Ajuste o Volume e confira com Testar voz.',
        'Em Onde ele fala, escolha este aparelho, o Discord ou outro aparelho.',
      ],
      links: [lnk('Configurações → Engenheiro', routes.config('engenheiro'))],
      keywords: 'rádio radio ligar desligar treino classificação corrida aprender pista',
    },
    {
      id: 'escolher-a-voz',
      topic: 'engineer',
      title: 'Escolher a voz',
      summary:
        'Cada idioma tem três vozes numeradas. As falas já vêm gravadas: funcionam sem internet.',
      steps: [
        'Abra Configurações → Engenheiro → Voz.',
        'Escolha uma das três e clique em Testar voz.',
      ],
      items: [
        'Voz 1 (padrão): timbre médio, direto.',
        'Voz 2: mais clara e enérgica.',
        'Voz 3: grave e calma.',
      ],
      note: 'Trocar o idioma do app troca também as vozes, e o Bono lembra a sua escolha em cada idioma (Configurações → Contas e dados → Idioma do app).',
      links: [lnk('Escolher a voz', routes.config('engenheiro'))],
      keywords: 'voz 1 voz 2 voz 3 timbre ouvir testar idioma',
    },
    {
      id: 'como-ele-fala',
      topic: 'engineer',
      title: 'Quanto e quando ele fala',
      summary: 'Ajustes finos que ficam em Mais opções, em Configurações → Engenheiro.',
      items: [
        'Nível de fala: Essencial, Detalhado ou Mudo.',
        'Ritmo da fala: Calmo, Normal ou Rápido.',
        'Antecipação: quanto antes da curva ele avisa. Com o Discord, o atraso medido entra na conta.',
        'Resumo do treino: com que frequência ele resume as voltas.',
        'Reforço positivo: avisa também quando você acerta a curva.',
      ],
      note: 'Na tela do Ao vivo, o botão do rádio mostra ou esconde o cartão do engenheiro sem desligá-lo.',
      links: [lnk('Configurações → Engenheiro', routes.config('engenheiro'))],
      keywords: 'silenciar mudo velocidade ritmo elogio resumo antecipação',
    },

    {
      id: 'gestos',
      topic: 'live',
      title: 'Gestos e botões do Ao vivo',
      summary: 'Pensados para usar com a mão no volante ou no controle.',
      items: [
        'Deslizar para o lado (ou ← →): troca de tela.',
        'Toque: mostra por instantes o nome da tela e a referência do delta.',
        'Toque duplo: troca a referência do delta.',
        'Segurar a tela (ou Enter): escolher quais telas mostrar.',
        'Cadeado (tecla L): trava os gestos. Segure para destravar.',
        'Botão de menu (tecla M): histórico, engenheiro, telas e ajuda.',
      ],
      note: 'Se os gestos estão travados, o menu continua abrindo.',
      actions: ['tourLive'],
      keywords: 'deslizar swipe tocar segurar cadeado travar trocar tela',
    },
    {
      id: 'delta-e-referencia',
      topic: 'live',
      title: 'Delta, setores e volta de referência',
      summary: 'O delta compara você, a cada instante, com uma volta de referência.',
      items: [
        'Verde: mais rápido que a referência. Vermelho: mais lento.',
        'Cada setor mostra a diferença para a sua melhor volta.',
        'Referência: Melhor pessoal, Melhor da sessão ou Volta de referência. O toque duplo alterna.',
        'A escolha padrão fica em Configurações → Engenheiro → Mais opções → Volta de referência.',
      ],
      note: 'Sem referência? Dê mais uma volta (ela passa a valer) ou grave a volta de um replay.',
      links: [lnk('Gravar volta de replay', routes.capture())],
      keywords: 'delta setor melhor volta pessoal sessão tempo ganho perda',
    },
    {
      id: 'telas-e-aparelhos',
      topic: 'live',
      title: 'Telas e outros aparelhos',
      summary: 'Cada aparelho guarda as próprias telas.',
      steps: [
        'Segure a tela, ou abra o menu → Ao vivo → Escolher as telas.',
        'Para um ponto de partida, use Simples, Completo ou Corrida de endurance em Configurações → Ao vivo e aparelhos.',
        'Para montar a sua grade, use Editar tela Personalizada.',
        'Para abrir no celular ou tablet, escaneie o QR Code em Abrir no celular ou tablet, com o aparelho na mesma rede. Use o celular na horizontal.',
      ],
      links: [
        lnk('Ao vivo e aparelhos', routes.config('painel')),
        lnk('Abrir no celular ou tablet', routes.config('acesso-remoto')),
      ],
      keywords: 'celular tablet qr code preset personalizada widgets remoto lan',
    },

    {
      id: 'reconhecer-a-pista',
      topic: 'tracks',
      title: 'Como o Bono reconhece a pista',
      summary:
        'O jogo não informa a pista. O Bono a reconhece pelo traçado, quando uma volta cronometrada fecha.',
      steps: [
        'Volta de saída: não conta.',
        'Volta de reconhecimento: dê a volta completa, sem sair da pista nem reiniciar.',
        'Pronto: a partir da volta seguinte, engenheiro e delta funcionam.',
      ],
      note: 'A faixa no topo do Ao vivo mostra a pista, o carro e o estado do engenheiro. Em “Pista nova · Dar nome”, toque com o carro parado para dizer qual é.',
      keywords: 'volta de reconhecimento detectar identificar traçado nova pista nome',
    },
    {
      id: 'escolher-a-pista',
      topic: 'tracks',
      title: 'Escolher a pista antes de sair',
      summary: 'Com pistas já salvas, o engenheiro fala desde a volta 1.',
      steps: [
        'No menu do jogo, o Bono mostra o cartão “Qual pista hoje?”. Escolha uma das recentes ou busque outra.',
        'Esqueceu? Toque na faixa de contexto, no topo do Ao vivo, com o carro parado.',
        'Ao fechar a primeira volta, o Bono confere. Se a pista não bate, avisa quando você parar.',
      ],
      note: 'Para não ser perguntado, desligue Perguntar a pista ao começar em Configurações → Engenheiro. Nunca pergunta com o carro andando.',
      links: [lnk('Configurações → Engenheiro', routes.config('engenheiro'))],
      keywords: 'pista de hoje qual pista hoje perguntar escolher manual',
    },
    {
      id: 'historico-e-voltas',
      topic: 'tracks',
      title: 'Sessões, voltas e comparação',
      summary: 'O Bono guarda sozinho cada sessão e cada volta, sem botão de iniciar.',
      items: [
        'Início: suas pistas, melhor volta e evolução.',
        'Comparar voltas: curva a curva, com gráficos.',
        'Gravar volta de replay: usa um replay do jogo (o seu ou de um piloto melhor) como referência.',
        'Coach IA: análise da sessão, com a sua chave da Anthropic (Configurações → Contas e dados).',
      ],
      note: 'A gravação automática liga e desliga em Configurações → Console.',
      links: [
        lnk('Início', routes.home()),
        lnk('Comparar voltas', routes.compare({})),
        lnk('Gravar volta de replay', routes.capture()),
      ],
      actions: ['tourAnalysis'],
      keywords: 'histórico sessão gravar automática referência coach comparar',
    },

    {
      id: 'onde-fica-cada-coisa',
      topic: 'settings',
      title: 'Onde fica cada coisa',
      summary: 'Seis grupos, sem arquivo de configuração.',
      items: [
        'Início: como está tudo agora (PS5, engenheiro, gravação, aparelhos) e o que falta configurar.',
        'Console: busca do PS5, gravação automática e, em Mais opções, outro IP.',
        'Engenheiro: ligar, voz, modo, volume e onde ele fala.',
        'Ao vivo e aparelhos: telas de cada aparelho, QR Code, acesso pela rede do Windows.',
        'Contas e dados: Discord, Coach IA, idioma, pasta dos dados.',
        'Sobre: versão, atualizações, assistente e tours.',
      ],
      note: 'Com muitas opções, a busca no topo acha pelo que você digita (voz, delta, firewall…). Cada grupo tem um “?” que abre a ajuda dele.',
      links: [
        lnk('Console', routes.config('console')),
        lnk('Engenheiro', routes.config('engenheiro')),
        lnk('Ao vivo e aparelhos', routes.config('painel')),
        lnk('Contas e dados', routes.config('contas')),
        lnk('Sobre', routes.config('sobre')),
      ],
      keywords: 'configurações ajustes grupos buscar menu opções',
    },
    {
      id: 'idioma-e-dados',
      topic: 'settings',
      title: 'Idioma e seus dados',
      summary: 'O idioma vale para a tela e para a voz do engenheiro.',
      steps: [
        'Para trocar, abra Configurações → Contas e dados → Idioma do app: português, inglês ou espanhol.',
        'Para fazer uma cópia de segurança, copie a pasta que aparece em Pasta dos dados.',
      ],
      note: 'Sessões, voltas e gravações ficam só no seu PC. O Bono não tem servidor nem conta.',
      links: [lnk('Contas e dados', routes.config('contas'))],
      keywords: 'english español língua backup cópia segurança privacidade',
    },

    {
      id: 'discord-configurar',
      topic: 'discord',
      title: 'Configurar o Discord em 4 passos',
      summary:
        'O PS5 não toca o som do PC. Por isso o Bono entra num canal de voz como um bot. Exige o Bono para Windows, um servidor seu e um canal privado.',
      steps: [
        'Abra Configurações → Contas e dados → Rádio no Discord → Configurar o Discord.',
        'Criar o bot: o botão abre o Discord Developer Portal. Em New Application, abra Bot e clique em Reset Token.',
        'Colar o token. O Bono valida e mostra “Conectado como …”.',
        'Convidar o bot: o Bono monta o convite com Ver canal, Conectar e Falar. Escolha o servidor e confirme.',
        'Escolher o canal privado e clicar em Concluir.',
      ],
      note: 'Você não copia nenhum ID de usuário.',
      links: [lnk('Rádio no Discord', routes.config('discord'))],
      keywords: 'bot token convite servidor canal developer portal',
    },
    {
      id: 'discord-ouvir-no-ps5',
      topic: 'discord',
      title: 'Ouvir o engenheiro no headset do PS5',
      summary: 'Depois de configurado, falta só entrar no canal.',
      steps: [
        'No PS5, vincule o Discord à sua conta PlayStation e entre no canal por Game Base → Discord.',
        'No Bono, abra o menu (tecla M) → Engenheiro e ligue Falar pelo Discord.',
        'O bot entra quando você entra e sai quando o canal esvazia.',
      ],
      note: 'O Bono para Windows precisa ficar aberto. Para testar o caminho todo, use Testar com 10 bipes.',
      links: [lnk('Rádio no Discord', routes.config('discord'))],
      keywords: 'headset game base falar pelo discord canal de voz ouvir',
    },
    {
      id: 'discord-atraso',
      topic: 'discord',
      title: 'Calibrar o atraso (opcional)',
      summary: 'Sem calibrar, o Bono usa 300 ms e o som pode chegar um pouco depois da curva.',
      steps: [
        'Abra Rádio no Discord → Ajuste fino e clique em Testar com 10 bipes. Entre no canal pelo PS5.',
        'Filme a tela com o celular, perto do headset, e estime os milissegundos entre o BIP na tela e o som.',
        'Clique em Encerrar teste e informe as medições separadas por vírgula. Com várias, o Bono usa o percentil 90.',
        'Clique em Salvar ajuste fino.',
      ],
      note: 'Refaça se mudar de rede, de região de voz ou de headset.',
      links: [lnk('Rádio no Discord', routes.config('discord'))],
      keywords: 'calibragem latência delay bipe ms sincronizar',
    },

    {
      id: 'sem-sinal',
      topic: 'problems',
      title: 'Sem sinal do PS5',
      summary: 'O chip de conexão não fica verde.',
      steps: [
        'PC e PS5 na mesma rede (de preferência os dois no cabo ou no mesmo Wi-Fi).',
        'O Gran Turismo 7 aberto e o carro numa pista. Nos menus o jogo não envia dados.',
        'Firewall do Windows: permita o Bono em redes privadas e confira se a rede está como Privada. Em Configurações → Ao vivo e aparelhos → Acesso pela rede (Windows) o Bono mostra o estado e corrige.',
        'Em Configurações → Console, clique em Procurar de novo. Se não achar, use Mais opções → Usar outro IP.',
        'Feche qualquer outro app de telemetria: dois não dividem a mesma porta.',
      ],
      links: [
        lnk('Console', routes.config('console')),
        lnk('Acesso pela rede', routes.config('firewall')),
      ],
      keywords: 'sem sinal desconectado não conecta firewall rede privada ps5 ip udp',
    },
    {
      id: 'engenheiro-mudo',
      topic: 'problems',
      title: 'O engenheiro não fala',
      summary: 'Confira nesta ordem.',
      steps: [
        'Está ligado? A faixa do Ao vivo diz “Engenheiro desligado”. Ligue no menu (M) → Engenheiro.',
        'Está sem som? Veja o Volume, o Nível de fala (Mudo) e o botão de som do aparelho.',
        'Qual aparelho toca? Em Onde ele fala, o som sai neste aparelho, no Discord ou em outro aparelho. Com o Discord, o Bono para Windows deve estar aberto e alguém no canal.',
        'A pista é nova? Na primeira volta ele só aprende o traçado e começa a falar na seguinte.',
        'Falta referência? Ele avisa na faixa; dê mais uma volta ou grave um replay.',
      ],
      links: [lnk('Configurações → Engenheiro', routes.config('engenheiro'))],
      keywords: 'mudo sem som não ouço silêncio calado volume desligado áudio',
    },
    {
      id: 'discord-com-problema',
      topic: 'problems',
      title: 'O Discord não funciona',
      summary: 'Cada mensagem do Bono diz o que falta.',
      items: [
        'O Discord recusou o token: foi trocado ou revogado. Gere outro em Bot → Reset Token e use Reconfigurar → Usar outro bot.',
        'O bot está sem permissão no canal: dê a ele Ver canal, Conectar e Falar nesse canal.',
        'O canal de voz não existe mais: escolha outro em Reconfigurar.',
        'Aguardando alguém no canal: entre pelo PS5 (Game Base → Discord). O bot entra sozinho.',
        'Sem som no headset: o Bono para Windows precisa estar aberto e Falar pelo Discord ligado.',
      ],
      links: [lnk('Rádio no Discord', routes.config('discord'))],
      keywords: 'token permissão canal bot recusou reconfigurar apagar configuração',
    },
    {
      id: 'pista-nao-reconhecida',
      topic: 'problems',
      title: 'A pista não foi reconhecida',
      summary: 'O reconhecimento só acontece quando uma volta cronometrada fecha.',
      steps: [
        'Dê a volta completa, sem reiniciar, pausar por muito tempo nem sair do carro. Uma volta suja não cria a pista.',
        'Faça mais uma volta limpa. Pista nova pede uma volta de reconhecimento antes de o engenheiro falar.',
        'Se ficar em “Pista nova”, toque nela com o carro parado e escolha o nome, ou dê o nome na Início.',
      ],
      note: 'Layouts parecidos (reverso, com ou sem chicane) podem confundir. Confirme o nome quando o Bono perguntar.',
      links: [lnk('Início', routes.home())],
      keywords: 'não reconhece pista desconhecida nova nome errada volta suja',
    },
    {
      id: 'celular-nao-abre',
      topic: 'problems',
      title: 'O celular não abre o Ao vivo',
      summary: 'O aparelho precisa alcançar o Bono pela rede.',
      steps: [
        'Celular e PC na mesma rede Wi-Fi.',
        'Abra o QR Code em Configurações → Ao vivo e aparelhos → Abrir no celular ou tablet.',
        'Se não abrir, veja Acesso pela rede (Windows). Se o Windows estiver bloqueando, clique em corrigir.',
        'Gire o celular para a horizontal.',
      ],
      links: [lnk('Abrir no celular ou tablet', routes.config('acesso-remoto'))],
      keywords: 'tablet qr code não abre lan firewall 8770 remoto',
    },

    {
      id: 'atalhos',
      topic: 'keys',
      title: 'Atalhos de teclado',
      summary: 'No Ao vivo e na ajuda.',
      shortcuts: [
        { keys: ['?'], text: 'abre a ajuda' },
        { keys: ['M'], text: 'abre e fecha o menu' },
        { keys: ['L'], text: 'trava ou destrava os gestos' },
        { keys: ['←', '→'], text: 'troca de tela' },
        { keys: ['Enter'], text: 'escolher as telas' },
        { keys: ['D'], text: 'troca a referência do delta' },
        { keys: ['Espaço'], text: 'mostra o nome da tela e o delta' },
        { keys: ['Esc'], text: 'fecha menu, seletor ou tour' },
      ],
      note: 'Os atalhos não funcionam enquanto você digita num campo.',
      keywords: 'teclas teclado shortcut tecla',
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// English
// ---------------------------------------------------------------------------------------------

const EN: HelpContent = {
  topics: [
    {
      id: 'start',
      icon: 'play',
      title: 'Getting started',
      description: 'From install to your first lap, and the tours.',
    },
    {
      id: 'engineer',
      icon: 'radio',
      title: 'The engineer and voices',
      description: 'Turn it on, pick a voice and tune how it talks.',
    },
    {
      id: 'live',
      icon: 'live',
      title: 'Live dashboard and gestures',
      description: 'Screens, delta, gestures and other devices.',
    },
    {
      id: 'tracks',
      icon: 'home',
      title: 'Tracks and sessions',
      description: 'How Bono recognises the track and keeps your laps.',
    },
    {
      id: 'settings',
      icon: 'config',
      title: 'Settings: where everything is',
      description: 'The six groups and what each one holds.',
    },
    {
      id: 'discord',
      icon: 'volume',
      title: 'Discord on the PS5',
      description: 'Hear the engineer in your PS5 headset.',
    },
    {
      id: 'problems',
      icon: 'alert',
      title: 'Common problems',
      description: 'No signal, silent engineer, Discord and track.',
    },
    {
      id: 'keys',
      icon: 'menu',
      title: 'Keyboard shortcuts',
      description: 'The keys for the live dashboard and help.',
    },
  ],
  articles: [
    {
      id: 'primeiros-passos',
      topic: 'start',
      title: 'From install to your first lap',
      summary: 'The shortest way to hear the engineer.',
      steps: [
        'Open Bono on your PC, on the same network as the PS5.',
        'Follow the first-run assistant: language and voice, PS5, how you train, engineer and screens. You can skip steps and come back.',
        'On the PS5, open Gran Turismo 7 and enter a track.',
        'In Bono, open Live. The connection chip shows when data arrives.',
        'Drive the first lap. Bono recognises the track when the lap closes, and the engineer talks from the next one.',
      ],
      note: 'Trained on this track before? Pick it before leaving the pits and the engineer talks from lap 1.',
      links: [lnk('Open Live', routes.live()), lnk('PS5 connection', routes.config('console'))],
      actions: ['setup', 'tourLive'],
      keywords: 'install start begin tutorial',
    },
    {
      id: 'refazer-assistente',
      topic: 'start',
      title: 'Redo the setup assistant',
      summary: 'Goes through language, voice, PS5, engineer and screens again.',
      steps: [
        'Open Settings → About.',
        'Click Redo the setup assistant. It starts again from the first step.',
        'At each step, continue or use Skip step. “Do this later” closes the assistant and keeps what you already did.',
      ],
      note: 'Steps you leave for later show up in the “Still to set up” card, at the top of Home and Settings.',
      links: [lnk('Settings → About', routes.config('sobre'))],
      actions: ['setup'],
      keywords: 'onboarding welcome restart first-run',
    },
    {
      id: 'ver-os-tours',
      topic: 'start',
      title: 'See the tours',
      summary:
        'Two short walkthroughs: the Live one (on a demo, no PS5 needed) and the history one.',
      steps: [
        'Use the buttons below, the Live menu (key M → Help) or Settings → About.',
        'Move on with Next, the → key or Enter. Esc or Skip tour leaves.',
        'To test on a fresh install, add ?tour=live or ?tour=analysis to the Bono address (for example http://localhost:8770/?tour=live). The tour starts on open, with no first-run condition.',
      ],
      note: 'With the car moving on the real PS5, the tour waits until you stop.',
      actions: ['tourLive', 'tourAnalysis'],
      keywords: 'walkthrough guided demo qa test url parameter',
    },

    {
      id: 'ligar-o-engenheiro',
      topic: 'engineer',
      title: 'Turn on the engineer and pick a mode',
      summary: 'It stays quiet when all goes well and speaks when there is something to fix.',
      steps: [
        'Open the Live menu (key M) and the Engineer tab, or go to Settings → Engineer.',
        'Turn on the engineer. It stays on the next time you open Bono.',
        'Pick the mode: Practice (Learn Track, Gain Time, Consistency or Free), Qualifying or Race.',
        'Set the Volume and check it with Preview voice.',
        'In Where it speaks, choose this device, Discord or another device.',
      ],
      links: [lnk('Settings → Engineer', routes.config('engenheiro'))],
      keywords: 'radio on off training qualifying race learn track',
    },
    {
      id: 'escolher-a-voz',
      topic: 'engineer',
      title: 'Pick the voice',
      summary:
        'Each language has three numbered voices. The calls are pre-recorded, so they work offline.',
      steps: [
        'Open Settings → Engineer → Voice.',
        'Pick one of the three and click Preview voice.',
      ],
      items: [
        'Voice 1 (default): mid-range, direct.',
        'Voice 2: clearer and more energetic.',
        'Voice 3: deep and calm.',
      ],
      note: 'Changing the app language also changes the voices, and Bono remembers your pick for each language (Settings → Accounts and data → App language).',
      links: [lnk('Pick the voice', routes.config('engenheiro'))],
      keywords: 'voice 1 voice 2 voice 3 tone listen test language',
    },
    {
      id: 'como-ele-fala',
      topic: 'engineer',
      title: 'How much and when it talks',
      summary: 'Fine settings under More options, in Settings → Engineer.',
      items: [
        'Speech level: Essential, Detailed or Muted.',
        'Speech pace: Slow, Normal or Fast.',
        'Call lead time: how early before the corner it warns you. With Discord, the measured delay counts too.',
        'Practice summary: how often it sums up your laps.',
        'Positive feedback: also tells you when you nail a corner.',
      ],
      note: 'On the Live screen, the radio button shows or hides the engineer card without turning it off.',
      links: [lnk('Settings → Engineer', routes.config('engenheiro'))],
      keywords: 'mute silence speed pace praise summary anticipation',
    },

    {
      id: 'gestos',
      topic: 'live',
      title: 'Live gestures and buttons',
      summary: 'Made for a hand on the wheel or the controller.',
      items: [
        'Swipe sideways (or ← →): switch screen.',
        'Tap: briefly shows the screen name and the delta reference.',
        'Double tap: change the delta reference.',
        'Press and hold the screen (or Enter): choose which screens to show.',
        'Padlock (key L): locks the gestures. Hold it to unlock.',
        'Menu button (key M): history, engineer, screens and help.',
      ],
      note: 'With the gestures locked, the menu still opens.',
      actions: ['tourLive'],
      keywords: 'swipe tap hold padlock lock switch screen',
    },
    {
      id: 'delta-e-referencia',
      topic: 'live',
      title: 'Delta, sectors and reference lap',
      summary: 'The delta compares you, at every instant, with a reference lap.',
      items: [
        'Green: faster than the reference. Red: slower.',
        'Each sector shows the difference to your best lap.',
        'Reference: Personal best, Session best or Reference lap. Double tap cycles through them.',
        'The default lives in Settings → Engineer → More options → Reference lap.',
      ],
      note: 'No reference? Drive one more lap (it becomes the reference) or record a replay lap.',
      links: [lnk('Record a replay lap', routes.capture())],
      keywords: 'delta sector best lap personal session time gain loss',
    },
    {
      id: 'telas-e-aparelhos',
      topic: 'live',
      title: 'Screens and other devices',
      summary: 'Each device keeps its own screens.',
      steps: [
        'Press and hold the screen, or open the menu → Live → Choose screens.',
        'For a starting point, use Simple, Full or Endurance race in Settings → Live and devices.',
        'To build your own grid, use Edit custom view.',
        'To open it on a phone or tablet, scan the QR code in Open on a phone or tablet, on the same network. Use the phone in landscape.',
      ],
      links: [
        lnk('Live and devices', routes.config('painel')),
        lnk('Open on a phone or tablet', routes.config('acesso-remoto')),
      ],
      keywords: 'phone tablet qr code preset custom widgets remote lan',
    },

    {
      id: 'reconhecer-a-pista',
      topic: 'tracks',
      title: 'How Bono recognises the track',
      summary:
        'The game does not report the track. Bono recognises it by its shape when a timed lap closes.',
      steps: [
        'Out lap: it does not count.',
        'Recognition lap: drive the full lap without leaving the track or restarting.',
        'Ready: from the next lap, engineer and delta work.',
      ],
      note: 'The strip at the top of Live shows the track, the car and the engineer state. On “New track · Name it”, tap it with the car stopped to say which one it is.',
      keywords: 'recognition lap detect identify layout new track name',
    },
    {
      id: 'escolher-a-pista',
      topic: 'tracks',
      title: 'Pick the track before you start',
      summary: 'With saved tracks, the engineer talks from lap 1.',
      steps: [
        'In the game menu, Bono shows the “Which track today?” card. Pick a recent one or search for another.',
        'Forgot? Tap the context strip at the top of Live, with the car stopped.',
        'When the first lap closes, Bono checks. If the track does not match, it tells you when you stop.',
      ],
      note: 'To stop being asked, turn off Ask for the track at the start in Settings → Engineer. It never asks while the car moves.',
      links: [lnk('Settings → Engineer', routes.config('engenheiro'))],
      keywords: 'todays track which track today ask choose manual',
    },
    {
      id: 'historico-e-voltas',
      topic: 'tracks',
      title: 'Sessions, laps and comparison',
      summary: 'Bono saves every session and lap by itself, with no start button.',
      items: [
        'Home: your tracks, best lap and progress.',
        'Compare laps: corner by corner, with charts.',
        'Record a replay lap: uses a game replay (yours or a faster driver’s) as the reference.',
        'AI Coach: session analysis, with your Anthropic key (Settings → Accounts and data).',
      ],
      note: 'Automatic recording is switched in Settings → Console.',
      links: [
        lnk('Home', routes.home()),
        lnk('Compare laps', routes.compare({})),
        lnk('Record a replay lap', routes.capture()),
      ],
      actions: ['tourAnalysis'],
      keywords: 'history session record automatic reference coach compare',
    },

    {
      id: 'onde-fica-cada-coisa',
      topic: 'settings',
      title: 'Where everything is',
      summary: 'Six groups, no configuration file.',
      items: [
        'Home: how everything is right now (PS5, engineer, recording, devices) and what is left to set up.',
        'Console: PS5 search, automatic recording and, under More options, another IP.',
        'Engineer: on/off, voice, mode, volume and where it speaks.',
        'Live and devices: each device’s screens, QR code, Windows network access.',
        'Accounts and data: Discord, AI Coach, language, data folder.',
        'About: version, updates, assistant and tours.',
      ],
      note: 'With many options, the search at the top finds what you type (voice, delta, firewall…). Each group has a “?” that opens its help.',
      links: [
        lnk('Console', routes.config('console')),
        lnk('Engineer', routes.config('engenheiro')),
        lnk('Live and devices', routes.config('painel')),
        lnk('Accounts and data', routes.config('contas')),
        lnk('About', routes.config('sobre')),
      ],
      keywords: 'settings groups search menu options',
    },
    {
      id: 'idioma-e-dados',
      topic: 'settings',
      title: 'Language and your data',
      summary: 'The language applies to the screen and to the engineer’s voice.',
      steps: [
        'To change it, open Settings → Accounts and data → App language: Portuguese, English or Spanish.',
        'To back up, copy the folder shown in Data folder.',
      ],
      note: 'Sessions, laps and recordings stay on your PC only. Bono has no server and no account.',
      links: [lnk('Accounts and data', routes.config('contas'))],
      keywords: 'portugues espanol language backup privacy',
    },

    {
      id: 'discord-configurar',
      topic: 'discord',
      title: 'Set up Discord in 4 steps',
      summary:
        'The PS5 does not play the PC’s sound, so Bono joins a voice channel as a bot. It needs Bono for Windows, your own server and a private channel.',
      steps: [
        'Open Settings → Accounts and data → Discord radio → Set up Discord.',
        'Create the bot: the button opens the Discord Developer Portal. Under New Application, open Bot and click Reset Token.',
        'Paste the token. Bono checks it and shows “Connected as …”.',
        'Invite the bot: Bono builds the invite with View Channel, Connect and Speak. Pick your server and confirm.',
        'Pick the private channel and click Done.',
      ],
      note: 'You never copy a user ID.',
      links: [lnk('Discord radio', routes.config('discord'))],
      keywords: 'bot token invite server channel developer portal',
    },
    {
      id: 'discord-ouvir-no-ps5',
      topic: 'discord',
      title: 'Hear the engineer in the PS5 headset',
      summary: 'Once set up, you only need to join the channel.',
      steps: [
        'On the PS5, link Discord to your PlayStation account and join the channel through Game Base → Discord.',
        'In Bono, open the menu (key M) → Engineer and turn on Speak through Discord.',
        'The bot joins when you join and leaves when the channel empties.',
      ],
      note: 'Bono for Windows must stay open. To test the whole path, use Test with 10 beeps.',
      links: [lnk('Discord radio', routes.config('discord'))],
      keywords: 'headset game base speak through discord voice channel listen',
    },
    {
      id: 'discord-atraso',
      topic: 'discord',
      title: 'Calibrate the delay (optional)',
      summary:
        'Without calibration, Bono uses 300 ms and the sound may arrive a bit after the corner.',
      steps: [
        'Open Discord radio → Fine tuning and click Test with 10 beeps. Join the channel from the PS5.',
        'Film the screen with a phone near the headset and estimate the milliseconds between the on-screen BEEP and the sound.',
        'Click End test and enter the measurements, comma-separated. With several, Bono uses the 90th percentile.',
        'Click Save fine tuning.',
      ],
      note: 'Redo it if you change network, voice region or headset.',
      links: [lnk('Discord radio', routes.config('discord'))],
      keywords: 'calibration latency delay beep ms sync',
    },

    {
      id: 'sem-sinal',
      topic: 'problems',
      title: 'No signal from the PS5',
      summary: 'The connection chip does not turn green.',
      steps: [
        'PC and PS5 on the same network (ideally both wired, or on the same Wi-Fi).',
        'Gran Turismo 7 open and the car on a track. In menus the game sends no data.',
        'Windows Firewall: allow Bono on private networks and check the network is set to Private. In Settings → Live and devices → Network access (Windows), Bono shows the state and fixes it.',
        'In Settings → Console, click Search again. If it finds nothing, use More options → Use a different IP.',
        'Close any other telemetry app: two cannot share the same port.',
      ],
      links: [
        lnk('Console', routes.config('console')),
        lnk('Network access', routes.config('firewall')),
      ],
      keywords: 'no signal disconnected not connecting firewall private network ps5 ip udp',
    },
    {
      id: 'engenheiro-mudo',
      topic: 'problems',
      title: 'The engineer is silent',
      summary: 'Check in this order.',
      steps: [
        'Is it on? The Live strip says “Engineer off”. Turn it on in the menu (M) → Engineer.',
        'Is it muted? Check Volume, Speech level (Muted) and the device’s own volume.',
        'Which device plays? Where it speaks sends the sound to this device, Discord or another device. With Discord, Bono for Windows must be open and someone in the channel.',
        'Is the track new? On the first lap it only learns the shape, and starts talking on the next.',
        'Missing a reference? It says so in the strip; drive one more lap or record a replay.',
      ],
      links: [lnk('Settings → Engineer', routes.config('engenheiro'))],
      keywords: 'silent mute no sound cannot hear quiet volume off audio',
    },
    {
      id: 'discord-com-problema',
      topic: 'problems',
      title: 'Discord is not working',
      summary: 'Each Bono message says what is missing.',
      items: [
        'Discord refused the token: it was reset or revoked. Make a new one under Bot → Reset Token and use Set up again → Use another bot.',
        'The bot lacks permission in the channel: give it View Channel, Connect and Speak there.',
        'The voice channel no longer exists: pick another under Set up again.',
        'Waiting for someone in the channel: join from the PS5 (Game Base → Discord). The bot joins by itself.',
        'No sound in the headset: Bono for Windows must be open, with Speak through Discord on.',
      ],
      links: [lnk('Discord radio', routes.config('discord'))],
      keywords: 'token permission channel bot refused set up again delete configuration',
    },
    {
      id: 'pista-nao-reconhecida',
      topic: 'problems',
      title: 'The track was not recognised',
      summary: 'Recognition only happens when a timed lap closes.',
      steps: [
        'Drive the full lap without restarting, pausing for long or leaving the car. A dirty lap does not create the track.',
        'Drive one more clean lap. A new track needs a recognition lap before the engineer talks.',
        'If it stays on “New track”, tap it with the car stopped and pick the name, or name it on Home.',
      ],
      note: 'Similar layouts (reverse, with or without a chicane) can be confused. Confirm the name when Bono asks.',
      links: [lnk('Home', routes.home())],
      keywords: 'not recognised unknown track new name wrong dirty lap',
    },
    {
      id: 'celular-nao-abre',
      topic: 'problems',
      title: 'The phone cannot open Live',
      summary: 'The device must reach Bono over the network.',
      steps: [
        'Phone and PC on the same Wi-Fi network.',
        'Open the QR code in Settings → Live and devices → Open on a phone or tablet.',
        'If it does not open, check Network access (Windows). If Windows is blocking, click fix.',
        'Turn the phone to landscape.',
      ],
      links: [lnk('Open on a phone or tablet', routes.config('acesso-remoto'))],
      keywords: 'tablet qr code does not open lan firewall 8770 remote',
    },

    {
      id: 'atalhos',
      topic: 'keys',
      title: 'Keyboard shortcuts',
      summary: 'On the Live dashboard and in help.',
      shortcuts: [
        { keys: ['?'], text: 'opens help' },
        { keys: ['M'], text: 'opens and closes the menu' },
        { keys: ['L'], text: 'locks or unlocks the gestures' },
        { keys: ['←', '→'], text: 'switch screen' },
        { keys: ['Enter'], text: 'choose screens' },
        { keys: ['D'], text: 'change the delta reference' },
        { keys: ['Space'], text: 'show the screen name and delta' },
        { keys: ['Esc'], text: 'close menu, picker or tour' },
      ],
      note: 'Shortcuts are off while you type in a field.',
      keywords: 'keys keyboard shortcut hotkey',
    },
  ],
};

// ---------------------------------------------------------------------------------------------
// Español
// ---------------------------------------------------------------------------------------------

const ES: HelpContent = {
  topics: [
    {
      id: 'start',
      icon: 'play',
      title: 'Primeros pasos',
      description: 'De la instalación a la primera vuelta, y los tours.',
    },
    {
      id: 'engineer',
      icon: 'radio',
      title: 'El ingeniero y las voces',
      description: 'Activarlo, elegir la voz y ajustar cómo habla.',
    },
    {
      id: 'live',
      icon: 'live',
      title: 'Panel en directo y gestos',
      description: 'Pantallas, delta, gestos y otros dispositivos.',
    },
    {
      id: 'tracks',
      icon: 'home',
      title: 'Pistas y sesiones',
      description: 'Cómo Bono reconoce la pista y guarda tus vueltas.',
    },
    {
      id: 'settings',
      icon: 'config',
      title: 'Configuración: dónde está cada cosa',
      description: 'Los seis grupos y lo que hay en cada uno.',
    },
    {
      id: 'discord',
      icon: 'volume',
      title: 'Discord en la PS5',
      description: 'Escuchar al ingeniero en los auriculares de la PS5.',
    },
    {
      id: 'problems',
      icon: 'alert',
      title: 'Problemas comunes',
      description: 'Sin señal, ingeniero mudo, Discord y pista.',
    },
    {
      id: 'keys',
      icon: 'menu',
      title: 'Atajos de teclado',
      description: 'Las teclas de En directo y de la ayuda.',
    },
  ],
  articles: [
    {
      id: 'primeiros-passos',
      topic: 'start',
      title: 'De la instalación a la primera vuelta',
      summary: 'El camino más corto para oír al ingeniero.',
      steps: [
        'Abre Bono en el PC, en la misma red que la PS5.',
        'Sigue el asistente inicial: idioma y voz, PS5, cómo entrenas, ingeniero y pantallas. Puedes saltar pasos y volver después.',
        'En la PS5, abre Gran Turismo 7 y entra en una pista.',
        'En Bono, abre En directo. El chip de conexión indica cuándo llegan los datos.',
        'Da la primera vuelta. Bono reconoce la pista al cerrarse la vuelta y el ingeniero habla desde la siguiente.',
      ],
      note: '¿Ya entrenaste en esta pista? Elígelo antes de salir de boxes y el ingeniero habla desde la vuelta 1.',
      links: [
        lnk('Abrir En directo', routes.live()),
        lnk('Conexión con la PS5', routes.config('console')),
      ],
      actions: ['setup', 'tourLive'],
      keywords: 'instalar empezar comenzar tutorial',
    },
    {
      id: 'refazer-assistente',
      topic: 'start',
      title: 'Repetir el asistente inicial',
      summary: 'Pasa otra vez por idioma, voz, PS5, ingeniero y pantallas.',
      steps: [
        'Abre Configuración → Acerca de.',
        'Haz clic en Repetir el asistente. Empieza de nuevo desde el primer paso.',
        'En cada paso, sigue o usa Saltar paso. “Hacerlo después” cierra el asistente y conserva lo ya hecho.',
      ],
      note: 'Los pasos que dejes para después aparecen en la tarjeta “Falta configurar”, arriba en Inicio y en Configuración.',
      links: [lnk('Configuración → Acerca de', routes.config('sobre'))],
      actions: ['setup'],
      keywords: 'onboarding bienvenida reiniciar configuración inicial',
    },
    {
      id: 'ver-os-tours',
      topic: 'start',
      title: 'Ver los tours',
      summary:
        'Dos recorridos cortos: el de En directo (en una demostración, sin PS5) y el del historial.',
      steps: [
        'Usa los botones de abajo, el menú de En directo (tecla M → Ayuda) o Configuración → Acerca de.',
        'Avanza con Siguiente, la flecha → o Enter. Esc o Saltar tour sale.',
        'Para probar en una instalación nueva, añade ?tour=live o ?tour=analysis a la dirección de Bono (por ejemplo http://localhost:8770/?tour=live). El tour empieza al abrir, sin depender de la primera apertura.',
      ],
      note: 'Con el coche en movimiento en la PS5 real, el tour espera a que te detengas.',
      actions: ['tourLive', 'tourAnalysis'],
      keywords: 'recorrido guiado demostración demo qa prueba url parámetro',
    },

    {
      id: 'ligar-o-engenheiro',
      topic: 'engineer',
      title: 'Activar al ingeniero y elegir el modo',
      summary: 'Se queda en silencio cuando todo va bien y habla cuando hay algo que corregir.',
      steps: [
        'Abre el menú de En directo (tecla M) y la pestaña Ingeniero, o ve a Configuración → Ingeniero.',
        'Activa al ingeniero. Sigue activo la próxima vez que abras Bono.',
        'Elige el modo: Entrenamiento (Aprender circuito, Ganar tiempo, Consistencia o Libre), Clasificación o Carrera.',
        'Ajusta el Volumen y compruébalo con Probar voz.',
        'En Dónde habla, elige este dispositivo, Discord u otro dispositivo.',
      ],
      links: [lnk('Configuración → Ingeniero', routes.config('engenheiro'))],
      keywords: 'radio activar desactivar entrenamiento clasificación carrera aprender circuito',
    },
    {
      id: 'escolher-a-voz',
      topic: 'engineer',
      title: 'Elegir la voz',
      summary:
        'Cada idioma tiene tres voces numeradas. Las frases vienen grabadas: funcionan sin internet.',
      steps: [
        'Abre Configuración → Ingeniero → Voz.',
        'Elige una de las tres y haz clic en Probar voz.',
      ],
      items: [
        'Voz 1 (predeterminada): tono medio y directo.',
        'Voz 2: clara y enérgica.',
        'Voz 3: grave y tranquila.',
      ],
      note: 'Cambiar el idioma de la app cambia también las voces, y Bono recuerda tu elección en cada idioma (Configuración → Cuentas y datos → Idioma de la app).',
      links: [lnk('Elegir la voz', routes.config('engenheiro'))],
      keywords: 'voz 1 voz 2 voz 3 tono escuchar probar idioma',
    },
    {
      id: 'como-ele-fala',
      topic: 'engineer',
      title: 'Cuánto y cuándo habla',
      summary: 'Ajustes finos en Más opciones, dentro de Configuración → Ingeniero.',
      items: [
        'Nivel de habla: Esencial, Detallado o Silenciado.',
        'Ritmo de voz: Lento, Normal o Rápido.',
        'Anticipación: con cuánta antelación avisa antes de la curva. Con Discord, cuenta también el retardo medido.',
        'Resumen de entrenamiento: cada cuánto resume tus vueltas.',
        'Refuerzo positivo: avisa también cuando aciertas la curva.',
      ],
      note: 'En la pantalla En directo, el botón de radio muestra u oculta la tarjeta del ingeniero sin desactivarlo.',
      links: [lnk('Configuración → Ingeniero', routes.config('engenheiro'))],
      keywords: 'silenciar mudo velocidad ritmo elogio resumen anticipación',
    },

    {
      id: 'gestos',
      topic: 'live',
      title: 'Gestos y botones de En directo',
      summary: 'Pensados para usar con la mano en el volante o en el mando.',
      items: [
        'Deslizar hacia el lado (o ← →): cambia de pantalla.',
        'Toque: muestra un momento el nombre de la pantalla y la referencia del delta.',
        'Doble toque: cambia la referencia del delta.',
        'Mantener pulsada la pantalla (o Enter): elegir qué pantallas mostrar.',
        'Candado (tecla L): bloquea los gestos. Mantenlo pulsado para desbloquear.',
        'Botón de menú (tecla M): historial, ingeniero, pantallas y ayuda.',
      ],
      note: 'Con los gestos bloqueados, el menú sigue abriéndose.',
      actions: ['tourLive'],
      keywords: 'deslizar swipe tocar mantener candado bloquear cambiar pantalla',
    },
    {
      id: 'delta-e-referencia',
      topic: 'live',
      title: 'Delta, sectores y vuelta de referencia',
      summary: 'El delta te compara, en cada instante, con una vuelta de referencia.',
      items: [
        'Verde: más rápido que la referencia. Rojo: más lento.',
        'Cada sector muestra la diferencia con tu mejor vuelta.',
        'Referencia: Mejor personal, Mejor de la sesión o Vuelta de referencia. El doble toque las alterna.',
        'La opción predeterminada está en Configuración → Ingeniero → Más opciones → Vuelta de referencia.',
      ],
      note: '¿Sin referencia? Da una vuelta más (pasa a valer) o graba la vuelta de una repetición.',
      links: [lnk('Grabar vuelta de repetición', routes.capture())],
      keywords: 'delta sector mejor vuelta personal sesión tiempo ganancia pérdida',
    },
    {
      id: 'telas-e-aparelhos',
      topic: 'live',
      title: 'Pantallas y otros dispositivos',
      summary: 'Cada dispositivo guarda sus propias pantallas.',
      steps: [
        'Mantén pulsada la pantalla, o abre el menú → En directo → Elegir las pantallas.',
        'Como punto de partida, usa Sencillo, Completo o Carrera de resistencia en Configuración → En directo y dispositivos.',
        'Para montar tu propia cuadrícula, usa Editar vista personalizada.',
        'Para abrirlo en el móvil o la tableta, escanea el código QR en Abrir en el móvil o la tableta, en la misma red. Usa el móvil en horizontal.',
      ],
      links: [
        lnk('En directo y dispositivos', routes.config('painel')),
        lnk('Abrir en el móvil o la tableta', routes.config('acesso-remoto')),
      ],
      keywords: 'móvil tableta código qr preset personalizada widgets remoto lan',
    },

    {
      id: 'reconhecer-a-pista',
      topic: 'tracks',
      title: 'Cómo reconoce Bono la pista',
      summary:
        'El juego no informa de la pista. Bono la reconoce por su trazado cuando se cierra una vuelta cronometrada.',
      steps: [
        'Vuelta de salida: no cuenta.',
        'Vuelta de reconocimiento: da la vuelta completa, sin salirte de la pista ni reiniciar.',
        'Listo: desde la vuelta siguiente, funcionan ingeniero y delta.',
      ],
      note: 'La franja de arriba en En directo muestra la pista, el coche y el estado del ingeniero. En “Pista nueva · Ponerle nombre”, toca con el coche parado para decir cuál es.',
      keywords: 'vuelta de reconocimiento detectar identificar trazado pista nueva nombre',
    },
    {
      id: 'escolher-a-pista',
      topic: 'tracks',
      title: 'Elegir la pista antes de salir',
      summary: 'Con pistas ya guardadas, el ingeniero habla desde la vuelta 1.',
      steps: [
        'En el menú del juego, Bono muestra la tarjeta “¿Qué pista hoy?”. Elige una reciente o busca otra.',
        '¿Se te olvidó? Toca la franja de contexto, arriba en En directo, con el coche parado.',
        'Al cerrarse la primera vuelta, Bono comprueba. Si la pista no coincide, te avisa cuando te detengas.',
      ],
      note: 'Para que no pregunte, desactiva Preguntar la pista al empezar en Configuración → Ingeniero. Nunca pregunta con el coche en movimiento.',
      links: [lnk('Configuración → Ingeniero', routes.config('engenheiro'))],
      keywords: 'pista de hoy qué pista hoy preguntar elegir manual',
    },
    {
      id: 'historico-e-voltas',
      topic: 'tracks',
      title: 'Sesiones, vueltas y comparación',
      summary: 'Bono guarda solo cada sesión y cada vuelta, sin botón de inicio.',
      items: [
        'Inicio: tus pistas, mejor vuelta y evolución.',
        'Comparar vueltas: curva a curva, con gráficos.',
        'Grabar vuelta de repetición: usa una repetición del juego (la tuya o la de un piloto más rápido) como referencia.',
        'Coach IA: análisis de la sesión, con tu clave de Anthropic (Configuración → Cuentas y datos).',
      ],
      note: 'La grabación automática se activa en Configuración → Consola.',
      links: [
        lnk('Inicio', routes.home()),
        lnk('Comparar vueltas', routes.compare({})),
        lnk('Grabar vuelta de repetición', routes.capture()),
      ],
      actions: ['tourAnalysis'],
      keywords: 'historial sesión grabar automática referencia coach comparar',
    },

    {
      id: 'onde-fica-cada-coisa',
      topic: 'settings',
      title: 'Dónde está cada cosa',
      summary: 'Seis grupos, sin archivo de configuración.',
      items: [
        'Inicio: cómo está todo ahora (PS5, ingeniero, grabación, dispositivos) y lo que falta configurar.',
        'Consola: búsqueda de la PS5, grabación automática y, en Más opciones, otra IP.',
        'Ingeniero: activar, voz, modo, volumen y dónde habla.',
        'En directo y dispositivos: pantallas de cada dispositivo, código QR, acceso por la red de Windows.',
        'Cuentas y datos: Discord, Coach IA, idioma, carpeta de datos.',
        'Acerca de: versión, actualizaciones, asistente y tours.',
      ],
      note: 'Con muchas opciones, la búsqueda de arriba encuentra lo que escribas (voz, delta, firewall…). Cada grupo tiene un “?” que abre su ayuda.',
      links: [
        lnk('Consola', routes.config('console')),
        lnk('Ingeniero', routes.config('engenheiro')),
        lnk('En directo y dispositivos', routes.config('painel')),
        lnk('Cuentas y datos', routes.config('contas')),
        lnk('Acerca de', routes.config('sobre')),
      ],
      keywords: 'configuración ajustes grupos buscar menú opciones',
    },
    {
      id: 'idioma-e-dados',
      topic: 'settings',
      title: 'Idioma y tus datos',
      summary: 'El idioma vale para la pantalla y para la voz del ingeniero.',
      steps: [
        'Para cambiarlo, abre Configuración → Cuentas y datos → Idioma de la app: portugués, inglés o español.',
        'Para hacer una copia de seguridad, copia la carpeta que aparece en Carpeta de datos.',
      ],
      note: 'Sesiones, vueltas y grabaciones quedan solo en tu PC. Bono no tiene servidor ni cuenta.',
      links: [lnk('Cuentas y datos', routes.config('contas'))],
      keywords: 'english portugués idioma copia seguridad privacidad',
    },

    {
      id: 'discord-configurar',
      topic: 'discord',
      title: 'Configurar Discord en 4 pasos',
      summary:
        'La PS5 no reproduce el sonido del PC, así que Bono entra en un canal de voz como un bot. Requiere Bono para Windows, un servidor tuyo y un canal privado.',
      steps: [
        'Abre Configuración → Cuentas y datos → Radio en Discord → Configurar Discord.',
        'Crear el bot: el botón abre el Discord Developer Portal. En New Application, abre Bot y haz clic en Reset Token.',
        'Pega el token. Bono lo valida y muestra “Conectado como …”.',
        'Invitar al bot: Bono arma la invitación con Ver canal, Conectar y Hablar. Elige tu servidor y confirma.',
        'Elige el canal privado y haz clic en Listo.',
      ],
      note: 'No copias ningún ID de usuario.',
      links: [lnk('Radio en Discord', routes.config('discord'))],
      keywords: 'bot token invitación servidor canal developer portal',
    },
    {
      id: 'discord-ouvir-no-ps5',
      topic: 'discord',
      title: 'Oír al ingeniero en los auriculares de la PS5',
      summary: 'Una vez configurado, solo falta entrar en el canal.',
      steps: [
        'En la PS5, vincula Discord a tu cuenta de PlayStation y entra en el canal por Game Base → Discord.',
        'En Bono, abre el menú (tecla M) → Ingeniero y activa Hablar por Discord.',
        'El bot entra cuando tú entras y sale cuando el canal queda vacío.',
      ],
      note: 'Bono para Windows debe seguir abierto. Para probar todo el camino, usa Probar con 10 pitidos.',
      links: [lnk('Radio en Discord', routes.config('discord'))],
      keywords: 'auriculares game base hablar por discord canal de voz escuchar',
    },
    {
      id: 'discord-atraso',
      topic: 'discord',
      title: 'Calibrar el retardo (opcional)',
      summary:
        'Sin calibrar, Bono usa 300 ms y el sonido puede llegar un poco después de la curva.',
      steps: [
        'Abre Radio en Discord → Ajuste fino y haz clic en Probar con 10 pitidos. Entra en el canal desde la PS5.',
        'Filma la pantalla con el móvil cerca de los auriculares y estima los milisegundos entre el BIP en pantalla y el sonido.',
        'Haz clic en Terminar prueba e indica las mediciones separadas por comas. Con varias, Bono usa el percentil 90.',
        'Haz clic en Guardar ajuste fino.',
      ],
      note: 'Repítelo si cambias de red, de región de voz o de auriculares.',
      links: [lnk('Radio en Discord', routes.config('discord'))],
      keywords: 'calibración latencia retardo pitido ms sincronizar',
    },

    {
      id: 'sem-sinal',
      topic: 'problems',
      title: 'Sin señal de la PS5',
      summary: 'El chip de conexión no se pone verde.',
      steps: [
        'PC y PS5 en la misma red (lo ideal, los dos por cable o en el mismo Wi-Fi).',
        'Gran Turismo 7 abierto y el coche en una pista. En los menús el juego no envía datos.',
        'Firewall de Windows: permite Bono en redes privadas y comprueba que la red esté como Privada. En Configuración → En directo y dispositivos → Acceso por la red (Windows), Bono muestra el estado y lo corrige.',
        'En Configuración → Consola, haz clic en Volver a buscar. Si no la encuentra, usa Más opciones → Usar otra IP.',
        'Cierra cualquier otra app de telemetría: dos no pueden compartir el mismo puerto.',
      ],
      links: [
        lnk('Consola', routes.config('console')),
        lnk('Acceso por la red', routes.config('firewall')),
      ],
      keywords: 'sin señal desconectado no conecta firewall red privada ps5 ip udp',
    },
    {
      id: 'engenheiro-mudo',
      topic: 'problems',
      title: 'El ingeniero no habla',
      summary: 'Comprueba en este orden.',
      steps: [
        '¿Está activado? La franja de En directo dice “Ingeniero desactivado”. Actívalo en el menú (M) → Ingeniero.',
        '¿Sin sonido? Mira el Volumen, el Nivel de habla (Silenciado) y el volumen del propio dispositivo.',
        '¿Qué dispositivo suena? Dónde habla envía el sonido a este dispositivo, a Discord o a otro dispositivo. Con Discord, Bono para Windows debe estar abierto y alguien en el canal.',
        '¿La pista es nueva? En la primera vuelta solo aprende el trazado y empieza a hablar en la siguiente.',
        '¿Falta referencia? Lo dice en la franja; da una vuelta más o graba una repetición.',
      ],
      links: [lnk('Configuración → Ingeniero', routes.config('engenheiro'))],
      keywords: 'mudo sin sonido no oigo silencio callado volumen desactivado audio',
    },
    {
      id: 'discord-com-problema',
      topic: 'problems',
      title: 'Discord no funciona',
      summary: 'Cada mensaje de Bono dice qué falta.',
      items: [
        'Discord rechazó el token: se cambió o se revocó. Genera otro en Bot → Reset Token y usa Reconfigurar → Usar otro bot.',
        'El bot no tiene permiso en el canal: dale Ver canal, Conectar y Hablar en ese canal.',
        'El canal de voz ya no existe: elige otro en Reconfigurar.',
        'Esperando a alguien en el canal: entra desde la PS5 (Game Base → Discord). El bot entra solo.',
        'Sin sonido en los auriculares: Bono para Windows debe estar abierto, con Hablar por Discord activado.',
      ],
      links: [lnk('Radio en Discord', routes.config('discord'))],
      keywords: 'token permiso canal bot rechazó reconfigurar borrar configuración',
    },
    {
      id: 'pista-nao-reconhecida',
      topic: 'problems',
      title: 'No se reconoció la pista',
      summary: 'El reconocimiento solo ocurre cuando se cierra una vuelta cronometrada.',
      steps: [
        'Da la vuelta completa, sin reiniciar, hacer una pausa larga ni salir del coche. Una vuelta sucia no crea la pista.',
        'Da una vuelta limpia más. Una pista nueva pide una vuelta de reconocimiento antes de que el ingeniero hable.',
        'Si se queda en “Pista nueva”, tócala con el coche parado y elige el nombre, o ponle nombre en Inicio.',
      ],
      note: 'Los trazados parecidos (inverso, con o sin chicane) pueden confundirse. Confirma el nombre cuando Bono pregunte.',
      links: [lnk('Inicio', routes.home())],
      keywords: 'no reconoce pista desconocida nueva nombre equivocado vuelta sucia',
    },
    {
      id: 'celular-nao-abre',
      topic: 'problems',
      title: 'El móvil no abre En directo',
      summary: 'El dispositivo debe llegar a Bono por la red.',
      steps: [
        'Móvil y PC en la misma red Wi-Fi.',
        'Abre el código QR en Configuración → En directo y dispositivos → Abrir en el móvil o la tableta.',
        'Si no abre, revisa Acceso por la red (Windows). Si Windows lo bloquea, haz clic en corregir.',
        'Gira el móvil a horizontal.',
      ],
      links: [lnk('Abrir en el móvil o la tableta', routes.config('acesso-remoto'))],
      keywords: 'tableta código qr no abre lan firewall 8770 remoto',
    },

    {
      id: 'atalhos',
      topic: 'keys',
      title: 'Atajos de teclado',
      summary: 'En En directo y en la ayuda.',
      shortcuts: [
        { keys: ['?'], text: 'abre la ayuda' },
        { keys: ['M'], text: 'abre y cierra el menú' },
        { keys: ['L'], text: 'bloquea o desbloquea los gestos' },
        { keys: ['←', '→'], text: 'cambia de pantalla' },
        { keys: ['Enter'], text: 'elegir las pantallas' },
        { keys: ['D'], text: 'cambia la referencia del delta' },
        { keys: ['Espacio'], text: 'muestra el nombre de la pantalla y el delta' },
        { keys: ['Esc'], text: 'cierra menú, selector o tour' },
      ],
      note: 'Los atajos no funcionan mientras escribes en un campo.',
      keywords: 'teclas teclado atajo tecla',
    },
  ],
};

const CONTENT: Record<Language, HelpContent> = { 'pt-BR': PT, en: EN, es: ES };

export function helpContent(language: Language): HelpContent {
  return CONTENT[language] ?? PT;
}

export function helpTopic(content: HelpContent, id: string | undefined): HelpTopic | undefined {
  return content.topics.find((t) => t.id === id);
}

export function helpArticle(content: HelpContent, id: string | undefined): HelpArticle | undefined {
  return content.articles.find((a) => a.id === id);
}

/** Texto em que a busca procura (sem acento, minúsculas). */
function haystack(a: HelpArticle): string {
  return normalizeSearch(
    [
      a.title,
      a.summary,
      ...(a.steps ?? []),
      ...(a.items ?? []),
      ...(a.shortcuts ?? []).map((s) => `${s.keys.join(' ')} ${s.text}`),
      a.note ?? '',
      a.keywords ?? '',
    ].join(' '),
  );
}

/**
 * Artigos que contêm TODAS as palavras digitadas no título ou no corpo, sem diferenciar acento
 * (“configuracao” acha “configuração”). Título primeiro, depois o resto, na ordem do conteúdo.
 */
export function searchHelp(query: string, articles: readonly HelpArticle[]): HelpArticle[] {
  const words = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits = articles.filter((a) => {
    const hay = haystack(a);
    return words.every((w) => hay.includes(w));
  });
  // Pontuação: palavra no título (3), no identificador do artigo (3), no resumo (2), no corpo (1).
  // O desempate é a ordem original dos artigos.
  const score = (a: HelpArticle) => {
    const title = normalizeSearch(a.title);
    const id = normalizeSearch(a.id.replace(/-/g, ' '));
    const summary = normalizeSearch(a.summary);
    return words.reduce(
      (sum, w) =>
        sum +
        (title.includes(w) ? 3 : 0) +
        (id.includes(w) ? 3 : 0) +
        (summary.includes(w) ? 2 : 0) +
        1,
      0,
    );
  };
  return hits
    .map((a, index) => ({ a, index, s: score(a) }))
    .sort((x, y) => y.s - x.s || x.index - y.index)
    .map((x) => x.a);
}

/** Tópico de ajuda de cada grupo de Configurações (o “?” de cada grupo abre `#/ajuda?t=<tópico>`). */
export const CONFIG_GROUP_HELP: Readonly<Record<string, HelpTopicId>> = {
  inicio: 'settings',
  console: 'problems',
  engenheiro: 'engineer',
  painel: 'live',
  contas: 'discord',
  sobre: 'start',
};
