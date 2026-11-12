/**
 * First-run assistant (spec 03), six screens in the shared Modal:
 *  1. Boas-vindas (idioma e voz com "Ouvir"), 2. Conectar o PS5, 3. Como você quer treinar?,
 *  4. Engenheiro, 5. Seu painel, 6. Pronto (resumo, "Ver o tour" / "Ir para o ao vivo").
 * Every step writes with the same actions as Configurações. Each step can be skipped; "Fazer isso
 * depois" (or Esc) closes without losing what was done; the progress lives in `gt7.setup.v2` and
 * feeds the "Falta configurar" card. Pure rules (what to show, where to resume) are in
 * `lib/onboarding.ts`; the screens are in `components/setup/`.
 */

import { PRODUCT_NAME } from '@gt7/shared';
import { useEffect, useRef, useState } from 'react';
import { DiscordWizard } from '../analysis/components/DiscordWizard.tsx';
import { isLinkFound } from '../lib/consoleLink.ts';
import { t as uiText } from '../lib/i18n.ts';
import {
  allStepsDone,
  closeSetup,
  emptySetupState,
  FOUND_PAUSE_MS,
  loadSetupState,
  markLegacyDone,
  markStep,
  nextScreen,
  prevScreen,
  resumeScreen,
  SETUP_SCREENS,
  type SetupScreen,
  type SetupState,
  type StepOutcome,
  saveSetupState,
  screenIndex,
  withCurrent,
} from '../lib/onboarding.ts';
import { navigate, routes } from '../lib/route.ts';
import { bumpUsage } from '../lib/usage.ts';
import { useConsoleConnection } from '../state/consoleLink.ts';
import { useEngineer } from '../state/engineer.ts';
import { requestTour } from '../state/tour.ts';
import { useUi } from '../state/uiStore.ts';
import { ConsoleStep } from './setup/ConsoleStep.tsx';
import { type SetupDraft, type StepControl, StepCtx } from './setup/ctx.ts';
import { EngineerStep } from './setup/EngineerStep.tsx';
import { ModeStep } from './setup/ModeStep.tsx';
import { PanelStep } from './setup/PanelStep.tsx';
import { ReadyStep } from './setup/ReadyStep.tsx';
import { useDiscordSetup } from './setup/useDiscordSetup.ts';
import { WelcomeStep } from './setup/WelcomeStep.tsx';
import { Icon } from './ui/Icon.tsx';
import { Modal } from './ui/Modal.tsx';
import '../styles/setup.css';

const TITLES: Record<SetupScreen, () => string> = {
  welcome: () => uiText('Bem-vindo ao {0}', PRODUCT_NAME),
  console: () => uiText('Conecte o PS5'),
  mode: () => uiText('Como você quer treinar?'),
  engineer: () => uiText('Seu engenheiro'),
  panel: () => uiText('Suas telas ao vivo'),
  ready: () => uiText('Tudo pronto!'),
};

interface Progress {
  state: SetupState;
  screen: SetupScreen;
}

/**
 * Where to open and with which state. Pure on purpose (React may call it twice): reopening forgets
 * "closed" but keeps the steps; the effect in the component saves it.
 */
function initialProgress(): Progress {
  const saved = loadSetupState();
  const screen = resumeScreen(saved);
  const base = saved ?? emptySetupState();
  const state = withCurrent({ ...base, closed: undefined, done: allStepsDone(base.steps) }, screen);
  return { state, screen };
}

