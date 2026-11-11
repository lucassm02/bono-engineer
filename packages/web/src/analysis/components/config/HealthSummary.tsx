/**
 * Início das Configurações: o resumo de saúde (PS5, engenheiro, gravação, Discord, aparelhos) e o
 * cartão "Falta configurar". Cada linha é um estado + a ação que o resolve. A lógica de estado
 * está em `lib/configNav.ts` (`buildHealth`), aqui só há ligação com as telas.
 */

import { type ApiSettings, DISCORD_RADIO_DEVICE_ID, type FirewallStatus } from '@gt7/shared';
import { useEffect, useMemo, useState } from 'react';
import { t as uiText } from '../../../lib/i18n.ts';
import { radioVoice } from '../../../lib/radioVoices.ts';
import { routes } from '../../../lib/route.ts';
import { loadString } from '../../../lib/storage.ts';
import { rescanConsole } from '../../../net/consoleActions.ts';
import { useConsoleConnection } from '../../../state/consoleLink.ts';
import { setEngineerEnabled, useEngineer } from '../../../state/engineer.ts';
import { useUi } from '../../../state/uiStore.ts';
import { api } from '../../api.ts';
import {
  buildHealth,
  type ConfigTarget,
  type HealthInput,
  type HealthItem,
  type HealthTone,
  healthHeadline,
  type PendingStep,
  pendingSetupSteps,
  SETUP_STATE_KEY,
} from '../../lib/configNav.ts';
import { useSave } from './ConfigRow.tsx';

export const targetHref = (t: ConfigTarget) => routes.config(t.anchor ?? t.group);

const DOT_TONE: Record<HealthTone, string | undefined> = {
  ok: 'gain',
  busy: 'accent',
  warn: 'warn',
  bad: 'loss',
  off: undefined,
};

type DiscordHealth = NonNullable<HealthInput['discord']>;

/** Estado do bot do Discord (só existe na janela do Bono para Windows). */
function useDiscordHealth(): DiscordHealth | null {
  const [state, setState] = useState<DiscordHealth | null>(null);
  const selected = useUi((s) => s.serverStatus?.engineerAudioDeviceId === DISCORD_RADIO_DEVICE_ID);
  useEffect(() => {
    const bridge = window.bonoDiscord;
    if (!bridge) return;
    let mounted = true;
    const apply = (info: Awaited<ReturnType<typeof bridge.get>>) => {
      // Configurado = token + canal; o atraso sem calibrar usa o padrão (spec 07).
      const configured = info.hasToken && !!info.settings.channelId;
      setState({
        configured,
        enabled: info.settings.enabled,
        error: info.status.error,
        message: info.status.message,
      });
    };
    void bridge.get().then(
      (info) => mounted && apply(info),
      () => undefined,
    );
    const off = bridge.onStatus(() => {
      void bridge.get().then(
        (info) => mounted && apply(info),
        () => undefined,
      );
    });
    return () => {
      mounted = false;
      off();
    };
  }, []);
  if (!window.bonoDiscord || !state) return null;
  // Ligado de verdade só quando o engenheiro também fala por ele.
  return { ...state, enabled: state.enabled && selected };
}

