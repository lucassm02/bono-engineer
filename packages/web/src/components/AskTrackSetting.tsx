/**
 * "Perguntar a pista ao começar" (spec 06): switch for the "Qual pista hoje?" card and the opening
 * chip. On by default, per device. Ready to be mounted in Configurações → Engenheiro.
 */

import { t as uiText } from '../lib/i18n.ts';
import { dispatchProfile } from '../state/actions.ts';
import { useUi } from '../state/uiStore.ts';
import { ToggleRow } from './ToggleRow.tsx';

export function AskTrackSetting() {
  const ask = useUi((s) => s.profile.askTrackOnStart);
  return (
    <ToggleRow
      title={uiText('Perguntar a pista ao começar')}
      description={uiText(
        'No menu do jogo, antes de entrar na pista, deixa você dizer onde vai treinar. Assim o engenheiro já ajuda na primeira volta. Nunca pergunta com o carro andando.',
      )}
      checked={ask}
      onChange={(enabled) => dispatchProfile({ type: 'setAskTrack', enabled })}
    />
  );
}
