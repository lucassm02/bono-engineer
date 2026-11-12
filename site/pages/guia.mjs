import { breadcrumbLd } from '../render.mjs';

/**
 * Versão web do guia (docs/guia-de-pilotagem.md): mesmos limiares do app, texto reescrito para quem
 * pesquisa "como melhorar a volta no GT7". Cada métrica tem três respostas: o que o app mostra,
 * o que significa na pista e como treinar.
 */
const SECTIONS = [
  {
    id: 'frenagem',
    title: 'Frenagem',
    metrics: [
      {
        title: 'Ponto de frenagem',
        app: 'A coluna Frenagem mostra a distância da volta em que o freio passa de 5%. O Bono avisa quando você freia 5 m ou mais antes da referência, e dá um marco: a distância arredondada de 5 em 5 m antes da entrada da curva. Frear mais tarde só vira aviso se você também chega ao ápice pelo menos 2 km/h mais lento.',
        means:
          'Frear cedo demais gasta metros de reta em velocidade baixa. Frear tarde demais impede o carro de girar e você perde na velocidade mínima e na saída. O ponto certo é o mais tarde em que ainda dá para chegar ao ápice na velocidade da referência.',
        train:
          'Use o marco como referência visual: a placa de 100 m, o começo da zebra, um poste. Anote na página da pista, no campo de marco de frenagem da curva. Antecipe a freada em 5 m por volta até achar o limite. Na tela Treino de curva, a meta aparece com uma contagem regressiva em metros.',
      },
      {
        title: 'Pico e liberação do freio',
        app: 'O Bono mede o pico de pressão, o tempo até o pico, o ponto de liberação e a duração da freada. Ele avisa “pico de freio de 70%, contra 95%” quando a referência crava 50% ou mais e você fica 12 pontos percentuais abaixo (20 se a referência é um replay).',
        means:
          'Frear forte e cedo usa toda a aderência para tirar velocidade. Subir o freio devagar desperdiça distância. A liberação progressiva é o que prepara a entrada da curva.',
        train:
          'Pise firme e rápido no começo, sem travar, e vá aliviando conforme a velocidade cai. Se a roda travar, alivie um pouco o pico e segure o freio por mais tempo.',
      },
      {
        title: 'Trail braking',
        app: 'A coluna Trail mostra o tempo com freio ainda aplicado enquanto o volante já gira (25% ou mais do pico da curva). O aviso aparece quando a referência faz 0,25 s ou mais e você faz menos de 40% disso: “solta o freio antes de virar na T3”.',
        means:
          'Soltar todo o freio antes de virar tira peso da dianteira e o carro sai de frente na entrada. Um resto de freio na entrada coloca peso na frente e ajuda a fechar a trajetória.',
        train:
          'Em três ou quatro curvas lentas ou médias, mantenha um pouco de freio até perto do ápice e vá aliviando conforme abre o volante. Se a traseira começar a sair, você está soltando tarde demais ou com freio demais.',
      },
    ],
  },
  {
    id: 'meio-da-curva',
    title: 'Meio da curva',
    metrics: [
      {
        title: 'Velocidade mínima e ápice',
        app: 'A coluna V-mín mostra a menor velocidade da curva e onde ela acontece. O Bono avisa quando ela fica 2 km/h ou mais abaixo da referência. Em curvas curtas (até 80 m), avisa também se o seu ápice está 15 m ou mais antes ou depois do da referência, e mostra a marcha no ápice.',
        means:
          'Velocidade mínima baixa costuma ser freio demais ou soltar o freio cedo. Ápice cedo obriga a esperar para acelerar. Ápice tarde deixa acelerar antes, até o ponto em que você abre demais na saída.',
        train:
          'Com velocidade mínima baixa, alivie o freio mais cedo e carregue velocidade até o ápice. Com ápice cedo, vire um pouco mais tarde. Se a velocidade mínima é alta mas a saída é lenta, entre um pouco mais devagar para endireitar o carro e acelerar antes: rápido no ápice não vale se atrasa a saída. Se a referência usa outra marcha, teste a mesma e veja a saída.',
      },
    ],
  },
  {
    id: 'saida',
    title: 'Saída',
    metrics: [
      {
        title: 'Retomada do acelerador',
        app: 'A coluna Retomada mostra onde o acelerador passa de 10% depois da velocidade mínima. Diferença negativa quer dizer que você acelera antes. O aviso aparece quando você acelera 8 m ou mais depois da referência.',
        means:
          'Cada metro de atraso é tempo sem aceleração. Quem retoma cedo e de forma progressiva ganha na reta seguinte.',
        train:
          'Volte ao acelerador logo depois do ápice, de forma progressiva, mesmo que seja 10% a 20% de manutenção. Na tela Treino de curva, a meta de retomada fica vermelha se você retoma mais de 8 m depois.',
      },
      {
        title: 'Roda livre',
        app: 'A coluna Roda livre mostra o tempo com freio e acelerador abaixo de 2% dentro da curva. Acelerador de manutenção não conta. O aviso aparece acima de 0,25 s e com 0,15 s a mais que a referência.',
        means:
          'É tempo jogado fora entre o fim da freada e a retomada: o carro não está freando nem acelerando.',
        train:
          'Emende os pedais: solte o freio ao mesmo tempo em que começa a dar um pouco de acelerador. Se você solta o freio e espera o carro girar, está em roda livre.',
      },
      {
        title: 'Velocidade de saída',
        app: 'A coluna Saída mostra a velocidade 50 m depois do fim da curva. O aviso aparece quando ela fica 3 km/h ou mais abaixo da referência. O tempo da reta seguinte aparece como “retas” no cabeçalho da comparação.',
        means:
          'É a métrica mais valiosa nas curvas que levam a uma reta longa: cada km/h a mais na saída rende em toda a reta.',
        train:
          'Priorize a saída: ápice um pouco mais tarde e acelerador mais cedo. Se a velocidade mínima cair mas a saída melhorar, a troca vale a pena.',
      },
    ],
  },
  {
    id: 'tracado',
    title: 'Traçado e estabilidade',
    metrics: [
      {
        title: 'Traçado',
        app: 'A coluna Traçado mostra o desvio lateral em relação à linha da referência na entrada, no ápice e na saída (positivo é à esquerda). Fica em destaque a partir de 1,2 m.',
        means:
          'Entrar por dentro encurta a curva, mas força um ápice cedo. Ápice por fora faz uma curva mais longa e lenta. O traçado é uma ferramenta para acelerar antes na saída, não um fim.',
        train:
          'Abra mais na entrada, perto da borda externa antes de virar. Feche no ápice rente à zebra interna e use toda a pista na saída. No mapa da comparação, dê zoom na curva e compare as duas linhas.',
      },
      {
        title: 'Patinagem na saída e travamento',
        app: 'O Bono mede a patinagem traseira, o tempo de controle de tração ativo e o travamento da dianteira. Avisa quando o controle de tração atua 0,15 s a mais que a referência, ou quando as rodas da frente escorregam mais de 12% por 0,08 s ou mais. Na tela Pneus, o aviso ao vivo acende a partir de 8%.',
        means:
          'Patinar na saída é acelerador demais, cedo demais ou com o volante ainda muito virado. Travar a dianteira é passar do limite de aderência: o carro não gira.',
        train:
          'Dose o acelerador, abrindo aos poucos enquanto o volante desfaz. Module o pico de freio quando sentir a roda travar.',
      },
      {
        title: 'Correções de volante',
        app: 'Disponível nos formatos de pacote B, ~ e C, que trazem o volante. O Bono conta as inversões em zigue-zague de mais de 0,15 rad e avisa com 4 ou mais, e 3 a mais que a referência.',
        means:
          'O carro está pedindo correção: a traseira escapa ou a entrada foi agressiva demais.',
        train:
          'Faça uma entrada só e constante no volante. Se a traseira escapa, entre mais devagar ou trabalhe o freio e o acelerador antes de mexer no volante.',
      },
    ],
  },
];

