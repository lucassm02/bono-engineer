import { SITE } from '../config.mjs';
import { breadcrumbLd, ICON_DOWNLOAD } from '../render.mjs';

export function render(ctx) {
  const v = SITE.version;
  const body = `
<div class="wrap page-head">
  <p class="crumbs"><a href="${ctx.rel('home')}">Início</a> / Como instalar</p>
  <h1>Como instalar a telemetria do GT7 no PS5</h1>
  <p class="lead">Baixe o Bono no PC, libere o firewall, conecte o PS5 e abra a tela ao vivo. É o mesmo caminho do assistente de primeira execução, com os detalhes que ele não cabe mostrar.</p>
  <div class="cta-row"><a class="btn" href="${SITE.releases}" rel="noopener">${ICON_DOWNLOAD}Baixar o Bono ${v}</a></div>
</div>

<div class="wrap prose">
  <h2>O que você precisa</h2>
  <ul>
    <li>Um PC com Windows 64 bits.</li>
    <li>O PS5 e o PC na mesma rede local. Cabo no PS5 costuma dar uma conexão mais estável que o Wi-Fi.</li>
    <li>O Gran Turismo 7 instalado no PS5.</li>
  </ul>

  <h2>Passo a passo</h2>
  <ol class="steps">
    <li>
      <h3>Baixe o instalador</h3>
      <p>Abra a <a href="${SITE.releases}" rel="noopener">página de versões</a> e baixe <code>Bono-Engineer-Setup-${v}.exe</code>. Para rodar sem instalar, baixe <code>Bono-Engineer-${v}-portable.exe</code>.</p>
    </li>
    <li>
      <h3>Instale e abra o Bono</h3>
      <p>Execute o instalador e abra o Bono Engineer. O instalador ainda não tem assinatura digital, então o Windows pode mostrar o aviso “O Windows protegeu seu PC”.</p>
      <div class="note warn">
        <strong>Aviso do SmartScreen</strong>
        <p>Se o arquivo veio da página de versões do projeto, clique em <strong>Mais informações</strong> e depois em <strong>Executar assim mesmo</strong>. Se veio de outro lugar, não execute.</p>
      </div>
    </li>
    <li>
      <h3>Libere o firewall</h3>
      <p>Quando o Firewall do Windows perguntar, permita o Bono nas <strong>redes privadas</strong>. O GT7 envia os dados para a porta UDP 33740 do PC, e o ao vivo no celular usa a porta TCP 8770.</p>
      <p>Se não perguntou e a tela fica esperando o jogo, crie as regras à mão. Abra o PowerShell como administrador e rode:</p>
      <pre><code>New-NetFirewallRule -DisplayName 'Bono Engineer (telemetria GT7)' -Direction Inbound -Protocol UDP -LocalPort 33740 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName 'Bono Engineer (acesso remoto)' -Direction Inbound -Protocol TCP -LocalPort 8770 -Action Allow -Profile Private</code></pre>
      <p>Se o Bono avisar que usa outra porta, use essa porta na regra TCP.</p>
    </li>
    <li>
      <h3>Conecte o PS5</h3>
      <p>Siga o assistente de primeira execução, abra o GT7 no PS5 e entre numa pista. No Bono, abra <strong>Ao vivo</strong>: a tela acende assim que os dados chegam.</p>
      <p>Se a busca automática não achar o console, abra <strong>Configurações</strong>, depois <strong>Integração de telemetria</strong>, clique em <strong>Usar outro IP</strong> e digite o IP do PS5. Você acha o IP nas configurações de rede do console.</p>
    </li>
    <li>
      <h3>Abra o ao vivo no celular ou no tablet</h3>
      <p>No menu do Ao vivo, abra <strong>Abrir em outro aparelho</strong> (ou <strong>Configurações → Ao vivo e aparelhos</strong>), escaneie o QR code ou abra o endereço de rede que aparece ali. Use o aparelho na horizontal. Dá para adicionar o Bono à tela inicial.</p>
    </li>
  </ol>

  <h2>Atualizar o Bono</h2>
  <p>Feche o Bono pela bandeja do Windows e rode o instalador da versão nova. Suas sessões e voltas ficam numa pasta separada do aplicativo e continuam lá.</p>

  <h2>Não aparece nada? O que conferir</h2>
  <div class="tablewrap">
    <table>
      <thead><tr><th>O que você vê</th><th>O que conferir</th></tr></thead>
      <tbody>
        <tr><td>O Bono fica “aguardando o jogo”</td><td>Entre numa pista no GT7. Confira a regra UDP, se o PC e o PS5 estão na mesma sub-rede e se a rede não isola aparelhos (rede de convidados faz isso). Tente informar o IP do console.</td></tr>
        <tr><td>Porta UDP já em uso</td><td>Feche a outra ferramenta de telemetria que usa a porta 33740.</td></tr>
        <tr><td>O celular não abre o ao vivo</td><td>Abra o endereço exato que o Bono mostra. Confira se a rede é privada, a regra TCP e a porta em uso.</td></tr>
        <tr><td>Falta um dado em um replay ou modo do jogo</td><td>Os canais mudam conforme o formato do pacote, o modo e o carro. Alguns replays não enviam o volante, e alguns modos não dão um consumo de combustível confiável.</td></tr>
        <tr><td>O rádio no Discord pede para conferir o canal</td><td>Confira as permissões <strong>Ver canal</strong>, <strong>Conectar</strong> e <strong>Falar</strong> do bot naquele canal. Veja o <a href="${ctx.rel('discord')}">passo a passo do Discord</a>.</td></tr>
      </tbody>
    </table>
  </div>

  <h2>Onde ficam os seus dados</h2>
  <p>O histórico, os traços e as gravações ficam em <code>%APPDATA%\\Bono Engineer</code>. Para fazer backup, feche o Bono e copie a pasta inteira. As configurações da janela e os logs ficam em <code>%LOCALAPPDATA%\\Bono Engineer</code>.</p>

  <h2>E depois de instalar</h2>
  <ul>
    <li><a href="${ctx.rel('discord')}">Ouça o engenheiro no headset do PS5 pelo Discord</a>.</li>
    <li><a href="${ctx.rel('guia')}">Aprenda a ler os números e a treinar uma curva de cada vez</a>.</li>
  </ul>
</div>`;
  return { body, jsonLd: [breadcrumbLd(ctx.page)] };
}
