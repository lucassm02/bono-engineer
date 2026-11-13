import { describe, expect, it } from 'vitest';
import { RADIO_CATALOG } from './phrases.ts';
import {
  AMOUNT_METERS,
  AMOUNTS,
  COMPARATORS,
  composeTask,
  FOCUSES,
  GEAR_ACTIONS,
  GLOBALS,
  locatorForDistance,
  PHASES,
  PURPOSES,
  STEM_COMPARATORS,
  STEMS,
  STRAIGHTS,
  TASK_BUDGET,
  TASK_PIECES,
  type TaskRequest,
  taskActionIds,
  taskCatalog,
  taskDictionaryView,
  taskPieceKey,
  taskPieceText,
  taskTriggers,
} from './tasks.ts';

const LANGUAGES = ['pt-BR', 'en', 'es'] as const;

const ok = (r: ReturnType<typeof composeTask>) => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.composition;
};

describe('the dictionary', () => {
  it('has unique ids and unique clip keys, none of them an existing main-pack clip', () => {
    const ids = TASK_PIECES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const keys = TASK_PIECES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    const main = new Set(RADIO_CATALOG.map((e) => e.text));
    expect(keys.filter((k) => main.has(k))).toEqual([]);
    expect(TASK_PIECES.length).toBeGreaterThanOrEqual(140);
  });

  it('has a text in every language for every piece', () => {
    for (const piece of TASK_PIECES) {
      expect(piece.key.trim(), piece.id).not.toBe('');
      expect(piece.en.trim(), piece.id).not.toBe('');
      expect(piece.es.trim(), piece.id).not.toBe('');
    }
  });

  it('builds the pack catalog of each language: new pieces plus the reused corner and gear clips', () => {
    for (const language of LANGUAGES) {
      const catalog = taskCatalog(language);
      const keys = catalog.map((e) => e.text);
      expect(new Set(keys).size).toBe(keys.length);
      expect(catalog.length).toBe(TASK_PIECES.length + 20 * 3 + 8);
      // pt-BR spells corners for the voice, others carry the translation
      expect(catalog.find((e) => e.text === 'Antes da T7')?.say).toBe(
        language === 'pt-BR'
          ? 'Antes da tê sete'
          : language === 'en'
            ? 'Before turn seven'
            : 'Antes de la curva siete',
      );
    }
  });
});

