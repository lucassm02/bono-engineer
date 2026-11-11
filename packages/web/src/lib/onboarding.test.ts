import { describe, expect, it } from 'vitest';
import { pendingSetupSteps } from '../analysis/lib/configNav.ts';
import { migrateEngineerEnabled } from '../state/engineer.ts';
import {
  acceptInvite,
  closeSetup,
  decideSetup,
  defaultPanelPreset,
  detectLanguage,
  emptySetupState,
  type GateInput,
  HELP_AFTER_MS,
  markStep,
  needsHelp,
  nextScreen,
  parseSetupState,
  prevScreen,
  resetSetupState,
  resumeScreen,
  SETUP_VERSION,
  trainChoiceFrom,
  trainChoicePlan,
  withCurrent,
} from './onboarding.ts';

const fresh: GateInput = {
  state: null,
  legacyDone: false,
  forced: false,
  source: 'server',
  wsOpen: true,
  linkState: 'searching',
  simulator: false,
  sessionCount: 0,
  timedOut: false,
  safe: true,
};

describe('decideSetup', () => {
  it('shows the whole assistant to someone who never raced or configured here', () => {
    expect(decideSetup(fresh)).toBe('wizard');
    // the console may already be found: the connect step just confirms it
    for (const linkState of ['found', 'receiving', 'lost', 'idle'] as const) {
      expect(decideSetup({ ...fresh, linkState })).toBe('wizard');
    }
  });

  it('only invites someone with history or who used the old assistant', () => {
    expect(decideSetup({ ...fresh, sessionCount: 4 })).toBe('invite');
    expect(decideSetup({ ...fresh, legacyDone: true })).toBe('invite');
  });

  it('invites once: after the invite is answered it stays quiet', () => {
    const answered = acceptInvite(null);
    expect(decideSetup({ ...fresh, sessionCount: 4, state: answered })).toBe('none');
  });

  it('invites someone who finished an older version of the assistant', () => {
    const old = { ...closeSetup(emptySetupState(), 'finished'), version: 1, invited: false };
    expect(decideSetup({ ...fresh, state: old })).toBe('invite');
  });

  it('resumes a half-way assistant, and stays away once closed on the current version', () => {
    const half = withCurrent(markStep(emptySetupState(), 'welcome', 'done'), 'console');
    expect(decideSetup({ ...fresh, state: half, sessionCount: 9 })).toBe('wizard');
    expect(decideSetup({ ...fresh, state: closeSetup(half, 'later') })).toBe('none');
    expect(decideSetup({ ...fresh, state: closeSetup(half, 'finished') })).toBe('none');
  });

  it('never shows in the demos, unless forced', () => {
    expect(decideSetup({ ...fresh, source: 'mock' })).toBe('none');
    expect(decideSetup({ ...fresh, simulator: true })).toBe('none');
    expect(decideSetup({ ...fresh, source: 'mock', forced: true })).toBe('wizard');
  });

  it('waits for the car to stop, never opens while it moves', () => {
    expect(decideSetup({ ...fresh, safe: false })).toBe('wait');
    expect(decideSetup({ ...fresh, safe: false, sessionCount: 3 })).toBe('wait');
    expect(decideSetup({ ...fresh, safe: false, state: acceptInvite(null) })).toBe('none');
  });

  it('waits for the server status and the history, then gives up', () => {
    expect(decideSetup({ ...fresh, wsOpen: false })).toBe('wait');
    expect(decideSetup({ ...fresh, linkState: null })).toBe('wait');
    expect(decideSetup({ ...fresh, sessionCount: null })).toBe('wait');
    expect(decideSetup({ ...fresh, linkState: null, timedOut: true })).toBe('none');
    expect(decideSetup({ ...fresh, sessionCount: null, timedOut: true })).toBe('none');
  });
});

