/**
 * Light invite (spec 03) for someone who already races here: no assistant, just a small card with
 * what is new. Answered once; never shown with the car moving.
 */

import { useSafeToPrompt } from '../../hooks/useSafeToPrompt.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { acceptInvite, loadSetupState, saveSetupState } from '../../lib/onboarding.ts';
import { openSetupAssistant, useSetupInvite } from '../../state/setup.ts';
import { requestTour } from '../../state/tour.ts';
import '../../styles/setup.css';

function answer(action: 'tour' | 'assistant' | 'later'): void {
  saveSetupState(acceptInvite(loadSetupState()));
  useSetupInvite.setState({ visible: false });
  if (action === 'tour') requestTour('live');
  else if (action === 'assistant') openSetupAssistant();
}

export default function SetupInvite() {
  const visible = useSetupInvite((s) => s.visible);
  const safe = useSafeToPrompt();
  if (!visible || !safe) return null;
  return (
    <section className="su-invite" data-no-gesture aria-labelledby="su-invite-title">
      <h2 id="su-invite-title">{uiText('Novidades no Bono')}</h2>
      <p>{uiText('Tour guiado pelo ao vivo e um engenheiro mais fácil de ligar e ajustar.')}</p>
      <div className="su-invite-actions">
        <button type="button" className="ui-btn" onClick={() => answer('tour')}>
          {uiText('Ver o tour')}
        </button>
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          onClick={() => answer('assistant')}
        >
          {uiText('Abrir o assistente')}
        </button>
        <button
          type="button"
          className="ui-btn"
          data-variant="ghost"
          onClick={() => answer('later')}
        >
          {uiText('Agora não')}
        </button>
      </div>
    </section>
  );
}
