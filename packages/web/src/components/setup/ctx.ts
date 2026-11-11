/**
 * Link between a step of the assistant and its footer: the step says whether "Continuar" is
 * available and what saving it does; the shell owns the buttons (and the saved progress).
 */

import { createContext, useContext, useEffect, useRef } from 'react';

export interface StepControl {
  canContinue: boolean;
  /** Writes what the step collected, with the same actions the settings screens use. */
  commit?: () => void;
}

export const StepCtx = createContext<(control: StepControl) => void>(() => {});

export function useStepControl(control: StepControl): void {
  const set = useContext(StepCtx);
  const ref = useRef(control);
  ref.current = control;
  const { canContinue } = control;
  useEffect(() => {
    set({ canContinue, commit: () => ref.current.commit?.() });
  }, [canContinue, set]);
}

/** Values the steps keep while the assistant hides itself (e.g. for the Discord assistant). */
export interface SetupDraft {
  engineerOn?: boolean;
}