describe('saved state per step', () => {
  it('starts empty and marks each step', () => {
    let s = emptySetupState();
    expect(s).toEqual({ version: SETUP_VERSION, steps: {}, done: false });
    s = markStep(s, 'welcome', 'done');
    s = markStep(s, 'console', 'skipped');
    expect(s.steps).toEqual({ welcome: 'done', console: 'skipped' });
    expect(s.done).toBe(false);
  });

  it('is done only when every step is done', () => {
    let s = emptySetupState();
    for (const id of ['welcome', 'console', 'mode', 'engineer', 'panel'] as const) {
      expect(s.done).toBe(false);
      s = markStep(s, id, 'done');
    }
    expect(s.done).toBe(true);
    expect(markStep(s, 'panel', 'skipped').done).toBe(false);
  });

  it('round-trips through the saved text and feeds the "Falta configurar" card', () => {
    const s = markStep(markStep(emptySetupState(), 'welcome', 'done'), 'console', 'skipped');
    const back = parseSetupState(JSON.stringify(s));
    expect(back).toEqual(s);
    const pending = pendingSetupSteps(JSON.stringify(s))?.map((p) => p.id);
    expect(pending).toEqual(['console', 'mode', 'engineer', 'panel']);
  });

  it('skipping everything leaves every step pending, none hidden', () => {
    let s = emptySetupState();
    for (const id of ['welcome', 'console', 'mode', 'engineer', 'panel'] as const) {
      s = markStep(s, id, 'skipped');
    }
    s = closeSetup(s, 'finished');
    expect(pendingSetupSteps(JSON.stringify(s))).toHaveLength(5);
  });

  it('reads garbage and old shapes safely', () => {
    expect(parseSetupState(null)).toBeNull();
    expect(parseSetupState('{nope')).toBeNull();
    expect(parseSetupState('7')).toBeNull();
    const old = parseSetupState(
      '{"steps":{"welcome":true,"mode":"x"},"done":false,"current":"zzz"}',
    );
    expect(old).toEqual({ version: 1, steps: { welcome: 'done' }, done: false });
  });

  it('dismissing the invite leaves nothing pending', () => {
    expect(pendingSetupSteps(JSON.stringify(acceptInvite(null)))).toEqual([]);
  });

  it('resumes where it stopped, or at the start', () => {
    expect(resumeScreen(null)).toBe('welcome');
    expect(resumeScreen(emptySetupState())).toBe('welcome');
    const half = withCurrent(
      markStep(markStep(emptySetupState(), 'welcome', 'done'), 'console', 'done'),
      'engineer',
    );
    expect(resumeScreen(half)).toBe('engineer');
    expect(resumeScreen(closeSetup(half, 'finished'))).toBe('welcome');
  });

  it('"Refazer o assistente" forgets the steps', () => {
    const s = withCurrent(markStep(emptySetupState(), 'welcome', 'done'), 'mode');
    const again = resetSetupState(closeSetup(s, 'finished'));
    expect(again.steps).toEqual({});
    expect(again.closed).toBeUndefined();
    expect(again.current).toBeUndefined();
    expect(resumeScreen(again)).toBe('welcome');
  });

  it('moves through the six screens', () => {
    expect(nextScreen('welcome')).toBe('console');
    expect(nextScreen('panel')).toBe('ready');
    expect(nextScreen('ready')).toBe('ready');
    expect(prevScreen('welcome')).toBe('welcome');
    expect(prevScreen('ready')).toBe('panel');
  });
});

describe('legacy and persisted engineer', () => {
  it('nothing saved or anything but true = off', () => {
    expect(migrateEngineerEnabled(null)).toBe(false);
    expect(migrateEngineerEnabled('true')).toBe(false);
    expect(migrateEngineerEnabled(1)).toBe(false);
    expect(migrateEngineerEnabled(true)).toBe(true);
  });
});

describe('help checklist', () => {
  it('is offered only after ~40 s of searching', () => {
    expect(HELP_AFTER_MS).toBe(40_000);
    expect(needsHelp(HELP_AFTER_MS - 1, 'searching')).toBe(false);
    expect(needsHelp(HELP_AFTER_MS, 'searching')).toBe(true);
    expect(needsHelp(90_000, null)).toBe(true);
    expect(needsHelp(90_000, 'found')).toBe(false);
    expect(needsHelp(90_000, 'searching', 'mode')).toBe(false);
  });
});

describe('step helpers', () => {
  it('picks the language from the browser', () => {
    expect(detectLanguage(['pt-PT', 'en-US'])).toBe('pt-BR');
    expect(detectLanguage(['de-DE', 'en-GB'])).toBe('en');
    expect(detectLanguage(['es-AR'])).toBe('es');
    expect(detectLanguage(['ja-JP'])).toBeNull();
  });

  it('maps the three training cards to the engineer controls', () => {
    expect(trainChoicePlan('learn')).toEqual({
      enabled: true,
      mode: 'training',
      trainingProfile: 'learnTrack',
    });
    expect(trainChoicePlan('time').trainingProfile).toBe('gainTime');
    expect(trainChoicePlan('view').enabled).toBe(false);
    expect(trainChoiceFrom(false, { mode: 'race', trainingProfile: 'learnTrack' })).toBe('view');
    expect(trainChoiceFrom(true, { mode: 'training', trainingProfile: 'gainTime' })).toBe('time');
    expect(trainChoiceFrom(true, { mode: 'race', trainingProfile: 'gainTime' })).toBeNull();
  });

  it('defaults the panel to Simples on touch devices and Completo on a PC', () => {
    expect(defaultPanelPreset({ coarsePointer: true, width: 1200 })).toBe('simple');
    expect(defaultPanelPreset({ coarsePointer: false, width: 390 })).toBe('simple');
    expect(defaultPanelPreset({ coarsePointer: false, width: 1280 })).toBe('full');
  });
});