describe('composeTask', () => {
  it('composes the example of the spec in the three languages', () => {
    const c = ok(
      composeTask({
        where: { corner: 7, phase: 'entry' },
        say: { action: 'brake', amount: 'm20', comparator: 'later' },
      }),
    );
    expect(c.text['pt-BR']).toBe('Foco. Na T7, entrada. Freie vinte metros mais tarde.');
    expect(c.text.en).toBe('Focus. At turn seven, entry. Brake twenty meters later.');
    expect(c.text.es).toBe('Foco. En la curva siete, entrada. Frena veinte metros más tarde.');
    expect(c.keys).toEqual(['Foco.', 'Na T7', 'entrada', 'Freie', 'vinte metros', 'mais tarde.']);
    expect(c.ids[0]).toBe('pre.focus');
    expect(c.keys.every((k, i) => k === taskPieceKey(c.ids[i]!))).toBe(true);
  });

  it('composes gear actions, closed phrases, between/before/after and the optional parts', () => {
    expect(
      ok(
        composeTask({
          where: { between: [3, 4] },
          say: { action: 'gearDown', gear: 3, focus: 'none' },
        }),
      ).text['pt-BR'],
    ).toBe('Da T3 à T4. Reduza para a terceira marcha.');
    expect(
      ok(
        composeTask({
          where: { after: 7 },
          say: { action: 'gearUp', gear: 4, purpose: 'exit', focus: 'reminder' },
        }),
      ).text.en,
    ).toBe('Reminder. After turn seven. Upshift to fourth gear, to exit better.');
    expect(
      ok(composeTask({ where: { global: 'slowCorners' }, say: { action: 'trailBrake' } })).text[
        'pt-BR'
      ],
    ).toBe('Foco. Nas curvas lentas. Solte o freio aos poucos enquanto vira.');
    expect(
      ok(
        composeTask({
          where: { sector: 2 },
          say: { action: 'enter', comparator: 'wider', focus: 'attention' },
        }),
      ).text.es,
    ).toBe('Atención. En el sector dos. Entra más abierto.');
  });

  it('refuses what the dictionary cannot say, and tells what is valid', () => {
    const bad = (req: TaskRequest) => {
      const r = composeTask(req);
      if (r.ok) throw new Error('expected a refusal');
      return r.error;
    };
    expect(bad({ where: { corner: 21 }, say: { action: 'trailBrake' } }).code).toBe('invalidWhere');
    expect(bad({ where: { corner: 7 }, say: { action: 'dance' } })).toMatchObject({
      code: 'invalidAction',
    });
    expect(bad({ where: { corner: 7 }, say: { action: 'dance' } }).valid).toContain('brake');
    // a stem needs a comparative that fits it
    expect(bad({ where: { corner: 7 }, say: { action: 'brake' } }).valid).toEqual(
      STEM_COMPARATORS.brake,
    );
    expect(bad({ where: { corner: 7 }, say: { action: 'enter', comparator: 'later' } }).code).toBe(
      'invalidCombination',
    );
    // metres only with earlier / later
    expect(
      bad({ where: { corner: 7 }, say: { action: 'brake', amount: 'm20', comparator: 'lighter' } })
        .code,
    ).toBe('invalidCombination');
    // gear
    expect(bad({ where: { corner: 7 }, say: { action: 'gearUp' } }).code).toBe(
      'invalidCombination',
    );
    expect(bad({ where: { corner: 7 }, say: { action: 'gearUp', gear: 9 } }).code).toBe(
      'invalidCombination',
    );
    // closed phrases take nothing else
    expect(
      bad({ where: { corner: 7 }, say: { action: 'trailBrake', amount: 'little' } }).code,
    ).toBe('invalidCombination');
    expect(
      bad({ where: { corner: 7 }, say: { action: 'brake', comparator: 'later', purpose: 'nope' } })
        .code,
    ).toBe('invalidCombination');
    expect(bad({ where: { between: [3, 3] }, say: { action: 'trailBrake' } }).code).toBe(
      'invalidWhere',
    );
    expect(bad({ where: { atM: 1000 }, say: { action: 'trailBrake' } }).code).toBe('needsTrack');
  });

  it('keeps every possible sentence inside the budget (the worst combination of each kind)', () => {
    const longestWhere = [
      { between: [13, 14] as [number, number] },
      { corner: 13, phase: 'entry' as const },
      { global: 'hardBraking' as const },
    ];
    const budgets: number[] = [];
    for (const where of longestWhere) {
      for (const stem of STEMS) {
        for (const comparator of STEM_COMPARATORS[stem]) {
          for (const amount of [undefined, ...AMOUNTS]) {
            for (const purpose of [undefined, ...PURPOSES]) {
              const r = composeTask({
                where,
                say: {
                  action: stem,
                  comparator,
                  ...(amount ? { amount } : {}),
                  ...(purpose ? { purpose } : {}),
                },
              });
              if (r.ok) budgets.push(r.composition.estimatedMs);
            }
          }
        }
      }
    }
    // some combinations are valid and some are refused as too long, none is both
    expect(budgets.length).toBeGreaterThan(200);
    expect(Math.max(...budgets)).toBeLessThanOrEqual(TASK_BUDGET.maxMs);
  });

  it('can say every action id, gear, comparative, amount, purpose, prefix and place at least once', () => {
    const where = { corner: 5 };
    for (const action of taskActionIds()) {
      const stems = STEMS as readonly string[];
      const gears = GEAR_ACTIONS as readonly string[];
      const say = stems.includes(action)
        ? { action, comparator: STEM_COMPARATORS[action as (typeof STEMS)[number]][0]! }
        : gears.includes(action)
          ? { action, gear: 5 }
          : { action };
      ok(composeTask({ where, say, ...{} } as TaskRequest));
    }
    for (const gear of [1, 2, 3, 4, 5, 6, 7, 8])
      ok(composeTask({ where, say: { action: 'gearDown', gear } }));
    for (const comparator of COMPARATORS) {
      const stem = STEMS.find((s) => STEM_COMPARATORS[s].includes(comparator))!;
      ok(composeTask({ where, say: { action: stem, comparator, focus: 'none' } }));
    }
    for (const amount of AMOUNTS)
      ok(
        composeTask({
          where,
          say: { action: 'brake', comparator: 'later', amount, focus: 'none' },
        }),
      );
    for (const purpose of PURPOSES)
      ok(composeTask({ where, say: { action: 'dose', purpose, focus: 'none' } }));
    for (const focus of FOCUSES) ok(composeTask({ where, say: { action: 'dose', focus } }));
    for (const phase of PHASES)
      ok(composeTask({ where: { corner: 1, phase }, say: { action: 'dose' } }));
    for (const straight of STRAIGHTS)
      ok(composeTask({ where: { straight }, say: { action: 'dose' } }));
    for (const global of GLOBALS) ok(composeTask({ where: { global }, say: { action: 'dose' } }));
    for (let n = 1; n <= 20; n++) {
      ok(composeTask({ where: { before: n }, say: { action: 'dose' } }));
      ok(composeTask({ where: { after: n }, say: { action: 'dose' } }));
      ok(composeTask({ where: { corner: n }, say: { action: 'dose' } }));
    }
    for (let sector = 1; sector <= 6; sector++)
      ok(composeTask({ where: { sector }, say: { action: 'dose' } }));
    expect(AMOUNT_METERS.length + 2).toBe(AMOUNTS.length);
  });

  it('gives a text for every piece id it uses, in all languages', () => {
    const c = ok(
      composeTask({
        where: { between: [19, 20] },
        say: { action: 'gearHold', gear: 8, focus: 'none' },
      }),
    );
    for (const id of c.ids)
      for (const l of LANGUAGES) expect(taskPieceText(id, l), `${id} ${l}`).toBeTruthy();
    for (const purpose of PURPOSES)
      for (const l of LANGUAGES) expect(taskPieceText(`why.${purpose}`, l), purpose).toBeTruthy();
    expect(taskPieceText('nope', 'en')).toBeNull();
    expect(taskPieceKey('nope')).toBeNull();
  });
});

