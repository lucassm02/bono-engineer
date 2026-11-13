# Atualizações e notas de versão no Bono Engineer

**Status:** implementado na versão candidata 0.8.0 · **Escopo:** aplicativo Windows x64.

O fluxo instalado valida o SHA-512 do manifesto e o SHA-256 do asset oficial do GitHub antes de executar o instalador. O CI aceita credenciais opcionais de Authenticode. Sem elas, a identidade do pacote depende do repositório público e do transporte HTTPS.

Quem instala o Bono deve poder descobrir, baixar e instalar uma versão nova dentro do aplicativo.
O GitHub Releases continua servindo os arquivos em segundo plano, sem conta do GitHub para o piloto.
As notas ficam disponíveis antes da instalação e, depois dela, mesmo sem internet.

## Experiência do piloto

1. O Bono verifica a versão em segundo plano após abrir, com um pequeno atraso, e a cada 6 horas
   enquanto estiver aberto, inclusive na bandeja. Em **Configurações → Sobre → Atualizações**,
   mostra a versão instalada, a última verificação bem-sucedida e o botão **Verificar atualizações**.
2. Quando houver uma versão mais nova, um aviso discreto aparece no painel ao vivo e na análise,
   com **Ver o que mudou** e **Agora não**. O aviso aparece uma vez por versão. Dispensá-lo
   mantém a atualização acessível em **Sobre**. Durante pilotagem, pausa na pista, captura de
   referência ou assistente inicial, o aviso espera uma oportunidade segura.
3. **Ver o que mudou** abre as notas da versão oferecida e oferece **Baixar atualização**.
   O progresso aparece em **Sobre**, com opção de tentar de novo se o download falhar.
   A checagem automática só consulta metadados. O download começa por ação do piloto.
4. Quando o download terminar, **Reiniciar e instalar** fica disponível. **Mais tarde** mantém
   a atualização pronta para uma ação posterior. Fechar a janela, sair pela bandeja e reabrir
   o Bono são ações comuns. A instalação começa apenas quando o piloto seleciona
   **Reiniciar e instalar**. Se houver pilotagem, pausa na pista ou captura de referência,
   a instalação fica indisponível até a atividade acabar.
5. Ao reabrir com a versão nova, **O que mudou na versão X** aparece uma vez para quem atualizou,
   após o assistente ou a atividade em pista, se houver. Em **Sobre**, as notas da versão
   instalada ficam sempre disponíveis. Uma instalação nova tem acesso às notas em **Sobre**
   desde o início.

A interface cobre **Verificando**, **Você está na versão mais recente**, **Atualização disponível**,
**Baixando**, **Pronta para instalar**, **Instalando** e **Não foi possível verificar/baixar/instalar**.
Exibir que a versão está em dia exige uma consulta bem-sucedida. Falhas em segundo plano ficam
em **Sobre** e no log local. O painel continua disponível durante verificações e downloads.

### Distribuições

| Distribuição | Comportamento proposto |
| --- | --- |
| Bono instalado pelo `Bono-Engineer-Setup-<versão>.exe` | Fluxo completo com NSIS, da verificação ao reinício. Usar este instalador no primeiro lote de testes. |
| Bono portátil | Verificação, aviso e notas no app. Oferecer **Baixar versão portátil** para salvar o novo executável dentro do Bono. A troca do arquivo em uso fica manual nesta etapa. Usar o instalador para receber atualizações completas pelo app. |
| Painel no navegador/PWA, inclusive no celular | Manter a atualização já existente do painel via service worker. O fluxo do executável fica disponível na janela Electron. |
| Versões distribuídas antes do recurso | Instalar uma vez a primeira versão com atualizador. A partir dela, a próxima versão chega pelo próprio Bono. |

## Implementação

### 1. Feed, build e publicação

