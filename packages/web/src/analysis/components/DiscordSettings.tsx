import type { DesktopDiscordBridge } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { Card } from './ui.tsx';

declare global {
  interface Window {
    bonoDiscord?: DesktopDiscordBridge;
  }
}

export function DiscordSettings() {
  const bridge = window.bonoDiscord;
  return bridge ? <SettingsForm bridge={bridge} /> : null;
}

function SettingsForm({ bridge }: { bridge: DesktopDiscordBridge }) {
  const [data, setData] = useState<Awaited<ReturnType<DesktopDiscordBridge['get']>> | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
    <Card id="discord" title="Rádio no Discord">
      <p>
        Use um bot no seu canal de voz privado. O token é salvo no armazenamento seguro deste PC.
      </p>
      {data && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => bridge.save({ ...data.settings, token }), true);
          }}
        >
          <fieldset className="a-fieldset" disabled={busy}>
            <label>
              Token do bot
              <input
                className="a-input"
                type="password"
                autoComplete="new-password"
                maxLength={200}
                value={token}
                required={!data.hasToken}
                placeholder={data.hasToken ? 'Token salvo · preencha para trocar' : undefined}
                onChange={(event) => setToken(event.currentTarget.value)}
              />
            </label>
            <label>
              ID do canal de voz
              <input
                className="a-input"
                inputMode="numeric"
                pattern="[0-9]{17,20}"
                required
                value={data.settings.channelId}
                onChange={(event) => edit({ channelId: event.currentTarget.value })}
              />
            </label>
            <label>
              Seu ID de usuário no Discord
              <input
                className="a-input"
                inputMode="numeric"
                pattern="[0-9]{17,20}"
                required
                value={data.settings.driverId}
                onChange={(event) => edit({ driverId: event.currentTarget.value })}
              />
            </label>
            <label>
              Atraso medido em ms
              <input
                className="a-input"
                maxLength={400}
                required={data.settings.enabled}
                value={data.settings.delay}
                placeholder="Ex.: 280,300,315"
                onChange={(event) => edit({ delay: event.currentTarget.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={data.settings.brakePercent}
                onChange={(event) => edit({ brakePercent: event.currentTarget.checked })}
              />{' '}
              Falar o percentual de freio em Aprender pista
            </label>
            <label>
              <input
                type="checkbox"
                checked={data.settings.enabled}
                onChange={(event) => edit({ enabled: event.currentTarget.checked })}
              />{' '}
              Ativar o rádio do Discord ao abrir o Bono
            </label>
            <div className="a-actions">
              <button type="submit" className="a-btn">
                Salvar
              </button>
              {data.status.testing ? (
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  onClick={() => void run(() => bridge.stopTest())}
                >
                  Encerrar teste
                </button>
              ) : (
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  disabled={!data.hasToken}
                  onClick={() => void run(() => bridge.test())}
                >
                  Testar com 10 bipes
                </button>
              )}
              {data.hasToken && (
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  onClick={() => void run(() => bridge.remove(), true)}
                >
                  Apagar configuração
                </button>
              )}
            </div>
          </fieldset>
          <p role="status">{data.status.message}</p>
          <p className="a-muted">
            Para calibrar, salve com o rádio desligado, entre no canal pelo PS5 e inicie o teste.
            Para ouvir as instruções, escolha Discord · PS5 em Aparelho que toca o rádio no painel
            ao vivo.
          </p>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </Card>
  );
}
