/**
 * Interruptor "Falar pelo Discord" do menu ao vivo. Só aparece na janela do Bono para Windows (é ela
 * que hospeda o bot). Ligar faz duas coisas: liga o bot já configurado e escolhe "Discord · PS5"
 * como aparelho que toca o rádio. Desligar devolve o som para cada aparelho e desliga o bot.
 * Em outros aparelhos (tablet pela rede) a mesma saída é escolhida no seletor de aparelhos.
 */

import { type DesktopDiscordBridge, DISCORD_RADIO_DEVICE_ID } from '@gt7/shared';
import { useEffect, useState } from 'react';
import { api } from '../analysis/api.ts';
import { routes } from '../lib/route.ts';
import { useUi } from '../state/uiStore.ts';
import { ToggleRow } from './ToggleRow.tsx';

type Info = Awaited<ReturnType<DesktopDiscordBridge['get']>>;

/** Grava o aparelho do rádio no servidor e espelha na tela sem esperar o próximo status. */
export async function setRadioAudioDevice(id: string | null): Promise<void> {
  const updated = await api.patchSettings({ engineerAudioDeviceId: id });
  useUi.setState((state) =>
    state.serverStatus
      ? {
          serverStatus: {
            ...state.serverStatus,
            engineerAudioDeviceId: updated.engineerAudioDeviceId,
          },
        }
      : {},
  );
}

export function DiscordOutput() {
  const bridge = window.bonoDiscord;
  return bridge ? <Switch bridge={bridge} /> : null;
}

function Switch({ bridge }: { bridge: DesktopDiscordBridge }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const selected = useUi((s) => s.serverStatus?.engineerAudioDeviceId === DISCORD_RADIO_DEVICE_ID);

  useEffect(() => {
    let mounted = true;
    const off = bridge.onStatus((status) => setInfo((cur) => cur && { ...cur, status }));
    void bridge.get().then(
      (value) => mounted && setInfo(value),
      () => mounted && setError('Não foi possível ler o estado do Discord.'),
    );
    return () => {
      mounted = false;
      off();
    };
  }, [bridge]);

  const configured =
    !!info?.hasToken &&
    !!info.settings.channelId &&
    !!info.settings.driverId &&
    !!info.settings.delay.trim();
  const on = selected && !!info?.settings.enabled;

  async function toggle(next: boolean) {
    setBusy(true);
    setError('');
    try {
      if (next) {
        await bridge.setEnabled(true);
        await setRadioAudioDevice(DISCORD_RADIO_DEVICE_ID);
      } else {
        await setRadioAudioDevice(null);
        await bridge.setEnabled(false);
      }
      setInfo(await bridge.get());
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : 'Não foi possível alterar o Discord.';
      setError(message.replace(/^Error invoking remote method '[^']+': Error: /, ''));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ui-card bn-card" data-tone={on ? 'accent' : undefined}>
      <ToggleRow
        title="Falar pelo Discord"
        description={
          configured
            ? 'O engenheiro fala no canal de voz e você ouve no PS5. O bot entra quando você entra no canal.'
            : 'Configure o bot uma vez para ativar a saída pelo Discord.'
        }
        checked={on}
        disabled={busy || !info || !configured}
        onChange={(next) => void toggle(next)}
      />
      {info && configured && (
        <p className="ui-help" role="status" data-tone={info.status.error ? 'loss' : undefined}>
          {info.status.message}
        </p>
      )}
      {info && !configured && (
        <p className="ui-help">
          <a href={routes.config('discord')}>Abrir Configurações → Rádio no Discord</a>
        </p>
      )}
      {error && (
        <p className="ui-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
