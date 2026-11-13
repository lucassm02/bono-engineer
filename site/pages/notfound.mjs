export function render(ctx) {
  const body = `
<section class="lost">
  <div class="wrap">
    <span class="num" aria-hidden="true">404</span>
    <h1>Essa página saiu da pista</h1>
    <p class="lead">O endereço que você abriu não existe no site do Bono. Escolha um destino abaixo.</p>
    <ul>
      <li><a href="${ctx.rel('home')}">Voltar ao início</a></li>
      <li><a href="${ctx.rel('install')}">Como instalar o Bono</a></li>
      <li><a href="${ctx.rel('discord')}">Rádio no Discord</a></li>
      <li><a href="${ctx.rel('guide')}">Guia de pilotagem</a></li>
      <li><a href="${ctx.rel('en')}" lang="en" hreflang="en">English</a></li>
    </ul>
  </div>
</section>`;
  return { body, jsonLd: [] };
}
