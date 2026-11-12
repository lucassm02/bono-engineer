/**
 * Step 6 · Pronto. A summary of what was set up ("PS5 192.168.3.26 · Voz 1 · Aprender pista") with
 * what was left for later marked, so nothing looks done that is not. The buttons are the shell's.
 */

import { matchScreenPreset, SCREEN_PRESETS } from '../../analysis/lib/configNav.ts';
import { isLinkFound } from '../../lib/consoleLink.ts';
import { LANGUAGE_NAMES, t as uiText, useLanguage } from '../../lib/i18n.ts';
import { type SetupState, type TrainChoice, trainChoiceFrom } from '../../lib/onboarding.ts';
import { voiceLabelOf } from '../../lib/radioVoices.ts';
import { useConsoleConnection } from '../../state/consoleLink.ts';
import { useEngineer } from '../../state/engineer.ts';
import { useUi } from '../../state/uiStore.ts';
import { Icon } from '../ui/Icon.tsx';

const TRAIN_LABEL: Record<TrainChoice, () => string> = {
  learn: () => uiText('Aprender pista'),
  time: () => uiText('Ganhar tempo'),
  view: () => uiText('Só acompanhar ao vivo'),
};

interface Row {
  id: string;
  label: string;
  value: string;
  done: boolean;
}

export function ReadyStep({ state }: { state: SetupState }) {
  const language = useLanguage();
  const conn = useConsoleConnection();
  const enabled = useEngineer((s) => s.enabled);
  const controls = useEngineer((s) => s.controls);
  const voiceUri = useEngineer((s) => s.voiceUri);
  const views = useUi((s) => s.profile.views);
  const steps = state.steps;

  const choice = trainChoiceFrom(enabled, controls);
  const preset = matchScreenPreset(views);
  const rows: Row[] = [
    {
      id: 'welcome',
      label: uiText('Idioma e voz'),
      value: `${LANGUAGE_NAMES[language]} · ${voiceLabelOf(voiceUri) ?? ''}`,
      done: steps.welcome === 'done',
    },
    {
      id: 'console',
      label: uiText('PS5'),
      value: conn?.consoleIp
        ? conn.consoleIp
        : state.demo
          ? uiText('Demonstração, sem PS5')
          : uiText('Ainda não conectado'),
      done: steps.console === 'done' || isLinkFound(conn?.state ?? null),
    },
    {
      id: 'mode',
      label: uiText('Treino'),
      value: choice ? TRAIN_LABEL[choice]() : uiText('Personalizado'),
      done: steps.mode === 'done',
    },
    {
      id: 'engineer',
      label: uiText('Engenheiro'),
      value: enabled ? uiText('Ligado') : uiText('Desligado'),
      done: steps.engineer === 'done',
    },
    {
      id: 'panel',
      label: uiText('Telas'),
      value: preset
        ? (SCREEN_PRESETS.find((p) => p.id === preset)?.label ?? '')
        : uiText('Personalizado · {0} telas', views.length),
      done: steps.panel === 'done',
    },
  ];
  const later = rows.filter((r) => !r.done).length;

  return (
    <div className="su-step su-ready">
      <div className="su-seal" aria-hidden="true">
        <Icon name="check" size={34} className="ob-check" />
      </div>
      <p className="su-lead">
        {later === 0
          ? uiText('Está tudo no lugar. Falta só a primeira volta.')
          : uiText(
              'Pronto para pilotar. O que ficou para depois aparece na Início e em Configurações.',
            )}
      </p>
      <ul className="su-summary" aria-label={uiText('Resumo da configuração')}>
        {rows.map((r) => (
          <li key={r.id} data-done={r.done ? '1' : '0'}>
            <Icon
              name={r.done ? 'check' : 'minus'}
              size={16}
              className={r.done ? 'su-summary-icon' : 'su-summary-icon su-summary-later'}
            />
            <span className="su-summary-label">{r.label}</span>
            <span className="su-summary-value">{r.value}</span>
            {!r.done && <span className="ui-badge">{uiText('Depois')}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
