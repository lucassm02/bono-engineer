/**
 * @gt7/shared — typed contracts shared by every package (isomorphic: no Node or DOM APIs).
 *
 * File ownership for parallel work: telemetry.ts (protocol), live.ts (core), domain.ts (core),
 * analysis.ts (analysis), ws.ts / api.ts / coach.ts (server), ui.ts (web).
 */

export * from './analysis.ts';
export * from './api.ts';
export * from './coach.ts';
export * from './domain.ts';
export * from './live.ts';
export * from './telemetry.ts';
export * from './ui.ts';
export * from './ws.ts';
