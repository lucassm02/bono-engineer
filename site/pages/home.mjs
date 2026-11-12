import { SITE } from '../config.mjs';
import { heroBackdrop, heroDash, liveChip, motionSection, radioCycle } from '../motion.mjs';
import { faqHtml, faqLd, ICON_DOWNLOAD, softwareLd } from '../render.mjs';

/** Perguntas da home: o texto puro vira também o FAQPage do JSON-LD. */
export const FAQ = [
  {
    q: 'O Bono Engineer é grátis?',
    a: 'É. O Bono é grátis para uso pessoal e sem fins lucrativos, e não pede conta, assinatura nem cadastro. O código está disponível, mas não é software livre: a licença (PolyForm Noncommercial 1.0.0) permite estudar, modificar e compartilhar para fins não comerciais, e não permite uso comercial.',
  },
  {
    q: 'Preciso de um PC ou funciona só com o PS5?',
    a: 'Você precisa de um PC com Windows na mesma rede do PS5. O jogo envia a telemetria pela rede e o Bono roda no PC. Um celular ou tablet na mesma rede vira uma segunda tela.',
  },
  {
    q: 'O que o Bono faz com o meu PS5 e com o jogo?',
    a: 'Só lê os dados que o próprio Gran Turismo 7 envia pela rede local. O Bono não modifica o jogo nem o console. A única coisa que ele manda ao PS5 é o sinal de "estou ouvindo" que o jogo espera para começar a enviar a telemetria.',
  },
  {
    q: 'O Windows avisou que o instalador não é seguro. E agora?',
    a: 'O instalador ainda não tem assinatura digital, então o SmartScreen não reconhece o autor e mostra um aviso. Baixe só pela página de versões do projeto no GitHub, clique em "Mais informações" e depois em "Executar assim mesmo".',
  },
  {
    q: 'Dá para ouvir o engenheiro no headset do PS5?',
    a: 'Dá, pelo Discord. O Bono envia as chamadas para um canal de voz e você ouve no headset do PS5. A configuração leva poucos minutos.',
    link: { id: 'discord', label: 'Veja o passo a passo do rádio no Discord.' },
  },
  {
    q: 'O engenheiro fala português?',
    a: 'Fala. A interface e o rádio têm português do Brasil, inglês e espanhol, com três vozes por idioma. As vozes funcionam sem internet.',
  },
  {
    q: 'Como eu faço backup do meu histórico?',
    a: 'Em Configurações, Contas e dados, use Exportar backup para gerar um arquivo .bono com sessões, voltas e configurações (nunca chaves nem senhas). Em outro PC, Importar backup soma ao histórico existente ou substitui. Também dá para escolher outra pasta de dados, como uma do OneDrive.',
  },
  {
    q: 'O Bono mostra as corridas diárias do GT7?',
    a: 'Mostra, se você quiser. Na primeira vez o Bono pergunta se você quer ver as novidades semanais. Se você disser que sim, ele lê as páginas públicas do DG EDGE a partir do seu PC, no máximo uma vez por hora, e mostra regras, tempos de medalha e o tempo do 1º lugar ao lado da sua melhor volta. Não guarda nomes de jogadores e dá para desligar a qualquer momento.',
  },
  {
    q: 'Meus dados vão para algum servidor?',
    a: 'Não. Sessões, voltas e gravações ficam numa pasta do seu PC, e o Bono não tem servidor nem conta. O rádio no Discord e o Debrief com IA usam a internet, mas só se você ligar. O Coach com IA usa a sua própria chave da Anthropic ou da OpenAI (ou o seu agente, pelo MCP).',
  },
  {
    q: 'Como eu melhoro o meu tempo de volta com os números do Bono?',
    a: 'Escolha uma curva e uma métrica por vez, treine 8 a 10 voltas e compare de novo. O guia explica o que cada número quer dizer na pista.',
    link: { id: 'guia', label: 'Abra o guia de pilotagem.' },
  },
];

