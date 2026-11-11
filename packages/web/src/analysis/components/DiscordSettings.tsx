import { type DesktopDiscordBridge, DISCORD_DEFAULT_DELAY_MS } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { ToggleRow } from '../../components/ToggleRow.tsx';
import { Icon } from '../../components/ui/Icon.tsx';
import { t as uiText } from '../../lib/i18n.ts';
import { radioVoice } from '../../lib/radioVoices.ts';
import { useEngineer } from '../../state/engineer.ts';
import '../../styles/discord.css';
import { ConfirmModal } from './ConfirmModal.tsx';
import { bridgeError, type DiscordStep, DiscordWizard } from './DiscordWizard.tsx';
import { Panel } from './Panel.tsx';

declare global {
  interface Window {
    bonoDiscord?: DesktopDiscordBridge;
  }
}

type Info = Awaited<ReturnType<DesktopDiscordBridge['get']>>;

export function DiscordSettings() {
  const bridge = window.bonoDiscord;
  return bridge ? <SettingsForm bridge={bridge} /> : null;
}

function SettingsForm({ bridge }: { bridge: DesktopDiscordBridge }) {
  const [data, setData] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [wizard, setWizard] = useState<DiscordStep | null>(null);
  const [fineTune, setFineTune] = useState(false);

  useEffect(() => {
    let mounted = true;
    const unsubscribe = bridge.onStatus((status) => {
      setData((current) => current && { ...current, status });
    });
    void bridge.get().then(
      (value) => {
        if (mounted) setData(value);
      },
      () => {
        if (mounted) setError(uiText('Não foi possível ler a configuração do Discord.'));
      },
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);

  const edit = (change: Partial<Info['settings']>) =>
    setData((current) => current && { ...current, settings: { ...current.settings, ...change } });

  async function run(action: () => Promise<void>, refresh = false) {
    setBusy(true);
    setError('');
    try {
      await action();
      if (refresh) setData(await bridge.get());
    } catch (cause) {
      setError(bridgeError(cause, 'Não foi possível aplicar a configuração.'));
    } finally {
      setBusy(false);
    }
  }

  /** Abre o assistente a partir de um estado limpo (ler a configuração descarta token pendente). */
  async function openWizard() {
    if (!data) return;
    setError('');
    try {
      const fresh = await bridge.get();
      setData(fresh);
      setWizard(fresh.hasToken && fresh.settings.channelId ? 4 : 1);
    } catch (cause) {
      setError(bridgeError(cause, 'Não foi possível ler a configuração do Discord.'));
    }
  }

  const configured = !!data?.hasToken && !!data.settings.channelId;
  const uncalibrated = !!data && !data.settings.delay.trim();

  return (
    <Panel
      id="discord"
      title={uiText('Rádio no Discord')}
      description={uiText(
        'O engenheiro fala por um bot seu no canal de voz privado; o PS5 entra no mesmo canal. O token é salvo no armazenamento seguro deste PC.',
      )}
    >
      {data && !configured && (
        <div className="cfg-stack">
          <p className="cfg-lead">
            {uiText(
              'Em poucos passos: criar o bot, colar o token, convidar o bot e escolher o canal. Você não precisa copiar nenhum ID.',
            )}
          </p>
          <div className="cfg-actions">
            <button type="button" className="ui-btn" onClick={() => void openWizard()}>
              {uiText('Configurar o Discord')}
            </button>
          </div>
          <p className="cfg-status" role="status">
            {uiText(data.status.message)}
          </p>
        </div>
      )}

      {data && configured && (
        <div className="cfg-stack">
          <div className="dc-summary">
            <div className="dc-summary-title">
              <span>{data.summary.botName || uiText('Bot do Discord')}</span>
              <span className="ui-badge" data-tone={data.settings.enabled ? 'gain' : undefined}>
                {data.settings.enabled ? uiText('Ligado') : uiText('Desligado')}
              </span>
            </div>
            <span className="dc-summary-meta">
              {[data.summary.guildName, data.summary.channelName].filter(Boolean).join(' › ') ||
                uiText('Canal escolhido')}
            </span>
            {data.summary.tokenTail && (
              <span className="dc-summary-meta">
                {uiText('Token salvo · termina em {0}', data.summary.tokenTail)}
              </span>
            )}
          </div>
          <p
            className="cfg-status"
            role="status"
            data-tone={data.status.error ? 'loss' : undefined}
          >
            {uiText(data.status.message)}
          </p>
          {uncalibrated && (
            <p className="dc-warn" role="note">
              <Icon name="alert" />
              <span>
                {uiText('O som pode chegar um pouco depois; calibre para sincronizar.')}{' '}
                <button
                  type="button"
                  className="ui-btn"
                  data-variant="ghost"
                  data-size="sm"
                  onClick={() => setFineTune(true)}
                >
                  {uiText('Calibrar o atraso')}
                </button>
              </span>
            </p>
          )}
          <div className="cfg-actions">
            {data.status.testing ? (
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                disabled={busy}
                onClick={() => void run(() => bridge.stopTest())}
              >
                {uiText('Encerrar teste')}
              </button>
            ) : (
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                disabled={busy}
                onClick={() => void run(() => bridge.test())}
              >
                {uiText('Testar com 10 bipes')}
              </button>
            )}
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              disabled={busy}
              onClick={() => void openWizard()}
            >
              {uiText('Reconfigurar')}
            </button>
            <button
              type="button"
              className="ui-btn cfg-actions-end"
              data-variant="danger"
              disabled={busy}
              onClick={() => setConfirmRemove(true)}
            >
              {uiText('Apagar configuração')}
            </button>
          </div>

          <details
            className="cfg-adv"
            open={fineTune}
            onToggle={(event) => setFineTune(event.currentTarget.open)}
          >
            <summary>{uiText('Ajuste fino')}</summary>
            <form
              className="cfg-adv-body cfg-stack"
              onSubmit={(event) => {
                event.preventDefault();
                const voice =
                  radioVoice(useEngineer.getState().voiceUri)?.pack ?? data.settings.voice;
                void run(() => bridge.save({ ...data.settings, token: '', voice }), true);
              }}
            >
              <fieldset className="cfg-fieldset" disabled={busy}>
                <div className="cfg-two">
                  <label className="ui-field">
                    <span className="ui-label">{uiText('Atraso medido em ms')}</span>
                    <input
                      className="ui-input"
                      maxLength={400}
                      value={data.settings.delay}
                      placeholder={uiText('Padrão: {0} ms', DISCORD_DEFAULT_DELAY_MS)}
                      onChange={(event) => edit({ delay: event.currentTarget.value })}
                    />
                    <span className="ui-help">
                      {uiText(
                        'Rode o teste de 10 bipes, meça o atraso no headset e informe as medições separadas por vírgula; o Bono usa o percentil 90. Em branco, vale o padrão de {0} ms.',
                        DISCORD_DEFAULT_DELAY_MS,
                      )}
                    </span>
                  </label>
                  <label className="ui-field">
                    <span className="ui-label">{uiText('Só seguir este usuário (opcional)')}</span>
                    <input
                      className="ui-input"
                      inputMode="numeric"
                      pattern="[0-9]{17,20}"
                      value={data.settings.followUserId}
                      placeholder={uiText('ID do usuário no Discord')}
                      onChange={(event) => edit({ followUserId: event.currentTarget.value })}
                    />
                    <span className="ui-help">
                      {uiText(
                        'Em branco, o bot entra quando qualquer pessoa entra no canal e sai quando ele esvazia. Preencha para ele acompanhar só uma conta.',
                      )}
                    </span>
                  </label>
                </div>
                <div className="cfg-list">
                  <ToggleRow
                    title={uiText('Falar o percentual de freio em Aprender pista')}
                    checked={data.settings.brakePercent}
                    onChange={(next) => edit({ brakePercent: next })}
                  />
                  <ToggleRow
                    title={uiText('Ligar ao abrir o Bono')}
                    description={uiText('Ativa o rádio do Discord sempre que o aplicativo abrir.')}
                    checked={data.settings.enabled}
                    onChange={(next) => edit({ enabled: next })}
                  />
                </div>
                <div className="cfg-actions">
                  <button type="submit" className="ui-btn">
                    {uiText('Salvar ajuste fino')}
                  </button>
                </div>
              </fieldset>
              <p className="cfg-hint">
                {uiText(
                  'Para calibrar, entre no canal pelo PS5 e inicie o teste. Para ouvir as instruções, escolha Discord · PS5 em Aparelho que toca o rádio no painel ao vivo.',
                )}
              </p>
            </form>
          </details>
        </div>
      )}

      {data && (
        <>
          <DiscordWizard
            bridge={bridge}
            open={wizard !== null}
            startAt={wizard ?? 1}
            settings={data.settings}
            status={data.status}
            onClose={() => setWizard(null)}
            onSaved={() => void bridge.get().then(setData, () => {})}
          />
          <ConfirmModal
            open={confirmRemove}
            title={uiText('Apagar a configuração do Discord?')}
            message={
              <>
                <p>{uiText('O token do bot e o canal salvos neste PC serão apagados.')}</p>
                <p>
                  {uiText('O rádio no Discord deixa de funcionar até você configurar de novo.')}
                </p>
              </>
            }
            confirmLabel={uiText('Apagar configuração')}
            busy={busy}
            onClose={() => setConfirmRemove(false)}
            onConfirm={async () => {
              await run(() => bridge.remove(), true);
              setConfirmRemove(false);
            }}
          />
        </>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}
