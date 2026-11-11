/**
 * Discord inside the assistant (desktop app only): reads the bot configuration, hosts the Discord
 * assistant of Configurações and turns the radio on/off the same way the live menu switch does
 * (`DiscordOutput`): bot enabled + "Discord · PS5" as the device that plays the engineer.
 */

import { type DesktopDiscordBridge, DISCORD_RADIO_DEVICE_ID } from '@gt7/shared';
import { useCallback, useEffect, useState } from 'react';
import { t as uiText } from '../../lib/i18n.ts';
import { addNotice } from '../../state/uiStore.ts';
import { setRadioAudioDevice } from '../DiscordOutput.tsx';

export type DiscordInfo = Awaited<ReturnType<DesktopDiscordBridge['get']>>;

export interface DiscordSetup {
  bridge: DesktopDiscordBridge | null;
  info: DiscordInfo | null;
  /** Token and channel saved: the bot can be turned on. */
  configured: boolean;
  wizardOpen: boolean;
  openWizard: () => void;
  closeWizard: () => void;
  /** After the Discord assistant saved: reload and turn it on right away. */
  saved: () => void;
  enable: () => Promise<void>;
  disable: () => Promise<void>;
}

export function useDiscordSetup(): DiscordSetup {
  const bridge = window.bonoDiscord ?? null;
  const [info, setInfo] = useState<DiscordInfo | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!bridge) return null;
    try {
      const fresh = await bridge.get();
      setInfo(fresh);
      return fresh;
    } catch {
      return null;
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
    if (!bridge) return;
    return bridge.onStatus((status) => setInfo((cur) => cur && { ...cur, status }));
  }, [bridge, refresh]);

  const configured = !!info?.hasToken && !!info.settings.channelId;

  const enable = useCallback(async () => {
    if (!bridge) return;
    try {
      await bridge.setEnabled(true);
      await setRadioAudioDevice(DISCORD_RADIO_DEVICE_ID);
      await refresh();
    } catch {
      addNotice('warn', uiText('Não foi possível ligar o Discord. Tente em Configurações.'), 6000);
    }
  }, [bridge, refresh]);

  const disable = useCallback(async () => {
    if (!bridge) return;
    try {
      await setRadioAudioDevice(null);
      await bridge.setEnabled(false);
      await refresh();
    } catch {
      addNotice('warn', uiText('Não foi possível desligar o Discord.'), 6000);
    }
  }, [bridge, refresh]);

  return {
    bridge,
    info,
    configured,
    wizardOpen,
    openWizard: () => {
      // reading the configuration first discards a pending token, as in Configurações
      void refresh().then(() => setWizardOpen(true));
    },
    closeWizard: () => setWizardOpen(false),
    saved: () => {
      void refresh().then((fresh) => {
        if (fresh?.hasToken && fresh.settings.channelId) void enable();
      });
    },
    enable,
    disable,
  };
}