export default function Onboarding() {
  const [progress, setProgress] = useState<Progress>(initialProgress);
  const [control, setControl] = useState<StepControl>({ canContinue: true });
  const draft = useRef<SetupDraft>({});
  // reopened: what was saved as closed is open again, so a close of the app now resumes here
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, with the state of the first render
  useEffect(() => {
    saveSetupState(progress.state);
    bumpUsage('setupOpens');
  }, []);
  const autoMoved = useRef(false);
  const discord = useDiscordSetup();
  const conn = useConsoleConnection();
  const found = isLinkFound(conn?.state ?? null);
  const { state, screen } = progress;
  const idx = screenIndex(screen);
  const total = SETUP_SCREENS.length;
  const isReady = screen === 'ready';

  const commit = (next: SetupState, to: SetupScreen) => {
    const saved = withCurrent(next, to);
    saveSetupState(saved);
    setControl({ canContinue: true });
    setProgress({ state: saved, screen: to });
  };

  const advance = (outcome: StepOutcome, patch?: Partial<SetupState>) => {
    if (isReady) return;
    if (outcome === 'done') control.commit?.();
    const to = nextScreen(screen);
    let next = { ...markStep(state, screen, outcome), ...patch };
    // reaching the summary counts as finished: it never reopens by itself
    if (to === 'ready') next = closeSetup(next, 'finished');
    commit(next, to);
  };

  const back = () => commit(state, prevScreen(screen));

  /** Closes the assistant, keeping everything that was done. */
  const close = (how: 'finished' | 'later') => {
    const keep = state.closed === 'finished' ? 'finished' : how;
    saveSetupState(closeSetup(state, keep));
    markLegacyDone();
    useUi.setState({ onboarding: 'off' });
  };

  // The console shows up: a moment on "PS5 encontrado", then the next step by itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the arrival of the console matters
  useEffect(() => {
    if (screen !== 'console' || !found || autoMoved.current) return;
    const timer = setTimeout(() => {
      autoMoved.current = true;
      advance('done');
    }, FOUND_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [screen, found]);

  // Each screen starts with the focus on its title, so a screen reader reads it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refocus when the screen changes
  useEffect(() => {
    const title = document.querySelector<HTMLElement>('.ob-modal .ui-modal-title');
    title?.setAttribute('tabindex', '-1');
    title?.focus({ preventScroll: true });
  }, [screen]);

  return (
    <>
      <Modal
        open={!discord.wizardOpen}
        onClose={() => close('later')}
        className="bn-modal-text ob-modal"
        title={TITLES[screen]()}
        subtitle={uiText('Passo {0} de {1}', idx + 1, total)}
        hideClose
        dismissOnBackdrop={false}
        headerExtra={
          <ol className="ob-steps" aria-hidden="true">
            {SETUP_SCREENS.map((s, i) => (
              <li key={s} data-state={i < idx ? 'done' : i === idx ? 'current' : 'todo'} />
            ))}
          </ol>
        }
        footer={
          <>
            {!isReady && (
              <button
                type="button"
                className="ui-btn bn-foot-left"
                data-variant="ghost"
                data-size="sm"
                onClick={() => close('later')}
              >
                {uiText('Fazer isso depois')}
              </button>
            )}
            {idx > 0 && (
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                data-size="sm"
                onClick={back}
              >
                <Icon name="back" size={18} />
                {uiText('Voltar')}
              </button>
            )}
            {!isReady && (
              <button
                type="button"
                className="ui-btn"
                data-variant="ghost"
                data-size="sm"
                onClick={() => advance('skipped')}
              >
                {uiText('Pular passo')}
              </button>
            )}
            {!isReady && (
              <button
                type="button"
                className="ui-btn su-primary"
                disabled={!control.canContinue}
                onClick={() => advance('done')}
              >
                {uiText('Continuar')}
                <Icon name="chevron-right" size={18} />
              </button>
            )}
            {isReady && (
              <>
                <button
                  type="button"
                  className="ui-btn"
                  data-variant="secondary"
                  onClick={() => {
                    close('finished');
                    requestTour('live');
                  }}
                >
                  {uiText('Ver o tour')}
                </button>
                <button
                  type="button"
                  className="ui-btn su-primary"
                  onClick={() => {
                    close('finished');
                    navigate(routes.live());
                  }}
                >
                  {uiText('Ir para o ao vivo')}
                </button>
              </>
            )}
          </>
        }
      >
        <StepCtx.Provider value={setControl}>
          <div className="su-body" key={screen} data-screen={screen}>
            {screen === 'welcome' && <WelcomeStep />}
            {screen === 'console' && (
              <ConsoleStep onDemo={() => advance('skipped', { demo: true })} />
            )}
            {screen === 'mode' && <ModeStep alreadyDone={state.steps.mode === 'done'} />}
            {screen === 'engineer' && (
              <EngineerStep
                draft={draft.current}
                defaultOn={state.steps.mode === 'done' ? useEngineer.getState().enabled : true}
                discord={discord}
              />
            )}
            {screen === 'panel' && <PanelStep />}
            {screen === 'ready' && <ReadyStep state={state} />}
          </div>
        </StepCtx.Provider>
      </Modal>
      {discord.bridge && discord.info && (
        <DiscordWizard
          bridge={discord.bridge}
          open={discord.wizardOpen}
          startAt={1}
          settings={discord.info.settings}
          status={discord.info.status}
          onClose={discord.closeWizard}
          onSaved={discord.saved}
        />
      )}
    </>
  );
}
