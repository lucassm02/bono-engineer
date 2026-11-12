import { breadcrumbLd } from '../render.mjs';

export function render(ctx) {
  const body = `
<div class="wrap page-head">
  <p class="crumbs"><a href="${ctx.rel('home')}">Início</a> / Rádio no Discord</p>
  <h1>Rádio no Discord para o GT7 no PS5</h1>
  <p class="lead">O PS5 não toca o som do PC. Por isso o Bono entra num canal de voz do Discord como um bot e fala com você pelo headset do PS5, no mesmo ritmo da pista.</p>
</div>

<div class="wrap prose">
  <h2>O que você precisa</h2>
  <ul>
    <li>O <a href="${ctx.rel('instalar')}">Bono instalado</a> no PC com Windows e aberto durante a sessão.</li>
    <li>Um servidor do Discord seu, com um canal de voz <strong>privado</strong>. Quem entrar nele ouve o rádio.</li>
    <li>O Discord vinculado à sua conta PlayStation, para entrar no canal pelo <strong>Game Base → Discord</strong>. Veja o <a href="https://www.playstation.com/pt-br/support/games/discord-voice-chat/" rel="noopener">guia da PlayStation</a>.</li>
  </ul>
  <div class="note">
    <strong>Por que o bot é seu?</strong>
    <p>Um bot único para todo mundo exigiria um servidor guardando o token, e o Bono não tem servidor. Com um bot seu, o token fica só no seu PC, criptografado pelo Windows, e você não depende de ninguém para o rádio funcionar.</p>
  </div>

  <h2>Configure em quatro passos</h2>
  <p>No Bono, abra <strong>Configurações</strong>, <strong>Rádio no Discord</strong> e clique em <strong>Configurar o Discord</strong>. O assistente cuida de tudo, e você não copia nenhum ID.</p>
  <ol class="steps">
    <li>
      <h3>Crie o bot</h3>
      <p>O botão do assistente abre o <a href="https://discord.com/developers/applications" rel="noopener">Discord Developer Portal</a>. Clique em <strong>New Application</strong>, dê um nome, abra a aba <strong>Bot</strong> e clique em <strong>Reset Token</strong> para copiar o token.</p>
    </li>
    <li>
      <h3>Cole o token</h3>
      <p>Cole o token no assistente. O Bono confere e mostra “Conectado como” e o nome do bot. Se o Discord recusar, gere outro token em <strong>Bot → Reset Token</strong>.</p>
    </li>
    <li>
      <h3>Convide o bot para o seu servidor</h3>
      <p>O Bono monta o convite sozinho, já com as permissões <strong>Ver canal</strong>, <strong>Conectar</strong> e <strong>Falar</strong>, e abre no navegador. Escolha o seu servidor e confirme. O assistente espera o bot aparecer e avança sozinho.</p>
    </li>
    <li>
      <h3>Escolha o canal e teste</h3>
      <p>Os canais de voz aparecem agrupados por servidor. Escolha o canal privado. Um canal marcado “Sem permissão” explica o que falta: dê ao bot Ver canal, Conectar e Falar nele.</p>
      <p>Clique em <strong>Testar com 10 bipes</strong>, entre no canal pelo PS5 e confirme que ouve os bipes. Depois clique em <strong>Concluir</strong>.</p>
    </li>
  </ol>

  <h2>Ligue o rádio</h2>
  <p>Na janela do Bono, aperte <kbd>M</kbd> para abrir o menu, entre em <strong>Engenheiro</strong> e ligue <strong>Falar pelo Discord</strong>. Ele liga o bot e escolhe <strong>Discord · PS5</strong> como o aparelho do engenheiro. Desligar devolve o som a cada aparelho.</p>
  <p>O bot entra no canal quando você entra e sai quando o canal esvazia. A saída pelo Discord começa em <strong>Treino</strong>, no perfil <strong>Aprender pista</strong>. Em um tablet na mesma rede, escolha <strong>Discord · PS5</strong> em <strong>Aparelho do engenheiro</strong>. O Bono do PC precisa estar aberto.</p>

  <h2>Acerte o atraso (opcional)</h2>
  <p>Sem calibrar, o Bono usa um atraso padrão de 300 ms, e o som pode chegar um pouco depois da curva. O Bono usa o atraso e a sua velocidade recente para falar antes. Calibre uma vez e de novo se mudar de rede, de região de voz ou de headset.</p>
  <ol>
    <li>Em <strong>Rádio no Discord → Ajuste fino</strong>, clique em <strong>Testar com 10 bipes</strong> e entre no canal pelo PS5.</li>
    <li>Filme com o celular a seção do Bono, com o headset perto do microfone do celular. A indicação <strong>BIP</strong> acende a cada um dos dez envios.</li>
    <li>No vídeo, meça quantos milissegundos passam entre a linha acender e o som começar. A resolução do vídeo limita a precisão.</li>
    <li>Clique em <strong>Encerrar teste</strong> e escreva as medições em <strong>Atraso medido em ms</strong>, separadas por vírgula. Com várias amostras, o Bono usa o percentil 90.</li>
    <li>Marque <strong>Ligar ao abrir o Bono</strong>, se quiser, e clique em <strong>Salvar ajuste fino</strong>.</li>
  </ol>

  <h2>Quando algo falha</h2>
  <div class="tablewrap">
    <table>
      <thead><tr><th>O que o Bono diz</th><th>O que fazer</th></tr></thead>
      <tbody>
        <tr><td>O Discord recusou o token</td><td>O token foi trocado ou revogado. Gere outro em <strong>Bot → Reset Token</strong> e use <strong>Reconfigurar → Usar outro bot</strong>.</td></tr>
        <tr><td>O bot está sem permissão no canal</td><td>Dê ao bot <strong>Ver canal</strong>, <strong>Conectar</strong> e <strong>Falar</strong> nesse canal.</td></tr>
        <tr><td>O canal de voz não existe mais</td><td>Escolha outro canal em <strong>Reconfigurar</strong>.</td></tr>
        <tr><td>Aguardando alguém no canal</td><td>Entre no canal pelo PS5, em <strong>Game Base → Discord</strong>. O bot entra sozinho.</td></tr>
      </tbody>
    </table>
  </div>

  <h2>Perguntas rápidas</h2>
  <h3>Meu token fica seguro?</h3>
  <p>O Bono guarda o token com a criptografia do Windows e nunca o mostra de novo: a tela exibe só “Token salvo” e os quatro últimos caracteres. Para remover, use <strong>Apagar configuração</strong>.</p>
  <h3>Posso usar o rádio sem o Discord?</h3>
  <p>Pode. O mesmo rádio toca no PC e no tablet, com três vozes por idioma que funcionam sem internet. O Discord só leva a voz para o headset do PS5.</p>
  <h3>Quero que o bot entre só quando eu entrar.</h3>
  <p>Em <strong>Ajuste fino</strong>, use <strong>Só seguir este usuário</strong> e informe o ID da sua conta. Vem vazio por padrão.</p>
  <p>Próximo passo: <a href="${ctx.rel('guia')}">entenda o que o engenheiro quer dizer na pista</a>.</p>
</div>`;
  return { body, jsonLd: [breadcrumbLd(ctx.page)] };
}