export function HealthSummary({
  settings,
  firewall,
  onChange,
}: {
  settings: ApiSettings | null;
  firewall: FirewallStatus['state'] | null;
  onChange: () => void;
}) {
  const link = useConsoleConnection();
  const enabled = useEngineer((s) => s.enabled);
  const muted = useEngineer((s) => s.muted);
  const voiceUri = useEngineer((s) => s.voiceUri);
  const myId = useUi((s) => s.profile.deviceId);
  const serverStatus = useUi((s) => s.serverStatus);
  const discord = useDiscordHealth();
  const { busy, run } = useSave();

  const audioDevice = serverStatus?.engineerAudioDeviceId ?? '';
  const audio =
    audioDevice === DISCORD_RADIO_DEVICE_ID
      ? 'discord'
      : !audioDevice || audioDevice === myId
        ? 'here'
        : 'other';
  const devicesOnline = (serverStatus?.devices ?? []).filter(
    (d) => d.deviceId !== myId && d.deviceId !== DISCORD_RADIO_DEVICE_ID,
  ).length;

  const items = useMemo(
    () =>
      buildHealth({
        link,
        engineer: { enabled, muted, voiceName: radioVoice(voiceUri)?.name ?? null, audio },
        recording: settings ? { autoCapture: settings.autoCapture, raw: settings.record } : null,
        discord,
        devicesOnline,
        firewall,
      }),
    [link, enabled, muted, voiceUri, audio, settings, discord, devicesOnline, firewall],
  );
  const headline = healthHeadline(items);

  async function act(item: HealthItem) {
    const a = item.action;
    if (!a) return;
    if (a.kind === 'rescan') await rescanConsole();
    else if (a.kind === 'toggleEngineer') setEngineerEnabled(!enabled, audio === 'here');
    else if (a.kind === 'toggleRecording' && settings) {
      const next = !settings.autoCapture;
      const ok = next
        ? uiText('Gravação automática ligada.')
        : uiText('Gravação automática desligada.');
      if (await run(() => api.patchSettings({ autoCapture: next }), ok)) onChange();
    }
  }

  return (
    <section className="ui-card cfg-health" aria-labelledby="cfg-health-title">
      <header className="cfg-health-head">
        <h2 id="cfg-health-title" className="ui-card-title">
          {uiText('Como está tudo')}
        </h2>
        <span
          className="ui-badge"
          data-tone={headline.tone === 'ok' ? 'gain' : headline.tone === 'warn' ? 'warn' : 'loss'}
          role="status"
        >
          {headline.text}
        </span>
      </header>
      <ul className="cfg-health-list">
        {items.map((item) => (
          <li key={item.id} className="cfg-health-row" data-state={item.tone} data-id={item.id}>
            <span
              className="ui-dot"
              data-tone={DOT_TONE[item.tone]}
              data-busy={item.tone === 'busy' ? '1' : undefined}
              aria-hidden="true"
            />
            <div className="cfg-health-text">
              <strong>{item.title}</strong>
              <span>{item.detail}</span>
            </div>
            {item.action?.kind === 'goto' ? (
              <a
                className="ui-btn"
                data-variant="secondary"
                data-size="sm"
                href={targetHref(item.action.target)}
              >
                {item.action.label}
              </a>
            ) : item.action ? (
              <button
                type="button"
                className="ui-btn"
                data-variant={item.tone === 'ok' ? 'ghost' : 'secondary'}
                data-size="sm"
                disabled={busy}
                onClick={() => void act(item)}
              >
                {item.action.label}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** "Falta configurar": passos do assistente ainda pendentes. Só aparece se o assistente novo existir. */
export function PendingSetupCard({ onOpenAssistant }: { onOpenAssistant: () => void }) {
  const [steps, setSteps] = useState<PendingStep[] | null>(() =>
    pendingSetupSteps(loadString(SETUP_STATE_KEY)),
  );
  useEffect(() => {
    const read = () => setSteps(pendingSetupSteps(loadString(SETUP_STATE_KEY)));
    read();
    window.addEventListener('storage', read);
    return () => window.removeEventListener('storage', read);
  }, []);
  if (!steps || steps.length === 0) return null;
  return (
    <section className="ui-card cfg-pending" data-tone="accent" aria-labelledby="cfg-pending-title">
      <header className="cfg-health-head">
        <h2 id="cfg-pending-title" className="ui-card-title">
          {uiText('Falta configurar')}
        </h2>
        <button type="button" className="ui-btn" data-size="sm" onClick={onOpenAssistant}>
          {uiText('Continuar o assistente')}
        </button>
      </header>
      <ul className="cfg-health-list">
        {steps.map((s) => (
          <li key={s.id} className="cfg-health-row">
            <span className="ui-dot" data-tone="accent" aria-hidden="true" />
            <div className="cfg-health-text">
              <strong>{s.title}</strong>
            </div>
            <a
              className="ui-btn"
              data-variant="secondary"
              data-size="sm"
              href={targetHref({ group: s.group, anchor: s.anchor })}
            >
              {uiText('Resolver')}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
