/**
 * Small one-time hint (spec 04): a card with one sentence that disappears by itself. It never asks
 * anything and never blocks the screen under it.
 */

import { useEffect } from 'react';
import { t as uiText } from '../../lib/i18n.ts';
import type { HintId } from '../../lib/tour.ts';
import { dismissHint, useHint } from '../../state/tourHints.ts';
import { Icon } from './Icon.tsx';
import '../../styles/tour.css';

const HINT_MS = 9000;

function hintText(id: HintId): { title: string; body: string } {
  switch (id) {
    case 'engineerSpoke':
      return {
        title: uiText('O engenheiro falou pela primeira vez'),
        body: uiText('Quer que ele fale menos? Menu → Engenheiro.'),
      };
    case 'lapWithoutReference':
      return {
        title: uiText('Esta volta ainda não tem referência'),
        body: uiText('Dê mais uma volta ou grave a volta de um replay para comparar.'),
      };
    case 'sessionSaved':
      return {
        title: uiText('Sua primeira sessão foi salva'),
        body: uiText('Ela já está no Início, na pista certa.'),
      };
  }
}

export default function TourHint() {
  const hint = useHint((s) => s.hint);
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(dismissHint, HINT_MS);
    return () => clearTimeout(timer);
  }, [hint]);
  if (!hint) return null;
  const text = hintText(hint);
  return (
    <section className="tour-hint" data-no-gesture role="status" aria-live="polite">
      <div className="tour-hint-text">
        <strong>{text.title}</strong>
        <span>{text.body}</span>
      </div>
      <button
        type="button"
        className="ui-icon-btn"
        aria-label={uiText('Fechar a dica')}
        onClick={dismissHint}
      >
        <Icon name="close" size={16} />
      </button>
    </section>
  );
}
