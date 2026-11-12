/**
 * Step 3 · Como você quer treinar? Three cards. They write the engineer controls the settings
 * use (`setRadioControls`, `setEngineerEnabled`), nothing of their own.
 */

import { useState } from 'react';
import { t as uiText } from '../../lib/i18n.ts';
import {
  TRAIN_CHOICES,
  type TrainChoice,
  trainChoiceFrom,
  trainChoicePlan,
} from '../../lib/onboarding.ts';
import { setEngineerEnabled, setRadioControls, useEngineer } from '../../state/engineer.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { useStepControl } from './ctx.ts';

const CARDS: Record<TrainChoice, { icon: IconName; title: () => string; text: () => string }> = {
  learn: {
    icon: 'guide',
    title: () => uiText('Aprender uma pista'),
    text: () => uiText('O engenheiro guia você curva a curva.'),
  },
  time: {
    icon: 'compare',
    title: () => uiText('Ganhar tempo'),
    text: () => uiText('Você já conhece a pista. Ele aponta onde ganhar décimos.'),
  },
  view: {
    icon: 'live',
    title: () => uiText('Só acompanhar ao vivo'),
    text: () => uiText('Engenheiro desligado. Só os números na tela.'),
  },
};

export function ModeStep({ alreadyDone }: { alreadyDone: boolean }) {
  const initial = (): TrainChoice => {
    if (!alreadyDone) return 'learn';
    const { enabled, controls } = useEngineer.getState();
    return trainChoiceFrom(enabled, controls) ?? 'learn';
  };
  const [choice, setChoice] = useState<TrainChoice>(initial);

  useStepControl({
    canContinue: true,
    commit: () => {
      const plan = trainChoicePlan(choice);
      setRadioControls({ mode: plan.mode, trainingProfile: plan.trainingProfile });
      setEngineerEnabled(plan.enabled, false);
    },
  });

  return (
    <div className="su-step">
      <p className="su-lead">{uiText('O engenheiro se ajusta ao que você quer fazer agora.')}</p>
      <div className="su-cards" role="radiogroup" aria-label={uiText('Como você quer treinar?')}>
        {TRAIN_CHOICES.map((id) => {
          const card = CARDS[id];
          return (
            <label key={id} className="su-card" data-checked={choice === id ? '1' : '0'}>
              <input
                type="radio"
                name="su-train"
                className="su-radio"
                checked={choice === id}
                onChange={() => setChoice(id)}
              />
              <Icon name={card.icon} size={26} />
              <span className="su-card-text">
                <strong>{card.title()}</strong>
                <span>{card.text()}</span>
              </span>
              <span className="su-tick" aria-hidden="true">
                <Icon name="check" size={16} />
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
