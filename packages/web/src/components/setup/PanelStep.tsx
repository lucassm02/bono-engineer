/**
 * Step 5 · Seu painel. The three screen presets of Configurações → Painel e aparelhos, applied to
 * this device with the same function (`profileWithViews`), plus the QR code to open the live panel
 * on a phone or tablet (optional).
 */

import { useEffect, useState } from 'react';
import { api } from '../../analysis/api.ts';
import { copyText } from '../../analysis/components/ui.tsx';
import {
  matchScreenPreset,
  profileWithViews,
  SCREEN_PRESETS,
  type ScreenPresetId,
} from '../../analysis/lib/configNav.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { VIEW_LABELS } from '../../lib/labels.ts';
import { defaultPanelPreset } from '../../lib/onboarding.ts';
import { send } from '../../net/transport.ts';
import { setProfile, useUi } from '../../state/uiStore.ts';
import { Icon } from '../ui/Icon.tsx';
import { useStepControl } from './ctx.ts';

/** Same writes as the device row of Configurações: local profile + the server. */
export function applyScreenPreset(id: ScreenPresetId): void {
  const preset = SCREEN_PRESETS.find((p) => p.id === id);
  if (!preset) return;
  const next = profileWithViews(useUi.getState().profile, preset.views, Date.now());
  setProfile(next);
  send({ type: 'setDeviceProfile', profile: next });
}

function PhoneQr() {
  const [open, setOpen] = useState(false);
  const [lan, setLan] = useState<{ url: string | null; qr: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!open || lan) return;
    let alive = true;
    api
      .lan()
      .then((l) => alive && setLan({ url: l.urls[0] ?? l.preferredUrl, qr: l.qrSvgDataUrl }))
      .catch(() => alive && setLan({ url: null, qr: null }));
    return () => {
      alive = false;
    };
  }, [open, lan]);
  return (
    <div className="su-phone">
      <button
        type="button"
        className="ui-btn"
        data-variant="ghost"
        data-size="sm"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="remote" size={16} />
        {uiText('Abrir também no celular ou tablet')}
      </button>
      {open && (
        <section className="ui-card ob-phone" aria-live="polite">
          {lan?.qr ? (
            <img
              className="ob-qr"
              src={lan.qr}
              alt={uiText('QR Code para abrir o ao vivo em outro aparelho')}
            />
          ) : (
            <p className="ui-help">
              {lan
                ? uiText('Nenhum endereço de rede disponível.')
                : uiText('Preparando o QR Code…')}
            </p>
          )}
          <div>
            <p className="ui-help">
              {uiText('Escaneie com a câmera. O aparelho e este PC precisam estar no mesmo Wi-Fi.')}
            </p>
            {lan?.url && (
              <p className="ob-url">
                <span className="num">{lan.url}</span>{' '}
                <button
                  type="button"
                  className="ui-btn"
                  data-variant="secondary"
                  data-size="sm"
                  onClick={async () => {
                    setCopied(await copyText(lan.url ?? ''));
                    setTimeout(() => setCopied(false), 1800);
                  }}
                >
                  <Icon name={copied ? 'check' : 'copy'} size={16} />
                  {copied ? uiText('Copiado ✓') : uiText('Copiar')}
                </button>
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

export function PanelStep() {
  const views = useUi((s) => s.profile.views);
  const [choice, setChoice] = useState<ScreenPresetId>(
    () =>
      matchScreenPreset(views) ??
      defaultPanelPreset({
        coarsePointer: window.matchMedia?.('(pointer: coarse)').matches ?? false,
        width: window.innerWidth,
      }),
  );
  useStepControl({ canContinue: true, commit: () => applyScreenPreset(choice) });

  return (
    <div className="su-step">
      <p className="su-lead">
        {uiText('Escolha as telas deste aparelho. Dá para mudar a qualquer hora.')}
      </p>
      <div className="su-cards" role="radiogroup" aria-label={uiText('Telas do ao vivo')}>
        {SCREEN_PRESETS.map((preset) => (
          <label
            key={preset.id}
            className="su-card"
            data-checked={choice === preset.id ? '1' : '0'}
          >
            <input
              type="radio"
              name="su-preset"
              className="su-radio"
              checked={choice === preset.id}
              onChange={() => setChoice(preset.id)}
            />
            <Icon name="layout" size={26} />
            <span className="su-card-text">
              <strong>{preset.label}</strong>
              <span>{preset.description}</span>
              <span className="su-views">
                {preset.views.map((v) => VIEW_LABELS[v]).join(' · ')}
              </span>
            </span>
            <span className="su-tick" aria-hidden="true">
              <Icon name="check" size={16} />
            </span>
          </label>
        ))}
      </div>
      <PhoneQr />
    </div>
  );
}
