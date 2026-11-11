/**
 * Small pieces of the first-run assistant (spec 03) that the rest of the app talks to: the light
 * invite for people who already race here and the way to (re)open the assistant. The assistant
 * itself is lazy (`components/Onboarding.tsx`).
 */

import { create } from 'zustand';
import { useUi } from './uiStore.ts';

export const useSetupInvite = create<{ visible: boolean }>()(() => ({ visible: false }));

/** Opens the assistant where it stopped ("Continuar o assistente", "Refazer o assistente"). */
export function openSetupAssistant(): void {
  useSetupInvite.setState({ visible: false });
  useUi.setState({ onboarding: 'active' });
}
