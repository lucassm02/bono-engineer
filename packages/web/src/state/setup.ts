/**
 * Small pieces of the first-run assistant (spec 03) that the rest of the app talks to: the light
 * invite for people who already race here and the way to (re)open the assistant. The assistant
 * itself is lazy (`components/Onboarding.tsx`).
 */

import { create } from 'zustand';
import {
  loadSetupState,
  ONBOARDING_KEY,
  resetSetupState,
  saveSetupState,
} from '../lib/onboarding.ts';
import { saveString } from '../lib/storage.ts';
import { useUi } from './uiStore.ts';

export const useSetupInvite = create<{ visible: boolean }>()(() => ({ visible: false }));

/** Reopens the assistant from the start: forgets the steps done and opens the first screen. */
export function restartSetupAssistant(): void {
  saveString(ONBOARDING_KEY, '0');
  saveSetupState(resetSetupState(loadSetupState()));
  openSetupAssistant();
}

/** Opens the assistant where it stopped ("Continuar o assistente", "Refazer o assistente"). */
export function openSetupAssistant(): void {
  useSetupInvite.setState({ visible: false });
  useUi.setState({ onboarding: 'active' });
}