export function render(ctx) {
  const v = SITE.version;
  const hero = ctx.pic(
    'ao-vivo',
    'Tela ao vivo do Bono com a faixa de contexto (pista, carro e engenheiro), o delta contra a melhor volta, marcha, velocidade, tempos, setores e as luzes de troca de marcha',
    {
      eager: true,
      sizes: '(min-width: 1000px) 62vw, 100vw',
    },
  );

  const body = `
<section class="hero">
  ${heroBackdrop()}
  <div class="wrap hero-grid">
    <div>
      <h1>Seu engenheiro de pista no Gran Turismo 7</h1>
      <p class="lead">O Bono lê a telemetria do seu PS5, mostra o delta ao vivo e avisa pelo rádio onde frear. Depois da sessão, aponta a curva em que você perdeu tempo.</p>
      <div class="cta-row">
        <a class="btn" href="${SITE.releases}" rel="noopener">${ICON_DOWNLOAD}Baixar para Windows</a>
        <a class="btn btn-ghost" href="#motion">Ver como funciona</a>
      </div>
      <p class="fine">Versão <span class="num">${v}</span>. Grátis, sem conta, para Windows 64 bits.</p>
    </div>
    <figure class="shot">
      ${hero}
      ${heroDash(ctx)}
      ${liveChip('pt-BR')}
      ${radioCycle('pt-BR')}
    </figure>
  </div>
</section>

${motionSection(ctx, 'pt-BR')}

<section class="sec" id="o-que-faz" aria-labelledby="h-faz">
  <div class="wrap split">
    <div class="split-head">
      <h2 id="h-faz">Um engenheiro de pista, não só uma tela de números</h2>
      <p>Do aquecimento ao debrief, o Bono acompanha a sessão e mostra o que treinar na próxima volta.</p>
    </div>
    <ul class="rows">
      <li class="row">
        <div><h3>Ao vivo</h3><p>Delta contra a sua melhor volta ou contra um replay do top, marcha, rotação, pneus, combustível e mapa. São 11 telas, no PC ou num tablet na mesma rede.</p></div>
        <div class="read gain">−0,033<small>delta ao vivo, em segundos</small></div>
      </li>
      <li class="row">
        <div><h3>Rádio do engenheiro</h3><p>Chamadas curtas antes da curva, como “freada leve em 100 metros”, em português, inglês ou espanhol. Toca no PC ou, pelo Discord, no headset do PS5.</p></div>
        <div class="read acc">100 m<small>de aviso antes da freada</small></div>
      </li>
      <li class="row">
        <div><h3>Comparar voltas</h3><p>Sobreponha velocidade, freio e acelerador alinhados por distância e veja em qual curva cada décimo foi embora. O painel “Onde você perde tempo” lista as três curvas que mais custam, com o motivo provável, e o mapa pinta a volta por ganho e perda, velocidade ou freio.</p></div>
        <div class="read loss">+0,024<small>a curva que mais custou, em segundos</small></div>
      </li>
      <li class="row">
        <div><h3>Meta e resumo da sessão</h3><p>Defina uma meta por pista (ou aceite a sugestão: a volta ideal) e acompanhe a diferença ao vivo. Ao terminar, uma tela traz a melhor volta, o ritmo, a regularidade, onde você ganhou e perdeu por curva e até três dicas para a próxima.</p></div>
        <div class="read gain">−0,215<small>melhor volta contra a meta, em segundos</small></div>
      </li>
      <li class="row">
        <div><h3>Replay de uma volta</h3><p>Reveja uma volta como no Gran Turismo: uma bolinha percorre o mapa enquanto você vê freio, acelerador e volante a cada instante. Ponha a sua melhor volta ou a de um piloto do top ao lado, como um fantasma, e toque no que errou para ir direto ao ponto.</p></div>
        <div class="read acc">0,25× a 2×<small>velocidade do replay, passo de 0,1 s</small></div>
      </li>
      <li class="row">
        <div><h3>Treino de curva por voz</h3><p>Escolha uma curva e o engenheiro fala só dela, a cada passagem, comparando com a sua melhor: tempo do trecho, velocidades e ponto de freada. Guarda as dez últimas passagens e mostra um resumo ao parar.</p></div>
        <div class="read acc">10 passagens<small>na mesma curva, volta após volta</small></div>
      </li>
      <li class="row">
        <div><h3>Corridas diárias</h3><p>As três corridas da semana do GT7, com regras, tempos de medalha e o tempo do 1º lugar, ao lado da sua melhor volta na mesma pista. Fica desligado até você aceitar.</p></div>
        <div class="read acc">3 corridas<small>por semana, com medalhas</small></div>
      </li>
      <li class="row">
        <div><h3>Seus dados, do seu jeito</h3><p>Escolha a pasta onde o histórico fica (até uma do OneDrive) e leve tudo para outro PC com um backup .bono. Chaves e senhas nunca entram no arquivo.</p></div>
        <div class="read">.bono<small>um arquivo com todo o histórico</small></div>
      </li>
      <li class="row">
        <div><h3>Coach com IA, se você quiser</h3><p>Pergunte sobre as suas voltas — pontos fortes e fracos, tempos das últimas sessões, o que melhorar — e receba as três curvas que mais custaram, com uma ação para cada. Funciona com o seu agente (Claude Code, Codex) pelo MCP, sem chave, ou com a sua chave da Anthropic ou da OpenAI. O resto do Bono funciona sem ela.</p></div>
        <div class="read">3 curvas<small>com uma ação para cada</small></div>
      </li>
    </ul>
  </div>
</section>

<section class="sec" id="como-funciona" aria-labelledby="h-como">
  <div class="wrap">
    <h2 id="h-como">Conectar, pilotar, analisar</h2>
    <ol class="sectors">
      <li class="sector">
        <span class="tag" aria-hidden="true">S1</span>
        <h3>Conecte o PS5</h3>
        <p>Instale o Bono no PC, na mesma rede do console. Ele encontra o PS5 sozinho e o assistente guia a primeira conexão.</p>
        <p><a href="${ctx.rel('instalar')}">Ver como instalar</a></p>
      </li>
      <li class="sector">
        <span class="tag" aria-hidden="true">S2</span>
        <h3>Pilote</h3>
        <p>Abra o GT7 e entre numa pista. A tela ao vivo acende, o engenheiro fala e cada volta é gravada com setores, validade e traços de telemetria. Um tour guiado e a Central de ajuda explicam cada tela.</p>
        <p><a href="${ctx.rel('discord')}">Ouvir no headset do PS5</a></p>
      </li>
      <li class="sector">
        <span class="tag" aria-hidden="true">S3</span>
        <h3>Analise</h3>
        <p>Compare com a sua melhor volta ou com um replay do top, veja onde o tempo foi embora e treine uma curva de cada vez.</p>
        <p><a href="${ctx.rel('guia')}">Ler o guia de pilotagem</a></p>
      </li>
    </ol>
  </div>
</section>

<section class="sec" id="telas" aria-labelledby="h-telas">
  <div class="wrap">
    <h2 id="h-telas">O Bono por dentro</h2>
    <p class="lead">Capturas do app com dados de demonstração.</p>
    <div class="gal">
      <figure class="fig wide">
        ${ctx.pic('comparar-voltas', 'Tela Comparar voltas com velocidade, acelerador, freio, marcha e volante de duas voltas sobrepostos, e o mapa da pista colorido por ganho e perda de tempo', { sizes: '(min-width: 1240px) 1200px, 100vw' })}
        <figcaption><strong>Comparar voltas</strong>Velocidade, acelerador, freio, marcha e volante sobrepostos, com o delta acumulado e um mapa que mostra onde você ganha e onde perde.</figcaption>
      </figure>
      <figure class="fig">
        ${ctx.pic('inicio-por-pista', 'Tela Início por pista com o total de pistas, sessões e voltas, a busca e a melhor volta de uma pista', { sizes: '(min-width: 900px) 590px, 100vw' })}
        <figcaption><strong>Início por pista</strong>Seus melhores tempos por pista e por carro, com a evolução e o que ainda dá para ganhar.</figcaption>
      </figure>
      <figure class="fig">
        ${ctx.pic('menu-engenheiro', 'Menu do engenheiro aberto sobre a tela ao vivo, na aba Engenheiro', { sizes: '(min-width: 900px) 590px, 100vw' })}
        <figcaption><strong>Menu do engenheiro</strong>Escolha o modo (treino, classificação ou corrida), o nível de fala e a voz do engenheiro, sem sair da tela ao vivo.</figcaption>
      </figure>
    </div>
  </div>
</section>

<section class="sec" id="privacidade" aria-labelledby="h-priv">
  <div class="wrap split">
    <div class="split-head">
      <h2 id="h-priv">Seus dados ficam no seu PC</h2>
      <p>Sem conta, sem login, sem servidor do Bono.</p>
    </div>
    <dl class="facts">
      <div><dt>Tudo local</dt><dd>Sessões, voltas, traços e gravações ficam numa pasta do seu PC, que você pode trocar. Exporte um backup .bono, apague ou leve para outro computador quando quiser.</dd></div>
      <div><dt>Só sai o que você liga</dt><dd>A rede é usada para falar com o PS5, para o rádio no Discord, para o Debrief com IA e para as corridas diárias. Os três últimos ficam desligados até você configurar ou aceitar.</dd></div>
      <div><dt>Token protegido</dt><dd>O token do bot do Discord é guardado com a criptografia do Windows e não volta para a tela.</dd></div>
      <div><dt>Este site também</dt><dd>Sem cookies, sem analytics e sem fontes carregadas de fora.</dd></div>
    </dl>
  </div>
</section>

<section class="sec" id="baixar" aria-labelledby="h-baixar">
  <div class="wrap">
    <div class="dl">
      <div>
        <p class="ver">Versão <span class="num">${v}</span> para Windows 64 bits</p>
        <h2 id="h-baixar">Baixe o Bono e abra o GT7</h2>
        <p class="lead">O instalador está na página de versões do GitHub. Se preferir não instalar, há uma versão portátil.</p>
        <div class="cta-row">
          <a class="btn" href="${SITE.releases}" rel="noopener">${ICON_DOWNLOAD}Baixar o Bono ${v}</a>
          <a class="btn btn-ghost" href="${ctx.rel('instalar')}">Ver como instalar</a>
        </div>
      </div>
      <div>
        <h3>O Windows mostrou um aviso?</h3>
        <p>O instalador ainda não tem assinatura digital, então o SmartScreen não reconhece o autor. Se o arquivo veio da página de versões do projeto, siga estes passos.</p>
        <ol>
          <li>Na janela “O Windows protegeu seu PC”, clique em <strong>Mais informações</strong>.</li>
          <li>Clique em <strong>Executar assim mesmo</strong>.</li>
          <li>Se o firewall perguntar, permita o Bono nas <strong>redes privadas</strong>.</li>
        </ol>
      </div>
    </div>
  </div>
</section>

<section class="sec" id="perguntas" aria-labelledby="h-faq">
  <div class="wrap">
    <h2 id="h-faq">Perguntas frequentes</h2>
    <div class="faq">
${faqHtml(FAQ, ctx)}
    </div>
  </div>
</section>`;
  return { body, jsonLd: [softwareLd(ctx.page), faqLd(FAQ)] };
}
