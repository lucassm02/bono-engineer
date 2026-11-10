import type { DesktopDiscordBridge } from '@gt7/shared';
import { useEffect, useId, useState } from 'react';
import { ConfirmModal } from './ConfirmModal.tsx';
import { Panel } from './Panel.tsx';

declare global {
  interface Window {
    bonoDiscord?: DesktopDiscordBridge;
  }
}

export function DiscordSettings() {
  const bridge = window.bonoDiscord;
  return bridge ? <SettingsForm bridge={bridge} /> : null;
}

function Switch({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="ui-toggle">
      <div className="ui-toggle-text">
        <span className="ui-toggle-title" id={id}>
          {title}
        </span>
        {description && <span className="ui-toggle-desc">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        className="ui-switch"
        onClick={() => onChange(!checked)}
      />
    </div>
  );
}

function SettingsForm({ bridge }: { bridge: DesktopDiscordBridge }) {
  const [data, setData] = useState<Awaited<ReturnType<DesktopDiscordBridge['get']>> | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

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
        if (mounted) setError('Não foi possível ler a configuração do Discord.');
      },
    );
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);

  const edit = (change: Partial<NonNullable<typeof data>['settings']>) =>
    setData((current) => current && { ...current, settings: { ...current.settings, ...change } });

  async function run(action: () => Promise<void>, refresh = false) {
    setBusy(true);
    setError('');
    try {
      await action();
      if (refresh) {
        setToken('');
        setData(await bridge.get());
      }
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Não foi possível aplicar a configuração.';
      setError(message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      id="discord"
      title="Rádio no Discord"
      description="Use um bot no seu canal de voz privado. O token é salvo no armazenamento seguro deste PC."
    >
      {data && (
        <form
          className="cfg-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => bridge.save({ ...data.settings, token }), true);
          }}
        >
          <fieldset className="cfg-fieldset" disabled={busy}>
            <div className="cfg-two">
              <label className="ui-field">
                <span className="ui-label">Token do bot</span>
                <input
                  className="ui-input"
                  type="password"
                  autoComplete="new-password"
                  maxLength={200}
                  value={token}
                  required={!data.hasToken}
                  placeholder={data.hasToken ? 'Token salvo · preencha para trocar' : undefined}
                  onChange={(event) => setToken(event.currentTarget.value)}
                />
              </label>
              <label className="ui-field">
                <span className="ui-label">Atraso medido em ms</span>
                <input
                  className="ui-input"
                  maxLength={400}
                  required={data.settings.enabled}
                  value={data.settings.delay}
                  placeholder="Ex.: 280,300,315"
                  onChange={(event) => edit({ delay: event.currentTarget.value })}
                />
              </label>
              <label className="ui-field">
                <span className="ui-label">ID do canal de voz</span>
                <input
                  className="ui-input"
                  inputMode="numeric"
                  pattern="[0-9]{17,20}"
                  required
                  value={data.settings.channelId}
                  onChange={(event) => edit({ channelId: event.currentTarget.value })}
                />
              </label>
              <label className="ui-field">
                <span className="ui-label">Seu ID de usuário no Discord</span>
                <input
                  className="ui-input"
                  inputMode="numeric"
                  pattern="[0-9]{17,20}"
                  required
                  value={data.settings.driverId}
                  onChange={(event) => edit({ driverId: event.currentTarget.value })}
                />
              </label>
            </div>
            <div className="cfg-list">
              <Switch
                title="Falar o percentual de freio em Aprender pista"
                checked={data.settings.brakePercent}
                onChange={(next) => edit({ brakePercent: next })}
              />
              <Switch
                title="Ativar o rádio do Discord ao abrir o Bono"
                checked={data.settings.enabled}
                onChange={(next) => edit({ enabled: next })}
              />
            </div>
            <div className="cfg-actions">
              <button type="submit" className="ui-btn">
                Salvar
              </button>
              {data.status.testing ? (
                <button
                  type="button"
                  className="ui-btn"
                  data-variant="secondary"
                  onClick={() => void run(() => bridge.stopTest())}
                >
                  Encerrar teste
                </button>
              ) : (
                <button
                  type="button"
                  className="ui-btn"
                  data-variant="secondary"
                  disabled={!data.hasToken}
                  onClick={() => void run(() => bridge.test())}
                >
                  Testar com 10 bipes
                </button>
              )}
              {data.hasToken && (
                <button
                  type="button"
                  className="ui-btn cfg-actions-end"
                  data-variant="danger"
                  onClick={() => setConfirmRemove(true)}
                >
                  Apagar configuração
                </button>
              )}
            </div>
          </fieldset>
          <p className="cfg-status" role="status">
            {data.status.message}
          </p>
          <p className="cfg-hint">
            Para calibrar, salve com o rádio desligado, entre no canal pelo PS5 e inicie o teste.
            Para ouvir as instruções, escolha Discord · PS5 em Aparelho que toca o rádio no painel
            ao vivo.
          </p>
          <ConfirmModal
            open={confirmRemove}
            title="Apagar a configuração do Discord?"
            message={
              <>
                <p>O token do bot e os IDs salvos neste PC serão apagados.</p>
                <p>O rádio no Discord deixa de funcionar até você configurar de novo.</p>
              </>
            }
            confirmLabel="Apagar configuração"
            busy={busy}
            onClose={() => setConfirmRemove(false)}
            onConfirm={async () => {
              await run(() => bridge.remove(), true);
              setConfirmRemove(false);
            }}
          />
        </form>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </Panel>
  );
}