describe('positions on the lap', () => {
  const corners = [
    { id: 'T1', entryM: 400, apexM: 480, exitM: 560, kind: 'slow' as const },
    { id: 'T2', entryM: 900, apexM: 960, exitM: 1020, kind: 'fast' as const },
    { id: 'T3', entryM: 2600, apexM: 2680, exitM: 2760, kind: 'hairpin' as const },
  ];
  const track = { corners, lengthM: 3000 };

  it('turns a distance into a corner phase or a stretch between corners', () => {
    expect(locatorForDistance(corners, 3000, 420)).toEqual({ corner: 1, phase: 'entry' });
    expect(locatorForDistance(corners, 3000, 490)).toEqual({ corner: 1, phase: 'apex' });
    expect(locatorForDistance(corners, 3000, 550)).toEqual({ corner: 1, phase: 'exit' });
    expect(locatorForDistance(corners, 3000, 700)).toEqual({ between: [1, 2] });
    // before T1 comes the end of the lap: between T3 and T1
    expect(locatorForDistance(corners, 3000, 100)).toEqual({ between: [3, 1] });
    expect(locatorForDistance(corners, 3000, 2950)).toEqual({ between: [3, 1] });
    expect(locatorForDistance([], 3000, 100)).toBeNull();
  });

  it('composes an atM request into the spoken place', () => {
    const c = ok(composeTask({ where: { atM: 1500 }, say: { action: 'gearUp', gear: 5 } }, track));
    expect(c.where).toEqual({ between: [2, 3] });
    expect(c.text['pt-BR']).toBe('Foco. Da T2 à T3. Suba para a quinta marcha.');
  });

  it('finds the lap distance where each kind of task must be finished', () => {
    expect(taskTriggers({ corner: 1, phase: 'entry' }, track)).toEqual([400]);
    expect(taskTriggers({ corner: 1, phase: 'apex' }, track)).toEqual([480]);
    expect(taskTriggers({ corner: 1, phase: 'exit' }, track)).toEqual([560]);
    expect(taskTriggers({ between: [2, 3] }, track)).toEqual([1020]);
    expect(taskTriggers({ before: 3 }, track)).toEqual([2480]);
    expect(taskTriggers({ after: 3 }, track)).toEqual([2790]);
    expect(taskTriggers({ sector: 2 }, { ...track, sectorStartsM: [0, 1000, 2000] })).toEqual([
      1000,
    ]);
    expect(taskTriggers({ sector: 4 }, { ...track, sectorStartsM: [0, 1000, 2000] })).toEqual([]);
    expect(taskTriggers({ sector: 3 }, track)).toEqual([2000]);
    expect(taskTriggers({ straight: 'start' }, track)).toEqual([2700]);
    expect(taskTriggers({ global: 'slowCorners' }, track)).toEqual([400, 2600]);
    expect(taskTriggers({ global: 'fastCorners' }, track)).toEqual([900]);
    expect(taskTriggers({ global: 'allCorners' }, track)).toEqual([400, 900, 2600]);
    expect(taskTriggers({ global: 'allStraights' }, track)).toEqual([560, 1020, 2760]);
    expect(taskTriggers({ corner: 9 }, track)).toEqual([]);
  });
});

describe('the dictionary for callers', () => {
  it('lists the vocabulary and examples that compose', () => {
    const view = taskDictionaryView();
    expect(view.version).toBe(1);
    expect(Object.keys(view.actions.stems)).toEqual([...STEMS]);
    expect(view.examples.length).toBeGreaterThanOrEqual(5);
    expect(view.examples.every((e) => e.text.length > 0)).toBe(true);
    const closed = Object.values(view.actions.closed).flat();
    expect(closed.length).toBeGreaterThan(40);
  });
});