const TOC = [
  ['como-ler', 'Como ler os números'],
  ['frenagem', 'Frenagem'],
  ['meio-da-curva', 'Meio da curva'],
  ['saida', 'Saída'],
  ['tracado', 'Traçado e estabilidade'],
  ['consistencia', 'Consistência'],
  ['usar', 'Como usar no treino'],
  ['rotina', 'Rotina de treino'],
];

function metric(m) {
  return `<div class="metric">
      <h3>${m.title}</h3>
      <dl>
        <dt>O que o Bono mostra</dt><dd>${m.app}</dd>
        <dt>O que significa na pista</dt><dd>${m.means}</dd>
        <dt>Como treinar</dt><dd>${m.train}</dd>
      </dl>
    </div>`;
}

export function render(ctx) {
  const sections = SECTIONS.map(
    (s) => `<section id="${s.id}" aria-labelledby="h-${s.id}">
    <h2 id="h-${s.id}">${s.title}</h2>
    ${s.metrics.map(metric).join('\n    ')}
  </section>`,
  ).join('\n  ');

  const body = `
<div class="wrap page-head">
  <p class="crumbs"><a href="${ctx.rel('home')}">Início</a> / Guia de pilotagem</p>
  <h1>Como melhorar a volta no GT7: o guia de pilotagem</h1>
  <p class="lead">O que cada número do Bono quer dizer na pista e como treinar. Os limiares são os mesmos que o app usa na tabela de curvas, em “O que treinar” e no Debrief.</p>
</div>

<div class="wrap guide">
  <nav class="toc" aria-label="Neste guia">
    <h2>Neste guia</h2>
    <ul>${TOC.map(([id, t]) => `<li><a href="#${id}">${t}</a></li>`).join('')}</ul>
  </nav>

  <div class="prose">
  <section id="como-ler" aria-labelledby="h-como-ler">
    <h2 id="h-como-ler">Antes de tudo: como ler os números</h2>
    <ul>
      <li><strong>Você contra a referência.</strong> Toda métrica é comparada com uma volta de referência: a de um piloto do top (capturada de um replay), a sua melhor volta ou a melhor da sessão. Se você não escolhe, o Bono usa o top, depois a sua melhor, depois a melhor da sessão.</li>
      <li><strong>Positivo é mais lento.</strong> No delta ao vivo, na coluna Tempo e nos setores, número positivo quer dizer que você perdeu tempo. Negativo, que ganhou.</li>
      <li><strong>Zona da curva.</strong> O tempo de uma curva vai da zona de frenagem até 50 m depois da saída, e as zonas não se sobrepõem. A soma das curvas e das retas dá exatamente o delta da volta.</li>
      <li><strong>Custo, como “≈ 0,17 s”.</strong> É uma estimativa para ordenar o que atacar primeiro, não uma medida exata. A perda de cada fase é repartida entre os diagnósticos dela, conforme a gravidade.</li>
      <li><strong>Confiança alta, média ou baixa.</strong> Vem da gravidade do desvio. Contra um replay, os avisos de forma de pedal e volante perdem um nível, e os de menos de 10 m também, porque o replay é suavizado e a precisão é de poucos metros.</li>
      <li><strong>Uma ação por diagnóstico.</strong> Em “O que treinar”, o Bono mostra só o diagnóstico mais caro de cada curva.</li>
      <li><strong>Traço (–) não é zero.</strong> A métrica não pôde ser calculada, por exemplo volante no formato A ou curva sem freada.</li>
    </ul>
    <p>Mude uma coisa de cada vez. As métricas se influenciam: frear mais tarde muda a velocidade mínima, que muda a saída. A rotina sugerida está no fim.</p>
  </section>

  ${sections}

  <section id="consistencia" aria-labelledby="h-consistencia">
    <h2 id="h-consistencia">Consistência</h2>
    <div class="metric">
      <dl>
        <dt>O que o Bono mostra</dt><dd>Na página da pista, em “Consistência e evolução”, a média e o desvio por curva. Os destaques ordenam o que mais varia, com um limiar para cada métrica: ponto de frenagem 5 m, velocidade mínima 3 km/h, retomada 8 m, saída 3 km/h, roda livre 0,2 s, tempo na curva 0,08 s e local do ápice 12 m. Exemplo: “ponto de frenagem na T6 varia 15 m entre as voltas”. Só voltas válidas entram.</dd>
        <dt>O que significa na pista</dt><dd>O tempo que você perde por variar é diferente do que perde por técnica. Se o seu ponto de frenagem varia 15 m, mudar a técnica não adianta: falta uma referência visual. Já uma diferença fixa e repetida, como frear sempre 10 m cedo, é técnica.</dd>
        <dt>Como treinar</dt><dd>Primeiro repita, com o mesmo marco, a mesma marcha e o mesmo ponto de saída, por 5 a 10 voltas. Depois mude a técnica. Use a evolução por dia para ver se o desvio está caindo.</dd>
      </dl>
    </div>
  </section>

  <section id="usar" aria-labelledby="h-usar">
    <h2 id="h-usar">Como usar o que o Bono mostra</h2>
    <h3>Treino de curva, no ao vivo</h3>
    <p>Ligue a tela <strong>Treino de curva</strong> (segure a tela e ligue na lista de desligadas). Ela mostra a próxima curva, a distância até a freada da referência, as metas de frenagem, velocidade mínima e retomada e, depois de passar, a última passagem item por item:</p>
    <ul>
      <li><strong>Frenagem:</strong> tolerância de 5 m para mais ou para menos. Freio cedo fica vermelho. Freio tarde é só informação.</li>
      <li><strong>Velocidade mínima:</strong> tolerância de −2 km/h. Abaixo disso fica vermelho.</li>
      <li><strong>Retomada:</strong> tolerância de +8 m. Retomada tarde fica vermelha.</li>
    </ul>
    <p>Sem referência, a tela compara com a sua passagem anterior. <strong>Fixar esta curva</strong> prende a tela numa curva só. O áudio, desligado por padrão, diz no máximo uma frase por passagem. Como não há tempo de ler no meio da curva, olhe a tela nas retas e depois da curva, ou ligue o áudio.</p>
    <p>Para treinar uma curva só, comece pelo botão <strong>Treinar esta curva</strong> do painel “Onde você perde tempo” na comparação, ou escolha a curva na própria tela. O engenheiro passa a falar apenas dela, a cada passagem, comparando com a sua melhor (tempo do trecho, velocidades e ponto de freada). Ele guarda as dez últimas passagens e mostra um resumo ao parar.</p>
    <h3>Meta por pista</h3>
    <p>Na página da pista, em <strong>Minha meta</strong>, digite um tempo ou aceite a sugestão (a volta ideal, ou 0,5% abaixo da sua melhor). Ao vivo, o delta grande mostra a diferença para o ritmo da meta e, depois de cada volta válida, o engenheiro diz quanto falta. Escolha uma meta que você consiga alcançar nesta sessão: uma meta distante demais só repete a mesma má notícia.</p>
    <h3>Comparação, depois da sessão</h3>
    <ol>
      <li>Abra a sessão, marque a sua volta e a referência e clique em <strong>Comparar</strong>.</li>
      <li>Veja o delta total e os setores: em qual terço da volta você perde.</li>
      <li>No gráfico de delta acumulado, procure as inclinações: descida é ganho, subida é perda.</li>
      <li>Em “O que treinar”, leia os três primeiros itens (custo, ação e confiança) e clique em <strong>Ver no gráfico</strong> para ver velocidade, freio e acelerador sobrepostos.</li>
      <li>Na tabela de curvas, ordene por <strong>Mais tempo perdido</strong>. Verde é a seu favor e vermelho custa tempo.</li>
      <li>Na <strong>volta ideal</strong>, a soma dos seus melhores microssetores mostra quanto tempo existe em juntar o que você já fez bem.</li>
      <li>Para ver o que aconteceu dentro da volta, abra o <strong>Replay</strong>: uma bolinha anda no mapa, com freio, acelerador e volante a cada instante, e a sua melhor volta ou uma referência do top corre ao lado como fantasma. Toque em <strong>O que errou</strong> para ir ao ponto.</li>
    </ol>
    <h3>Debrief com IA</h3>
    <p>O Debrief lê as mesmas métricas e devolve as três maiores perdas, com números e uma ação por curva, mais o plano do próximo stint. Peça para focar numa curva, como “foco na T3, por que perco na saída?”. Se a referência for de replay, ele avisa que a precisão é de poucos metros.</p>
  </section>

  <section id="rotina" aria-labelledby="h-rotina">
    <h2 id="h-rotina">Rotina de treino sugerida</h2>
    <div class="note"><strong>Uma mudança por stint</strong><p>Um stint são 8 a 10 voltas seguidas na mesma pista e no mesmo carro. Mudar duas coisas ao mesmo tempo impede de saber o que funcionou.</p></div>
    <ol class="steps">
      <li><h3>Preparação, uma vez por pista e carro</h3><p>Capture uma referência do top ou use a sua melhor volta. Faça 5 voltas de aquecimento para o Bono reconhecer a pista e detectar as curvas. Dê nome às três curvas mais importantes e anote o marco de frenagem de cada uma.</p></li>
      <li><h3>Stint 1, diagnóstico</h3><p>Pilote natural por 8 a 10 voltas. No fim, abra a comparação e o Debrief. Escolha uma curva, a mais cara em “O que treinar”, e uma métrica, como o ponto de frenagem da T1.</p></li>
      <li><h3>Stint 2, uma mudança</h3><p>Deixe a tela Treino de curva com <strong>Fixar esta curva</strong> nessa curva, ou o delta grande. Mude só aquela métrica, por exemplo frear 5 m mais tarde a cada volta. Anote como o carro reagiu.</p></li>
      <li><h3>Revisão, 5 minutos</h3><p>Compare a melhor volta do stint com a referência. A métrica melhorou? O tempo da curva caiu? Se o custo caiu e a consistência não piorou, fixe o novo padrão com uma nota de marco. Se piorou, volte atrás.</p></li>
      <li><h3>Stint 3, consistência</h3><p>Repita sem mudar nada, por 8 a 10 voltas. Em Consistência, veja se o ponto de frenagem e a velocidade mínima têm desvio abaixo dos limiares (5 m e 3 km/h). Só então vá para a próxima curva da lista.</p></li>
      <li><h3>Acompanhe a evolução por dia</h3><p>Na página da pista, a melhor volta, a média das três melhores e o desvio-padrão devem cair com o tempo. O gap para o top também.</p></li>
    </ol>
    <h3>Dicas para o dia a dia</h3>
    <ul>
      <li>Mantenha carro, acerto e pneus fixos durante o treino. A referência só serve com o mesmo carro, e o Bono avisa quando não é.</li>
      <li>Comece pelas curvas que levam a retas longas, onde a saída vale mais, e pelas de maior custo.</li>
      <li>Voltas inválidas (pausa, saída de pista, dados perdidos) ficam fora dos recordes e da consistência.</li>
      <li>Quando a diferença é de poucos metros contra uma referência de replay, trate como tendência, não como fato. Confie nas grandes diferenças, como frear 20 m cedo ou ter 8 km/h a menos no ápice.</li>
    </ul>
    <p>Ainda não instalou? <a href="${ctx.rel('instalar')}">Veja como instalar o Bono</a>.</p>
  </section>
  </div>
</div>`;
  return { body, jsonLd: [breadcrumbLd(ctx.page)] };
}
