/**
 * Corner calls of the live engineer. The timing logic lives in @gt7/shared (radio/cues.ts) so the
 * radio decision engine and replays use it; this module keeps the web import path.
 */

import { LIVE_CALL_PHRASES, RADIO_HELLO } from './radioPhrases.ts';

export {
  type EngineerCall,
  engineerCall,
  engineerDisplay,
  isBrakeCue as isBrake,
} from '@gt7/shared';

export const ENGINEER_PREVIEW = RADIO_HELLO;
/** Every phrase the live engineer can call (all recorded in every radio pack). */
export const ENGINEER_PHRASES = LIVE_CALL_PHRASES;
