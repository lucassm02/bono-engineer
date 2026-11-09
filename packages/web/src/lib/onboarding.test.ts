import { describe, expect, it } from 'vitest';
import {
  decideOnboarding,
  type GateInput,
  HELP_AFTER_MS,
  needsHelp,
  nextStep,
} from './onboarding.ts';

const fresh: GateInput = {
  done: false,
  forced: false,
  source: 'server',
  wsOpen: true,
  linkState: 'searching',
  simulator: false,
  sessionCount: 0,
  timedOut: false,
};

describe('decideOnboarding', () => {
  it('shows for a first-time user whose console is still being searched', () => {
    expect(decideOnboarding(fresh)).toBe('show');
  });

  it('never shows once finished or skipped, unless forced', () => {
    expect(decideOnboarding({ ...fresh, done: true })).toBe('skip');
    expect(decideOnboarding({ ...fresh, done: true, forced: true })).toBe('show');
  });

  it('skips when there is history', () => {
    expect(decideOnboarding({ ...fresh, sessionCount: 3 })).toBe('skip');
  });

  it('skips when the console was already found / is receiving / was lost', () => {
    for (const linkState of ['found', 'receiving', 'lost'] as const) {
      expect(decideOnboarding({ ...fresh, linkState })).toBe('skip');
    }
  });

  it('skips with the UDP port busy (nothing the assistant can do)', () => {
    expect(decideOnboarding({ ...fresh, linkState: 'idle' })).toBe('skip');
  });

  it('skips in the browser demo and with the simulated console', () => {
    expect(decideOnboarding({ ...fresh, source: 'mock' })).toBe('skip');
    expect(decideOnboarding({ ...fresh, simulator: true })).toBe('skip');
  });

  it('waits for the server status and the history, then gives up', () => {
    expect(decideOnboarding({ ...fresh, wsOpen: false })).toBe('wait');
    expect(decideOnboarding({ ...fresh, linkState: null })).toBe('wait');
    expect(decideOnboarding({ ...fresh, sessionCount: null })).toBe('wait');
    expect(decideOnboarding({ ...fresh, linkState: null, timedOut: true })).toBe('skip');
    expect(decideOnboarding({ ...fresh, sessionCount: null, timedOut: true })).toBe('skip');
  });
});

describe('wizard steps', () => {
  it('moves to "found" by itself and only from "search"', () => {
    expect(nextStep('search', 'searching')).toBe('search');
    expect(nextStep('search', null)).toBe('search');
    expect(nextStep('search', 'found')).toBe('found');
    expect(nextStep('search', 'receiving')).toBe('found');
    expect(nextStep('found', 'lost')).toBe('found');
    expect(nextStep('ready', 'receiving')).toBe('ready');
    // dropping back to searching does not undo the confirmation
    expect(nextStep('found', 'searching')).toBe('found');
  });

  it('offers the help checklist only after ~40 s of searching', () => {
    expect(HELP_AFTER_MS).toBe(40_000);
    expect(needsHelp('search', HELP_AFTER_MS - 1, 'searching')).toBe(false);
    expect(needsHelp('search', HELP_AFTER_MS, 'searching')).toBe(true);
    expect(needsHelp('search', 90_000, null)).toBe(true);
    expect(needsHelp('search', 90_000, 'found')).toBe(false);
    expect(needsHelp('found', 90_000, 'searching')).toBe(false);
  });
});
