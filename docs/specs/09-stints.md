# Spec 09 · Sessões com vários stints (box confirmado pelo piloto)

**Status:** futura (não implementar agora) · **Base:** [relatório](../relatorio-stints-setup-pit-wall.md), seção 4 ·
**Alimenta:** [spec 10](10-setup-entre-stints.md)

## Problema

Uma sessão do Bono atravessa idas ao box (ela só fecha depois de 10 minutos fora da pista), e as voltas ficam todas
na mesma lista. Não dá para comparar "antes e depois de uma parada" nem ligar uma mudança de setup a um trecho da
sessão. O pacote de telemetria do GT7 **não tem sinal de box**, então o Bono não consegue saber sozinho quando o
piloto parou.

## Decisão do dono (2026-11-12)

Em vez de adivinhar, o Bono **pergunta**: quando o carro fica parado por tempo suficiente, aparece um aviso com um botão
para confirmar "estou no box". Ao confirmar, o stint termina. Quando o carro sai, começa um novo stint.

## Como funciona

1. **Detecção:** o carro está na pista (`carOnTrack`), com velocidade **0 km/h** por mais de **20 segundos** seguidos (valor
   padrão, configurável). Não dispara em pausa, menu, replay ou volta em andamento em movimento.
2. **Aviso:** um pop-up discreto, no padrão dos avisos do ao vivo (`data-no-gesture`, nunca com o carro andando):
   "Você parou. Está no box?" com **Sim, estou no box** e **Não**. "Não" silencia o aviso até o carro andar de novo.
3. **Confirmou o box:** o stint atual fecha (`endedAt`, `endReason: 'pitConfirmed'`). O painel mostra "No box · stint 2
   começa quando você sair".
4. **Saída:** quando a velocidade passa de **5 km/h**, abre o stint seguinte, ainda na mesma sessão.
5. **Sem confirmar:** nada muda; as voltas continuam no mesmo stint.
6. **Atalho manual:** botão "Estou no box" no menu ao vivo, para quem quiser marcar antes de parar.
7. **Idas pelo menu/garagem** (o fluxo zera): opcionalmente separam o stint automaticamente quando o intervalo passa de
   20 s; configurável em Configurações → Engenheiro → Mais opções ("Separar stints ao voltar do menu").

## Dados

- Nova tabela `stints` (`id`, `session_id`, `number`, `started_at`, `ended_at`, `end_reason`, `lap_count`, `best_lap_ms`,
  `notes`) e coluna `laps.stint` (número). Migração do esquema com **backup do banco antes** (regra do projeto).
- Voltas já salvas: stint 1, ou divididas retroativamente pelos intervalos entre voltas (rotina opcional).
- O backup `.bono` passa a levar os stints (versão do formato 2, leitura compatível com a 1).

## Telas

- **Sessão:** voltas agrupadas por stint, com cabeçalho (voltas, melhor, média das 5 melhores, consistência).
- **Comparar stints:** diferença por setor e curvas que mais mudaram entre dois stints.
- **Ao vivo:** o pop-up de volta mostra "Stint 2 · volta 3"; o engenheiro pode resumir o stint ao entrar no box.
- **Edição:** juntar ou separar stints na tela da sessão (corrige um aviso confirmado por engano).

## Requisitos

- **RF1.** Detector de parada (`StopDetector`) no motor ao vivo, testado com traços reais de pausa e de box.
- **RF2.** Mensagem WS `pitConfirm` / `pitRejected` e estado `pit` em `status.sessionCapture`.
- **RF3.** `Stint` em `shared`, rotas `GET /api/sessions/:id/stints` e `PATCH /api/stints/:id` (anotação, juntar, separar).
- **RF4.** Textos no glossário; traduções en/es; artigo na Central de ajuda.

## Critérios de aceite

1. Parado 20 s na pista, o aviso aparece; "Sim" fecha o stint e a saída abre o seguinte.
2. Em pausa, menu ou replay o aviso **não** aparece. Com o carro andando, nunca.
3. A tela da sessão mostra as voltas por stint e permite comparar dois.
4. Migração preserva todos os dados (testada com cópia do banco real) e o backup `.bono` leva os stints.

## Riscos

| Risco | Mitigação |
|---|---|
| Aviso incomodar (parada no semáforo da pista, largada) | Só depois de 20 s parado; "Não" silencia até andar; limiar configurável |
| Esquecer de confirmar o box | O stint segue aberto; dá para separar depois na tela da sessão |
