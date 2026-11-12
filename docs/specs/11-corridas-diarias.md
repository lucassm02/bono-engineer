# Spec 11 · Corridas diárias do GT7 (DG EDGE)

**Status:** implementada · **Fonte:** <https://www.dg-edge.com/events/dailies>

## O que é

Uma página nova (`#/diarias`), um cartão na Início e a chave em Configurações → Contas e dados mostram as **três corridas
da semana** do GT7 (Modo Esportivo): pista, carro ou classe, pneus, voltas, regras (BoP, dano, largada, ajustes, vácuo),
horários e números agregados (jogadores, top 100, top 1000, tempos de **medalha** e carros mais usados). Ao lado, a
**melhor volta do piloto** na mesma pista e quanto falta para a próxima medalha.

O **1º lugar** do ranking aparece com um botão **Usar como referência**: ele abre a captura de replay (`#/captura?daily=<id>`)
com o piloto e o tempo do ranking já preenchidos, e a pista escolhida quando o piloto já a tem no histórico.

## Como os dados chegam

- O **servidor local** de cada Bono busca a página no DG EDGE a partir do PC do usuário (nada passa por servidor nosso) e
  guarda o resultado em `<pasta de dados>/cache/daily-races.json`.
- O site é renderizado no servidor (Nuxt) e traz os dados num bloco `__NUXT_DATA__`. O Bono decodifica esse bloco e lê **só
  uma lista de campos** que a página mostra a qualquer visitante. O restante é ignorado.
- Código: `packages/server/src/events/dg-edge.ts` (leitura), `daily-service.ts` (busca, cache, regras de educação),
  `routes/events.ts` (`GET /api/events/dailies`, `POST .../refresh`, `PUT .../enabled`).

## Regras de educação (fixas no código)

- **Identifica-se:** `User-Agent: BonoEngineer/<versão> (+https://github.com/lucassm02/bono-engineer)`.
- **Respeita o `robots.txt`** (consulta e guarda por 24 h; se `/events/dailies` for proibido, não busca).
- Uma requisição por vez, pausa entre as páginas, tempo limite de 12 s, limite de tamanho, **só o mesmo domínio** (recusa
  redirecionamento para outro site).
- **No máximo uma busca por hora**; depois de uma falha, espera 6 h; atualização manual só a cada 10 min.
- **Desligável** pelo usuário; desligado, nada é requisitado.
- Todo dado mostrado vem com o link para a página original ("Ver na íntegra no DG EDGE") e a atribuição da fonte.

## Decisões sobre privacidade e termos

- Os **termos do DG EDGE** reservam o conteúdo e os direitos de banco de dados e permitem uso pessoal e não comercial,
  sem reprodução, distribuição ou uso comercial sem permissão escrita. Por isso: cada usuário busca no **próprio PC**,
  nada é publicado nem empacotado no repositório (os testes usam uma página sintética), e o Bono é gratuito e de código
  aberto.
- **Só o 1º lugar do ranking é lido** (nome, país, tempo e carro): é a única linha do ranking que a própria página traz.
  O ranking completo é carregado por uma **API interna** do site (`admin.dg-edge.com/api`) que não foi feita para uso
  externo; ela **não** é usada.
- **Recomendado:** pedir autorização por escrito ao DG EDGE (contato do site) antes de divulgar este recurso amplamente.
  O código é de uma fonte só, fácil de desligar ou trocar.

## Limites conhecidos

- Um redesenho do site pode quebrar a leitura; nesse caso a tela mostra o último dado guardado e o motivo da falha, e o
  restante do Bono segue normal.
- O nome do traçado vem do endereço da página e é casado com o catálogo de 122 layouts do Bono; layouts novos aparecem com
  o nome do endereço até entrarem no catálogo.
- Fuso: as datas da fonte são tratadas como UTC.

## Ideias para depois (mesma fonte, sem implementar)

| Ideia | Valor | Observação |
|---|---|---|
| **Time Trials** (`/events/time-trials`) | Mesma lógica: tempos de medalha e 1º lugar do desafio da semana | Mesma leitura, outra página |
| **Tabela de BoP** (`/database/bop`) | O engenheiro poderia usar o BoP de cada carro | Dado de banco do site: pedir permissão |
| **Banco de carros e pistas** | Enriquecer o catálogo do Bono | Já usamos fontes abertas para o catálogo |
| **Aviso "sua pista é a da semana"** | Lembrar no ao vivo quando a pista atual é uma Corrida diária | Usa só o que já está no cache |
| **Meta de medalha** | Definir "quero o ouro" e acompanhar no delta ao vivo | Só dados locais depois da leitura |
