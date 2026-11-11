import { describe, expect, it } from 'vitest';
import {
  type EngineerStatusInput,
  engineerStatusView,
  learnedPopupText,
  learningGuideText,
} from './track-context.ts';

const base: EngineerStatusInput = {
  enabled: true,
  noSignal: false,
  status: 'ready',
  context: { basis: 'lap', confidence: 'confirmed', trackId: 't1' },
};

describe('engineerStatusView: tabela de estados do engenheiro (spec 05 item 2)', () => {
  it('ready é o único estado que diz "Engenheiro pronto"', () => {
    const statuses = [
      'waitingTrack',
      'waitingReference',
      'incompatible',
      'noCues',
      'suspended',
      'ready',
      undefined,
    ] as const;
    const ready = statuses.filter((status) => {
      const v = engineerStatusView({ ...base, status });
      return v.text === 'Engenheiro pronto';
    });
    expect(ready).toEqual(['ready']);
    // nenhum texto antigo e enganoso sobrevive
    for (const status of statuses) {
      expect(engineerStatusView({ ...base, status }).text).not.toMatch(/Rádio pronto/);
    }
  });

  it('waitingTrack em pista nova pede uma volta completa', () => {
    for (const basis of ['none', 'catalog'] as const) {
      const v = engineerStatusView({
        ...base,
        status: 'waitingTrack',
        context: { basis, confidence: 'unknown', trackId: null },
      });
      expect(v.key).toBe('learning');
      expect(v.text).toBe('Dê uma volta completa para eu aprender o traçado');
      expect(v.short).toBe('aprendendo a pista');
      expect(v.tone).toBe('wait');
    }
  });

  it('waitingTrack em pista salva diz que vai confirmar ao cruzar a linha', () => {
    for (const basis of ['start', 'hint'] as const) {
      const v = engineerStatusView({
        ...base,
        status: 'waitingTrack',
        context: { basis, confidence: 'probable', trackId: 't1' },
      });
      expect(v.key).toBe('recognizing');
      expect(v.text).toBe('Reconhecendo a pista… vou confirmar quando você cruzar a linha');
    }
  });

  it('waitingReference oferece gravar uma volta de replay', () => {
    const v = engineerStatusView({ ...base, status: 'waitingReference' });
    expect(v.key).toBe('waitingReference');
    expect(v.text).toBe(
      'Preciso de uma volta de referência. Complete uma volta limpa ou grave um replay',
    );
    expect(v.action).toBe('recordReplay');
    expect(v.tone).toBe('warn');
  });

  it('incompatible dá o motivo e oferece escolher outra referência', () => {
    const v = engineerStatusView({ ...base, status: 'incompatible' });
    expect(v.text).toBe('A referência é de outro carro ou traçado');
    expect(v.detail).toMatch(/mesmo carro/);
    expect(v.action).toBe('pickReference');
  });

  it('noCues explica que faltam pontos de orientação', () => {
    const v = engineerStatusView({ ...base, status: 'noCues' });
    expect(v.text).toBe('A referência não tem pontos de orientação confiáveis');
    expect(v.action).toBeNull();
  });

  it('suspended e quadro sem dados são "aguardando volta"', () => {
    expect(engineerStatusView({ ...base, status: 'suspended' }).key).toBe('waitingLap');
    expect(engineerStatusView({ ...base, status: undefined, context: undefined }).key).toBe(
      'waitingLap',
    );
  });

  it('engenheiro desligado e sem sinal vencem o status do frame', () => {
    const off = engineerStatusView({ ...base, enabled: false });
    expect(off).toMatchObject({
      key: 'off',
      text: 'Engenheiro desligado',
      action: 'toggleEngineer',
    });
    const quiet = engineerStatusView({ ...base, noSignal: true });
    expect(quiet.key).toBe('noSignal');
    // desligado vence até o sem sinal: o piloto precisa saber que é ele quem desligou
    expect(engineerStatusView({ ...base, enabled: false, noSignal: true }).key).toBe('off');
  });

  it('o texto vale em qualquer modo: não depende do modo do rádio', () => {
    // a função não recebe o modo: o mesmo status dá o mesmo texto em Treino, Corrida e Classificação
    const a = engineerStatusView({ ...base, status: 'waitingReference' });
    const b = engineerStatusView({ ...base, status: 'waitingReference' });
    expect(a).toEqual(b);
  });
});

describe('learningGuideText: as três etapas da volta de reconhecimento (spec 05 item 3)', () => {
  it('sem guia para pista conhecida', () => {
    expect(learningGuideText(null, 'ready')).toBeNull();
    expect(learningGuideText(undefined, null)).toBeNull();
  });

  it('etapa 1: volta de saída', () => {
    const g = learningGuideText({ stage: 1, invalid: null }, null)!;
    expect(g.message).toBe('Faça uma volta de saída.');
    expect(g.steps.map((s) => s.state)).toEqual(['current', 'todo', 'todo']);
    expect(g.invalidMessage).toBeNull();
    expect(g.curves).toBeNull();
  });

  it('etapa 2: volta de reconhecimento', () => {
    const g = learningGuideText({ stage: 2, invalid: null }, null)!;
    expect(g.message).toMatch(/Dê a volta completa, sem sair da pista nem reiniciar/);
    expect(g.steps.map((s) => s.state)).toEqual(['done', 'current', 'todo']);
  });

  it('volta inválida mostra o motivo e pede mais uma', () => {
    const restart = learningGuideText({ stage: 1, invalid: 'restart' }, null)!;
    expect(restart.invalidMessage).toBe('Essa volta não serviu (você reiniciou). Faça mais uma.');
    expect(learningGuideText({ stage: 2, invalid: 'discontinuity' }, null)!.invalidMessage).toMatch(
      /não serviu/,
    );
    expect(learningGuideText({ stage: 2, invalid: 'leftTrack' }, null)!.invalidMessage).toMatch(
      /saiu da pista/,
    );
  });

  it('etapa 3: analisando as curvas e depois curvas prontas', () => {
    const pending = learningGuideText({ stage: 3, invalid: null }, 'pending')!;
    expect(pending.steps.map((s) => s.state)).toEqual(['done', 'done', 'current']);
    expect(pending.message).toMatch(/Analisando as curvas…/);
    expect(pending.curves).toBe('pending');
    const ready = learningGuideText({ stage: 3, invalid: null }, 'ready')!;
    expect(ready.message).toMatch(/Curvas prontas/);
    expect(ready.message).toMatch(/próxima volta já tem engenheiro/);
    expect(ready.curves).toBe('ready');
  });

  it('o aviso da volta fechada acompanha o estado das curvas', () => {
    expect(learnedPopupText('pending')).toBe('Aprendi a pista ✓ Analisando as curvas…');
    expect(learnedPopupText('ready')).toBe(
      'Aprendi a pista ✓ Curvas prontas. A partir da próxima volta eu te ajudo.',
    );
  });
});
