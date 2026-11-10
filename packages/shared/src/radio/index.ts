/**
 * Radio engineer decision engine (spec do engenheiro de rádio): rules, scheduler and settings.
 * Isomorphic and deterministic: the web adapter plays the audio, replays and tests drive it
 * with recorded frames. The phrase catalog is exported separately as `@gt7/shared/radio-phrases`.
 */

export * from './coaching.ts';
export * from './context.ts';
export * from './cues.ts';
export * from './engine.ts';
export * from './fuel.ts';
export * from './registry.ts';
export * from './rules.ts';
export * from './settings.ts';
export * from './types.ts';
export * from './tyres.ts';
