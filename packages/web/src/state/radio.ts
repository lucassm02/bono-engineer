/**
 * Web adapter state of the radio decision engine (@gt7/shared radio). The engine decides; the
 * HUD (LiveEngineer) feeds it frames and plays what it returns through engineer.ts.
 */

import {
  type RadioDecision,
  RadioEngine,
  type RadioEngineConfig,
  radioEngineConfig,
} from '@gt7/shared';
import { TYRE_TEMP_SCALE } from '../config.ts';
import { engineerUtteranceMs, useEngineer } from './engineer.ts';

/** Engine config from the saved controls; the tyre range is the panel scale (config.ts). */
export function currentRadioConfig(): RadioEngineConfig {
  const { controls, muted } = useEngineer.getState();
  return radioEngineConfig(controls, {
    muted,
    anticipationMs: controls.anticipationMs,
    tyreScale: TYRE_TEMP_SCALE,
    tyreScaleValidated: true,
  });
}

export const radioEngine = new RadioEngine({
  utteranceMs: engineerUtteranceMs,
  config: currentRadioConfig(),
});

useEngineer.subscribe((state, previous) => {
  if (state.controls !== previous.controls || state.muted !== previous.muted)
    radioEngine.configure(currentRadioConfig());
});

/** Latest radio decisions (rule, instant, evidence, phrase, discard reason), oldest first. */
export function radioDecisions(): readonly RadioDecision[] {
  return radioEngine.log;
}
