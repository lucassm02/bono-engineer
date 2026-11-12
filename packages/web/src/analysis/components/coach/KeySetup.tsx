/**
 * API key setup for the in-app coach: pick Claude (Anthropic) or OpenAI, paste the key, test it and
 * choose the model. Used by the Coach IA page (first use) and by Settings → Coach IA, so both
 * behave the same. The key goes to the local server only and never comes back (last 4 characters).
 */

import type { CoachConfig, CoachConfigPatch, CoachProvider, CoachVerifyResult } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { humanizeError } from '../../../lib/copy.ts';
import { t as uiText } from '../../../lib/i18n.ts';
import '../../../styles/coach-setup.css';
import { api } from '../../api.ts';
import { ConfirmButton } from '../ui.tsx';

const OTHER = '__other__';

const PROVIDER_TEXT: Record<
  CoachProvider,
  () => { name: string; models: string; placeholder: string }
> = {
  anthropic: () => ({
    name: uiText('Claude (Anthropic)'),
    models: uiText('Modelos Claude'),
    placeholder: 'sk-ant-…',
  }),
  openai: () => ({
    name: uiText('OpenAI (ChatGPT)'),
    models: uiText('Modelos GPT'),
    placeholder: 'sk-…',
  }),
};

export function KeySetup({
  config: incoming,
  onChange,
}: {
  config: CoachConfig;
  /** Called with the new config once a change is settled (a new key only after it was tested). */
  onChange: (c: CoachConfig) => void;
}) {
  // A local copy: a key that was just saved must not switch the page to the chat (and unmount this
  // screen) before the test of the key has told the driver whether it works.
  const [config, setConfig] = useState(incoming);
  useEffect(() => setConfig(incoming), [incoming]);
  const [selected, setSelected] = useState<CoachProvider>(incoming.provider);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CoachVerifyResult | null>(null);
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);

  const p = config.providers.find((x) => x.provider === selected) ?? config.providers[0]!;
  const text = PROVIDER_TEXT[selected]();
  const known = p.models.some((m) => m.id === p.model);
  const inUse = config.provider === selected && p.hasKey;

  const patch = async (body: CoachConfigPatch, publish = true) => {
    setBusy(true);
    try {
      const c = await api.putCoachConfig(body);
      setConfig(c);
      if (publish) onChange(c);
      return c;
    } catch (e) {
      setResult({ ok: false, provider: selected, message: humanizeError(e).text });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const verify = async (): Promise<boolean> => {
    setBusy(true);
    setResult(null);
    try {
      const r = await api.coachVerify(selected);
      setResult(r);
      return r.ok;
    } catch (e) {
      setResult({ ok: false, provider: selected, message: humanizeError(e).text });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const saveKey = async () => {
    const k = key.trim();
    if (!k) return;
    setResult(null);
    const body: CoachConfigPatch =
      selected === 'anthropic'
        ? { apiKey: k, provider: selected }
        : { openaiApiKey: k, provider: selected };
    const saved = await patch(body, false);
    if (!saved) return;
    setKey('');
    // The chat opens only for a key that works; a wrong key stays here with the reason.
    if (await verify()) onChange(saved);
  };

  const saveModel = (model: string) =>
    patch(selected === 'anthropic' ? { model } : { openaiModel: model });

  return (
    <div className="cks">
      <fieldset className="cks-providers">
        <legend>{uiText('Qual IA vai responder?')}</legend>
        {config.providers.map((x) => {
          const t = PROVIDER_TEXT[x.provider]();
          return (
            <label
              key={x.provider}
              className="cks-provider"
              data-on={selected === x.provider ? '1' : '0'}
            >
              <input
                type="radio"
                name="coach-provider"
                checked={selected === x.provider}
                onChange={() => {
                  setSelected(x.provider);
                  setResult(null);
                  setKey('');
                  setCustomOpen(false);
                }}
              />
              <strong>{t.name}</strong>
              <span className="cks-sub">{t.models}</span>
              {x.hasKey && (
                <span className="ui-badge" data-tone="gain">
                  {config.provider === x.provider ? uiText('em uso') : uiText('chave salva')}
                </span>
              )}
            </label>
          );
        })}
      </fieldset>

      <ol className="cks-steps">
        <li>
          <span className="cks-n">1</span>
          <div>
            <strong>{uiText('Crie uma chave de API')}</strong>
            <p className="cks-muted">
              <a href={p.keyUrl} target="_blank" rel="noreferrer">
                {p.keyUrl.replace('https://', '')}
              </a>
              {` — ${uiText('a chave é da conta de desenvolvedor e é cobrada à parte; a assinatura do chat não vale como chave.')}`}
            </p>
          </div>
        </li>
        <li>
          <span className="cks-n">2</span>
          <div className="cks-grow">
            <strong>{uiText('Cole a chave aqui')}</strong>
            {p.hasKey && (
              <p className="cks-keyline">
                <span className="ui-badge" data-tone="gain">
                  {uiText('configurada')}
                </span>
                <span className="num">…{p.keyLast4}</span>
                <span className="cks-muted">
                  {p.keySource === 'env'
                    ? uiText('variável {0} — tem prioridade', p.envVar)
                    : uiText('salva no app')}
                </span>
              </p>
            )}
            <form
              className="cks-form"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                void saveKey();
              }}
            >
              <input
                className="ui-input"
                type="password"
                value={key}
                aria-label={uiText('Chave da API')}
                placeholder={p.hasKey ? uiText('Digite para trocar a chave') : text.placeholder}
                autoComplete="new-password"
                spellCheck={false}
                onChange={(e) => setKey(e.target.value)}
              />
              <button type="submit" className="ui-btn" disabled={busy || !key.trim()}>
                {uiText('Salvar e testar')}
              </button>
            </form>
            <p className="cks-muted">
              {uiText(
                'A chave fica só neste PC e nunca volta para o navegador: aqui aparecem só os 4 últimos caracteres.',
              )}
            </p>
          </div>
        </li>
        <li>
          <span className="cks-n">3</span>
          <div className="cks-grow">
            <strong>{uiText('Escolha o modelo')}</strong>
            <div className="cks-form">
              <select
                className="ui-select"
                aria-label={uiText('Modelo')}
                value={customOpen || !known ? OTHER : p.model}
                disabled={busy}
                onChange={(e) => {
                  if (e.target.value === OTHER) {
                    setCustomOpen(true);
                    setCustom(known ? '' : p.model);
                  } else {
                    setCustomOpen(false);
                    void saveModel(e.target.value);
                  }
                }}
              >
                {p.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.id === p.defaultModel ? uiText(' (padrão)') : ''}
                  </option>
                ))}
                {selected === 'openai' && <option value={OTHER}>{uiText('Outro modelo…')}</option>}
                {selected === 'anthropic' && !known && <option value={OTHER}>{p.model}</option>}
              </select>
            </div>
            {selected === 'openai' && (customOpen || !known) && (
              <form
                className="cks-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (custom.trim()) void saveModel(custom.trim());
                }}
              >
                <input
                  className="ui-input"
                  value={custom}
                  aria-label={uiText('Nome do modelo')}
                  placeholder="gpt-5"
                  spellCheck={false}
                  onChange={(e) => setCustom(e.target.value)}
                />
                <button
                  type="submit"
                  className="ui-btn"
                  data-variant="secondary"
                  disabled={busy || !custom.trim()}
                >
                  {uiText('Usar este modelo')}
                </button>
              </form>
            )}
            <p className="cks-muted">
              {p.models.find((m) => m.id === p.model)?.description ??
                uiText('Modelo digitado por você: confira o nome na documentação do provedor.')}
            </p>
          </div>
        </li>
      </ol>

      {result && (
        <p
          className="cks-result"
          data-tone={result.ok ? 'gain' : 'loss'}
          role={result.ok ? 'status' : 'alert'}
        >
          {result.message}
        </p>
      )}

      <div className="cks-actions">
        {p.hasKey && !inUse && (
          <button
            type="button"
            className="ui-btn"
            disabled={busy}
            onClick={() => void patch({ provider: selected })}
          >
            {uiText('Usar {0}', text.name)}
          </button>
        )}
        {p.hasKey && (
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            disabled={busy}
            onClick={() => void verify()}
          >
            {uiText('Testar a chave')}
          </button>
        )}
        {p.keySource === 'settings' && (
          <ConfirmButton
            label={uiText('Remover chave')}
            question={uiText('Remover a chave de {0}?', text.name)}
            onConfirm={async () => {
              setResult(null);
              await patch(selected === 'anthropic' ? { apiKey: null } : { openaiApiKey: null });
            }}
          />
        )}
      </div>
    </div>
  );
}