- Usar `electron-updater` no processo principal do Electron, com GitHub Releases público e
  canal estável. A base usa Electron 45.2.3 e `electron-builder` 26.18.0 no lockfile.
  Fixar uma versão compatível do updater e validar o comportamento no pacote NSIS real.
  Usar `app.getVersion()` e SemVer para comparar versões. Aceitar versões estáveis
  estritamente mais novas e manter desabilitados prereleases e downgrades.
  Para o portátil, consultar a API de releases públicas e selecionar o artefato x64 do mesmo
  tag por nome exato. [Auto Update (electron-builder v26)](https://www.electron.build/v26/docs/features/auto-update/) · [GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)
- Configurar o repositório explicitamente em `packages/desktop/electron-builder.yml`. Preservar
  `appId`, GUID do NSIS e instalação por usuário. Verificar o `resources/app-update.yml`
  empacotado, o nome do executável referenciado por `latest.yml` e o SHA-512 do arquivo.
  Incluir `latest.yml` e o `.blockmap` produzido pelo mesmo build com o Setup, o portátil e
  as notas de versão. Validar no primeiro build a geração do feed com o atual
  `--publish never` e o provider explícito, inclusive em CI.
- Manter o workflow em dois jobs. O job Windows gera e valida o pacote, o manifesto e as notas.
  O job de publicação envia todos os arquivos para um rascunho e publica como estável após
  conferir nomes, versão e integridade. Retomar um rascunho do mesmo tag e commit após falha,
  verificando os arquivos antes da publicação. Versões já publicadas são imutáveis no fluxo.
  Para corrigir uma release ruim, publicar uma versão superior com a correção, inclusive
  se o código voltar a um estado anterior. Prevenir que uma execução atrasada promova uma
  versão inferior a uma já publicada.
- O build atual distribui executáveis sem assinatura de código. Para oferecer instalação de
  atualizações a usuários externos, planejar assinatura Authenticode do app e do Setup,
  identidade de editor estável e verificação efetiva do editor no updater. O SHA-512 do
  manifesto verifica integridade do arquivo em relação ao feed. A assinatura do executável
  autentica seu editor. A versão candidata também confere o digest fornecido pela API do
  GitHub, por tag e nome do asset, antes de marcar o instalador como pronto e ao iniciar a instalação. Adaptar `scripts/dist.ts` e restringir as credenciais de assinatura
  ao job de build da release confiável. Se a assinatura Authenticode ainda estiver pendente,
  avaliar para o primeiro lote um manifesto de atualização assinado com chave pública
  embutida no Bono. Antes de liberar esse caminho, comprovar que a verificação vincula
  versão, nome e hash ao arquivo efetivamente instalado e que adulterações bloqueiam a
  instalação. Validar o comportamento do SmartScreen no Windows com o pacote escolhido.
  [Assinatura de código (electron-builder v26)](https://www.electron.build/v26/docs/features/code-signing/)
- Validar origem HTTPS e nomes esperados. Para o portátil, salvar o executável completo e
  conferido em um destino escolhido pelo usuário, com verificação de integridade e assinatura
  do editor na distribuição pública. Downloads parciais ficam fora do destino final.
  A publicação usa a credencial do CI. O app consulta arquivos públicos.

### 2. Serviço de atualização no desktop

- Criar o serviço em `packages/desktop/src` e ligá-lo a `main.ts` após o boot. O processo
  principal controla checagens, downloads, versão candidata e instalação. Configurar
  `autoDownload = false` e `autoInstallOnAppQuit = false`. Em dev, testes e portátil,
  manter a instalação NSIS desativada; detectar o portátil pelo marcador
  `PORTABLE_EXECUTABLE_FILE` já usado no desktop. Validar ambos os binários empacotados.
  [AppUpdater (electron-builder v26)](https://www.electron.build/v26/docs/api/electron-updater.class.appupdater/)
- Usar um estado por processo e uma operação de cada tipo em andamento. Cliques repetidos
  reaproveitam a operação existente. Limitar tempo de rede e aplicar espera progressiva em
  falhas e limite do GitHub. Guardar a versão dispensada e a última versão vista no estado
  local do desktop. Revalidar a versão oferecida e a integridade do pacote em cache antes de voltar a indicar
  **Pronta para instalar**. Reconciliar a versão pendente com `app.getVersion()` ao abrir e
  só registrar a instalação como concluída quando o executável novo estiver rodando.
  Uma checagem com erro preserva a data da última consulta bem-sucedida.
- Expor via `preload.ts` métodos tipados para obter e acompanhar o estado, verificar,
  baixar, confirmar instalação e marcar notas como vistas. Reutilizar `checkLocalSender`
  em cada IPC e enviar estados somente à janela local autorizada. O renderer recebe versões,
  notas, progresso e códigos de erro, sem fornecer URLs, caminhos de executáveis ou comandos.
  [Segurança de IPC (Electron)](https://www.electronjs.org/docs/latest/tutorial/security#17-validate-the-sender-of-all-ipc-messages)
- Em `main.ts`, integrar a instalação ao encerramento: hoje `before-quit` chama `quitApp()`,
  que termina em `app.exit(0)`, e `stopServer()` tem uma espera limitada. Antes de
  `quitAndInstall`, confirmar no processo principal que a atividade permite reiniciar,
  salvar o estado e aguardar o fechamento real do servidor e a gravação dos dados. Ajustar
  o fluxo de saída e o fechamento para a bandeja para que o encerramento iniciado pelo
  instalador seja concluído uma única vez. Se o encerramento falhar ou exceder o limite,
  cancelar a instalação, manter o pacote pronto e restaurar a operação do app, quando
  necessário. Conferir histórico, configurações e pasta de dados após a reabertura.

### 3. Notas de versão e interface

- Manter `CHANGELOG.md` como fonte editorial. Estender `scripts/release-notes.mjs` para gerar,
  junto do Markdown usado na release, um artefato estruturado com a versão de destino e entradas de
  changelog identificadas por versão e data. Reusar a validação entre os dois `package.json`, tag e changelog.
  Para saltos de versão, gerar também o histórico publicado disponível no changelog e
  filtrar na tela pelo intervalo entre a versão de origem (exclusiva) e a de destino
  (inclusiva), com a mais recente no topo. Guardar a versão de origem antes do reinício. Respeitar as diretivas de histórico já usadas na descrição
  do GitHub, sem duplicar blocos nas notas do app.
- Publicar as notas junto do instalador e empacotar o mesmo conteúdo no app. O desktop busca
  as notas da atualização oferecida pelo tag exato, confere a versão e limita o tamanho.
  Se o arquivo remoto falhar, mostrar **Notas indisponíveis** e oferecer nova tentativa.
  As notas empacotadas cobrem o pós-instalação offline. Renderizar Markdown como elementos
  seguros, sem HTML bruto, e aceitar apenas links HTTPS. Traduzir a interface para pt-BR,
  inglês e espanhol e usar o texto publicado como fallback quando faltar tradução das notas.
- Usar `AboutGroup.tsx` para os controles, o padrão visual de `UpdateNotice.tsx` para o aviso
  e um diálogo acessível para as notas. Montar a experiência desktop tanto no ao vivo quanto
  na análise. Usar a conexão/atividade já conhecida pelo Bono para postergar o aviso e
  validar o estado atual no processo principal antes de instalar. Na janela Electron,
  mostrar o estado do executável em **Sobre** e evitar avisos concorrentes do service worker.

## Ordem de entrega e validação

1. **Pacote e feed:** preparar o build NSIS, a publicação e a geração das notas. Validar
   o artefato no GitHub sem autenticação antes de usar o feed com testadores.
2. **Desktop e interface:** integrar checagem automática e manual, aviso, download,
   instalação, notas antes/depois e comportamento no portátil.
3. **Ensaio no Windows:** instalar uma versão A com o atualizador, disponibilizar a versão B
   em feed de teste e completar A → B pelo app, sem abrir navegador ou executar o Setup à mão.
   Confirmar instalador por usuário, reinício, versão efetiva, notas offline, dados e
   preferências preservados, inclusive com pasta de dados personalizada. Fechar o app
   pela bandeja com download pronto deve manter A até a confirmação de instalação.
4. **Falhas e limites:** verificar sem rede, erro/limite do GitHub, feed incompleto, hash ou
   assinatura inválidos, download interrompido, pacote em cache, versão igual/anterior,
   prerelease, cliques repetidos, corrida/captura em andamento e falha de encerramento.
   Verificar o painel pelo navegador, o portátil e a recusa de IPC de outro frame/origem.
   Exercitar o estado e a política de versão com testes determinísticos e a instalação
   com dois executáveis em Windows.
5. **Primeiro lote:** entregar o Setup da versão A aos testadores uma vez e soltar uma B
   com mudanças descritas. Considerar o fluxo pronto após confirmar em uma instalação
   real que o aviso apareceu, a atualização foi instalada pelo Bono e as notas abriram
   depois do reinício.
