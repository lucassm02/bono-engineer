# Contributing to Bono Engineer · Contribuindo com o Bono Engineer

[English](#english) · [Português (Brasil)](#português-brasil)

## English

Bono Engineer is **source-available**: the code is published under the
[PolyForm Noncommercial License 1.0.0](LICENSE), which lets you read, use, change and share it for
noncommercial purposes, but not use it commercially. Contributions to this repository are welcome,
under the terms below.

### Ways to help

- **Report a bug or suggest an idea** by opening an [issue](https://github.com/lucassm02/bono-engineer/issues).
  Include the Bono version, what you did, what you expected and what happened.
- **Send a pull request** with a fix or an improvement. For anything larger than a small fix, open an
  issue first so we can agree on the approach before you spend time on it.

### Your contribution

By opening a pull request, or otherwise submitting code, text or other material to this project, you
confirm that:

1. You wrote it, or you have the right to submit it, and it does not include code you copied from
   another project without a license that allows it. Do not add code under copyleft licenses
   (GPL, AGPL, LGPL and similar) and prefer dependencies under permissive licenses.
2. You keep the copyright in your contribution, and you grant Lucas Santos a worldwide, perpetual,
   irrevocable, royalty-free, non-exclusive license to use, copy, modify, distribute and sublicense
   it, including the right to relicense it, as part of Bono Engineer or any other work, under any
   terms, commercial or not.
3. The project owner may accept, change or reject any contribution, and has no obligation to do so.

If you cannot agree to this, please open an issue instead of a pull request.

### Before you open a pull request

```sh
npm ci
npm run typecheck
npm test
```

Follow the style of the surrounding code, keep the change focused, add or update tests, and add a line
under **Unreleased** in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice. User-facing text
is Brazilian Portuguese in the source, with English and Spanish in `packages/web/src/lib/translations.json`.
See the [README](README.md#run-from-source) for how to run the project.

## Português (Brasil)

O Bono Engineer tem **código disponível**: ele é publicado sob a
[PolyForm Noncommercial License 1.0.0](LICENSE), que permite ler, usar, modificar e compartilhar o
código para fins não comerciais, mas não usá-lo comercialmente. Contribuições para este repositório
são bem-vindas, nos termos abaixo.

### Como ajudar

- **Relate um problema ou sugira uma ideia** abrindo uma [issue](https://github.com/lucassm02/bono-engineer/issues).
  Informe a versão do Bono, o que você fez, o que esperava e o que aconteceu.
- **Envie um pull request** com uma correção ou melhoria. Para algo maior que uma correção pequena,
  abra antes uma issue para combinarmos a abordagem.

### A sua contribuição

Ao abrir um pull request, ou ao enviar de outra forma código, texto ou outro material a este projeto,
você confirma que:

1. Você é o autor, ou tem o direito de enviar o material, e ele não inclui código copiado de outro
   projeto sem uma licença que permita. Não inclua código sob licenças copyleft (GPL, AGPL, LGPL e
   semelhantes) e prefira dependências com licenças permissivas.
2. Você mantém os direitos autorais da sua contribuição e concede a Lucas Santos uma licença mundial,
   perpétua, irrevogável, gratuita e não exclusiva para usar, copiar, modificar, distribuir e
   sublicenciar o material, inclusive o direito de relicenciá-lo, no Bono Engineer ou em qualquer outra
   obra, em quaisquer termos, comerciais ou não.
3. O dono do projeto pode aceitar, alterar ou recusar qualquer contribuição, sem obrigação de aceitar.

Se você não puder concordar com isso, abra uma issue em vez de um pull request.

### Antes de abrir um pull request

```sh
npm ci
npm run typecheck
npm test
```

Siga o estilo do código ao redor, mantenha a mudança focada, crie ou atualize testes e acrescente uma
linha em **Unreleased** no [CHANGELOG.md](CHANGELOG.md) para o que o usuário perceber. Os textos da
interface ficam em português do Brasil no código, com inglês e espanhol em
`packages/web/src/lib/translations.json`. Veja no [README](docs/README.md#rodar-a-partir-do-código) como
rodar o projeto.
