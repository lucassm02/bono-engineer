/**
 * Step 4 · Engenheiro. Turn it on, volume with a test sound, and where it speaks: this device, or
 * the Discord (desktop app only, optional: "Configurar depois"). The switch is written on
 * "Continuar"; volume and the test sound act at once, as in Configurações → Engenheiro.
 */

import { DISCORD_RADIO_DEVICE_ID } from '@gt7/shared';
import { useId, useState } from 'react';
import { t as uiText } from '../../lib/i18n.ts';
import {
  setEngineerEnabled,
  setRadioControls,
  testEngineerVoice,
  useEngineer,
} from '../../state/engineer.ts';
import { useUi } from '../../state/uiStore.ts';
import { ToggleRow } from '../ToggleRow.tsx';
import { Icon } from '../ui/Icon.tsx';
import { type SetupDraft, useStepControl } from './ctx.ts';
import type { DiscordSetup } from './useDiscordSetup.ts';

type Target = 'here' | 'discord';

export function EngineerStep({
  draft,
  defaultOn,
  discord,
}: {
  draft: SetupDraft;
  /** Starts on unless the previous step chose "Só acompanhar ao vivo". */
  defaultOn: boolean;
  discord: DiscordSetup;
}) {
  const volume = useEngineer((s) => s.controls.volume);
  const loading = useEngineer((s) => s.voiceLoading);
  const playing = useEngineer((s) => s.previewPlaying);
  const audioDevice = useUi((s) => s.serverStatus?.engineerAudioDeviceId ?? '');
  const volumeId = useId();
  const [on, setOn] = useState(() => draft.engineerOn ?? defaultOn);
  const [target, setTarget] = useState<Target>(
    audioDevice === DISCORD_RADIO_DEVICE_ID ? 'discord' : 'here',
  );
  const canPlay = typeof AudioContext !== 'undefined';

  useStepControl({
    canContinue: true,
    commit: () => {
      setEngineerEnabled(on, false);
      if (target === 'discord' && discord.configured) void discord.enable();
      else if (target === 'here' && audioDevice === DISCORD_RADIO_DEVICE_ID) void discord.disable();
    },
  });

  const toggle = (next: boolean) => {
    draft.engineerOn = next;
    setOn(next);
  };

  return (
    <div className="su-step">
      <p className="su-lead">
        {uiText('Ele fala em voz alta e escreve na tela. Em silêncio quando tudo corre bem.')}
      </p>

      <div className="ui-card su-panel">
        <ToggleRow
          title={uiText('Ligar o engenheiro')}
          description={uiText('Você pode desligar a qualquer momento pelo menu do ao vivo.')}
          checked={on}
          onChange={toggle}
        />
        <hr className="ui-divider" />
        <div className="su-volume">
          <label className="ui-toggle-title" htmlFor={volumeId}>
            {uiText('Volume')}
          </label>
          <div className="su-volume-row">
            <input
              id={volumeId}
              className="ui-range"
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(volume * 100)}
              onChange={(e) => setRadioControls({ volume: Number(e.currentTarget.value) / 100 })}
            />
            <output htmlFor={volumeId} className="num">
              {Math.round(volume * 100)}%
            </output>
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              data-size="sm"
              disabled={!canPlay || loading}
              onClick={() => testEngineerVoice()}
            >
              <Icon name={playing ? 'volume' : 'play'} size={16} />
              {uiText('Ouvir')}
            </button>
          </div>
          {!canPlay && (
            <p className="ui-help">
              {uiText(
                'Este navegador não toca o áudio do engenheiro. As instruções ficam na tela.',
              )}
            </p>
          )}
        </div>
      </div>

      <fieldset className="su-field">
        <legend className="ui-label">{uiText('Onde ele fala')}</legend>
        <div className="su-options" role="radiogroup" aria-label={uiText('Onde ele fala')}>
          <div className="su-option" data-checked={target === 'here' ? '1' : '0'}>
            <label className="su-option-main">
              <input
                type="radio"
                name="su-where"
                className="su-radio"
                checked={target === 'here'}
                onChange={() => setTarget('here')}
              />
              <span className="su-option-text">
                <strong>{uiText('Neste aparelho')}</strong>
                <span>{uiText('O som sai daqui.')}</span>
              </span>
            </label>
          </div>
          {discord.bridge && (
            <div className="su-option" data-checked={target === 'discord' ? '1' : '0'}>
              <label className="su-option-main">
                <input
                  type="radio"
                  name="su-where"
                  className="su-radio"
                  checked={target === 'discord'}
                  onChange={() => setTarget('discord')}
                />
                <span className="su-option-text">
                  <strong>{uiText('Discord')}</strong>
                  <span>{uiText('Pelo canal de voz, para ouvir no PS5. Opcional.')}</span>
                </span>
              </label>
              {discord.configured ? (
                <span className="ui-badge" data-tone="gain">
                  {uiText('Pronto')}
                </span>
              ) : target === 'discord' ? (
                <span className="su-option-actions">
                  <button
                    type="button"
                    className="ui-btn"
                    data-size="sm"
                    onClick={discord.openWizard}
                  >
                    {uiText('Configurar o Discord')}
                  </button>
                  <button
                    type="button"
                    className="ui-btn"
                    data-variant="ghost"
                    data-size="sm"
                    onClick={() => setTarget('here')}
                  >
                    {uiText('Configurar depois')}
                  </button>
                </span>
              ) : null}
            </div>
          )}
        </div>
        {!discord.bridge && (
          <p className="ui-help">
            {uiText('Para ouvir em outro aparelho, escolha em Configurações → Engenheiro.')}
          </p>
        )}
      </fieldset>
    </div>
  );
}
