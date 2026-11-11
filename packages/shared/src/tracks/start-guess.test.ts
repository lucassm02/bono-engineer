import { describe, expect, it } from 'vitest';
import { guessLayoutByStart, layoutStartHeading, listTrackLayouts } from './index.ts';

const layouts = listTrackLayouts();
const withStart = layouts.filter((l) => l.start && layoutStartHeading(l) !== null);

describe('guessLayoutByStart (palpite pelo catálogo ao cruzar a largada)', () => {
  it('casa: a posição e a direção da largada de um layout nomeiam a pista', () => {
    // um circuito com um único layout para frente e sem reverso na mesma largada
    const trial = withStart.find((l) => l.venue === 'Trial Mountain Circuit' && !l.reverse)!;
    expect(trial).toBeDefined();
    const g = guessLayoutByStart(trial.start!, layoutStartHeading(trial)!);
    expect(g.level).not.toBe('none');
    expect(g.venue).toBe('Trial Mountain Circuit');
    expect(g.best?.layout.venue).toBe('Trial Mountain Circuit');
    expect(g.ambiguous).toBe(false);
  });

  it('tolera alguns metros de diferença e uns graus de direção', () => {
    const trial = withStart.find((l) => l.venue === 'Trial Mountain Circuit' && !l.reverse)!;
    const g = guessLayoutByStart(
      { x: trial.start!.x + 8, z: trial.start!.z - 6 },
      layoutStartHeading(trial)! + 0.12,
    );
    expect(g.venue).toBe('Trial Mountain Circuit');
  });

  it('o reverso não é confundido com o layout para frente (direção oposta)', () => {
    const trial = withStart.find((l) => l.venue === 'Trial Mountain Circuit' && !l.reverse)!;
    const g = guessLayoutByStart(trial.start!, layoutStartHeading(trial)! + Math.PI);
    const names = g.candidates.map((c) => c.layout.id);
    expect(names).not.toContain(trial.id);
  });

  it('sem casamento: longe de qualquer largada ou apontando para o lado', () => {
    expect(guessLayoutByStart({ x: 9e6, z: 9e6 }, 0)).toMatchObject({
      level: 'none',
      best: null,
      ambiguous: false,
    });
    const trial = withStart.find((l) => l.venue === 'Trial Mountain Circuit' && !l.reverse)!;
    const sideways = guessLayoutByStart(trial.start!, layoutStartHeading(trial)! + Math.PI / 2);
    expect(sideways.candidates.map((c) => c.layout.id)).not.toContain(trial.id);
    expect(guessLayoutByStart({ x: Number.NaN, z: 0 }, 0).level).toBe('none');
  });

  it('ambíguo: circuitos diferentes disputando a mesma largada não geram palpite', () => {
    const a = withStart[0]!;
    // tolerâncias enormes fazem layouts de vários circuitos "casarem": nada pode ser afirmado
    const g = guessLayoutByStart(a.start!, layoutStartHeading(a)!, {
      maxStartM: 100_000,
      maxHeadingRad: Math.PI,
    });
    expect(g.level).toBe('none');
    expect(g.ambiguous).toBe(true);
    expect(g.best).toBeNull();
    expect(g.candidates.length).toBeGreaterThan(1);
  });

  it('layouts do mesmo circuito com a mesma largada dão palpite só do circuito', () => {
    // procura dois layouts do mesmo circuito (para frente) com largadas praticamente iguais
    let pair: [(typeof withStart)[number], (typeof withStart)[number]] | null = null;
    for (const a of withStart) {
      const b = withStart.find(
        (o) =>
          o.id !== a.id &&
          o.venue === a.venue &&
          o.reverse === a.reverse &&
          Math.hypot(o.start!.x - a.start!.x, o.start!.z - a.start!.z) < 5,
      );
      if (b) {
        pair = [a, b];
        break;
      }
    }
    if (!pair) return; // o catálogo embarcado não tem esse caso
    const [a] = pair;
    const g = guessLayoutByStart(a.start!, layoutStartHeading(a)!);
    expect(g.venue).toBe(a.venue);
    expect(g.level).toBe('venue');
    expect(g.layoutLabel).toBeNull();
  });
});
