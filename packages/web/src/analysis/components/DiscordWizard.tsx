/**
 * Assistente do rádio no Discord, em 4 passos dentro de um Modal `lg`: criar o bot, colar o token,
 * convidar o bot e escolher o canal de voz. Ao fim oferece o teste de 10 bipes e a calibragem do
 * atraso (opcional). Nenhum ID é digitado. O token só vai da tela para o aplicativo; nunca volta.
 */

import {
  type DesktopDiscordBridge,
  type DesktopDiscordSettings,
  type DesktopDiscordStatus,
  DISCORD_DEFAULT_DELAY_MS,
  DISCORD_PORTAL_URL,
  type DiscordBotInfo,
  type DiscordVoiceChannel,
} from '@gt7/shared';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import { Modal } from '../../components/ui/Modal.tsx';
import { humanizeError } from '../../lib/copy.ts';
import { t as uiText } from '../../lib/i18n.ts';
import '../../styles/discord.css';

export type DiscordStep = 1 | 2 | 3 | 4;

const STEP_NAMES = ['Criar o bot', 'Colar o token', 'Convidar o bot', 'Escolher o canal'] as const;
const POLL_MS = 3000;

/** Tira o prefixo técnico que o Electron põe nas mensagens de erro vindas do aplicativo. */
export function bridgeError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error && cause.message ? cause.message : fallback;
  return uiText(humanizeError(message).text);
}

export function groupByGuild(channels: readonly DiscordVoiceChannel[]) {
  const groups = new Map<string, DiscordVoiceChannel[]>();
  for (const channel of channels) {
    const list = groups.get(channel.guildName) ?? [];
    list.push(channel);
    groups.set(channel.guildName, list);
  }
  return [...groups].map(([guildName, items]) => ({ guildName, items }));
}

export function DiscordWizard({
  bridge,
  open,
  startAt,
  settings,
  status,
  onClose,
  onSaved,
}: {
  bridge: DesktopDiscordBridge;
  open: boolean;
  /** 1 para um bot novo; 4 para trocar só o canal de um bot já configurado. */
  startAt: DiscordStep;
  settings: DesktopDiscordSettings;
  status: DesktopDiscordStatus;
  onClose: () => void;
  /** Chamado depois que a configuração foi gravada (para a tela recarregar o resumo). */
  onSaved: () => void;
}) {
  const [step, setStep] = useState<DiscordStep>(startAt);
  const [token, setToken] = useState('');
  const [bot, setBot] = useState<DiscordBotInfo | null>(null);
  const [channels, setChannels] = useState<DiscordVoiceChannel[] | null>(null);
  const [picked, setPicked] = useState(settings.channelId);
  const [delay, setDelay] = useState(settings.delay);
  const [calibrate, setCalibrate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pollKey, setPollKey] = useState(0);

  // Cada vez que o assistente abre, volta ao início do fluxo escolhido.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reinicia só quando abre
  useEffect(() => {
    if (!open) return;
    setStep(startAt);
    setToken('');
    setBot(null);
    setChannels(null);
    setPicked(settings.channelId);
    setDelay(settings.delay);
    setCalibrate(false);
    setError('');
  }, [open]);

  // Passo 3: consulta a cada 3 s até o bot aparecer em algum servidor e então avança sozinho.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pollKey` reinicia a consulta
  useEffect(() => {
    if (!open || step !== 3) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const list = await bridge.listVoiceChannels();
        if (cancelled) return;
        if (list.length > 0) {
          setChannels(list);
          setError('');
          setStep(4);
          return;
        }
        setError('');
      } catch (cause) {
        if (!cancelled) setError(bridgeError(cause, 'Não consegui consultar o Discord.'));
        return;
      }
      timer = setTimeout(() => void tick(), POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, step, bridge, pollKey]);

  // Passo 4 aberto direto (trocar de canal): carrega a lista com o token salvo.
  async function loadChannels() {
    setBusy(true);
    setError('');
    try {
      setChannels(await bridge.listVoiceChannels());
    } catch (cause) {
      setError(bridgeError(cause, 'Não consegui listar os canais.'));
    } finally {
      setBusy(false);
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: carrega uma vez ao entrar no passo 4
  useEffect(() => {
    if (open && step === 4 && channels === null) void loadChannels();
  }, [open, step, channels]);

  async function validateToken(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setBot(null);
    try {
      setBot(await bridge.inspectToken(token));
    } catch (cause) {
      setError(bridgeError(cause, 'Não consegui validar o token.'));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    await bridge.save({ ...settings, channelId: picked, delay, token });
    // Depois de salvo, o aplicativo guarda o token; a tela não precisa mais dele.
    setToken('');
    onSaved();
  }

  async function runTest() {
    setBusy(true);
    setError('');
    try {
      await commit();
      await bridge.test();
    } catch (cause) {
      setError(bridgeError(cause, 'Não foi possível iniciar o teste.'));
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    setError('');
    try {
      if (status.testing) await bridge.stopTest();
      await commit();
      onClose();
    } catch (cause) {
      setError(bridgeError(cause, 'Não foi possível salvar a configuração.'));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (status.testing) void bridge.stopTest().catch(() => {});
    onClose();
  }

  const groups = useMemo(() => groupByGuild(channels ?? []), [channels]);
  const chosen = channels?.find((channel) => channel.channelId === picked);

  let footer: React.ReactNode;
  if (step === 1) {
    footer = (
      <button type="button" className="ui-btn" onClick={() => setStep(2)}>
        {uiText('Já criei o bot')}
      </button>
    );
  } else if (step === 2) {
    footer = (
      <>
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          onClick={() => setStep(1)}
        >
          {uiText('Voltar')}
        </button>
        <button type="button" className="ui-btn" disabled={!bot} onClick={() => setStep(3)}>
          {uiText('Continuar')}
        </button>
      </>
    );
  } else if (step === 3) {
    footer = (
      <button type="button" className="ui-btn" data-variant="secondary" onClick={() => setStep(2)}>
        {uiText('Voltar')}
      </button>
    );
  } else {
    footer = (
      <>
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          disabled={busy}
          onClick={() => {
            setChannels(null);
            setToken('');
            setBot(null);
            setError('');
            setStep(1);
          }}
        >
          {uiText('Usar outro bot')}
        </button>
        <button
          type="button"
          className="ui-btn"
          disabled={busy || !chosen}
          onClick={() => void finish()}
        >
          {uiText('Concluir')}
        </button>
      </>
    );
  }

  return (
    <Modal
      open={open}
      onClose={cancel}
      size="lg"
      dismissOnBackdrop={false}
      title={uiText('Configurar o rádio no Discord')}
      subtitle={uiText('Passo {0} de 4 · {1}', step, uiText(STEP_NAMES[step - 1]!))}
      footer={footer}
    >
      <ol className="dc-steps" aria-label={uiText('Passos')}>
        {STEP_NAMES.map((name, index) => (
          <li
            key={name}
            className="dc-step"
            data-state={index + 1 < step ? 'done' : index + 1 === step ? 'current' : 'todo'}
            aria-current={index + 1 === step ? 'step' : undefined}
          >
            {uiText(name)}
          </li>
        ))}
      </ol>

      <div className="dc-body">
        {step === 1 && (
          <>
            <p className="dc-lead">
              {uiText(
                'O engenheiro fala por um bot seu, que entra no canal de voz junto com você. Criar o bot leva um minuto.',
              )}
            </p>
            <ol className="dc-howto">
              <li>
                {uiText(
                  'Clique em New Application, dê um nome (por exemplo, Bono Rádio) e confirme.',
                )}
              </li>
              <li>{uiText('No menu da esquerda, abra Bot.')}</li>
              <li>
                {uiText(
                  'Clique em Reset Token e copie o token que aparece. Ele é a senha do bot: guarde só para colar no próximo passo.',
                )}
              </li>
            </ol>
            <div className="dc-tools">
              <button
                type="button"
                className="ui-btn"
                onClick={() =>
                  void bridge
                    .openLink(DISCORD_PORTAL_URL)
                    .catch((cause) =>
                      setError(bridgeError(cause, 'Não consegui abrir o navegador.')),
                    )
                }
              >
                {uiText('Abrir o Discord Developer Portal')}
              </button>
            </div>
          </>
        )}

        {step === 2 && (
          <form className="dc-body" onSubmit={(event) => void validateToken(event)}>
            <p className="dc-lead">
              {uiText(
                'Cole o token do bot. Ele é guardado criptografado neste PC e não aparece de novo na tela.',
              )}
            </p>
            <label className="ui-field">
              <span className="ui-label">{uiText('Token do bot')}</span>
              <input
                className="ui-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                maxLength={200}
                value={token}
                aria-invalid={error ? true : undefined}
                onChange={(event) => {
                  setToken(event.currentTarget.value);
                  setBot(null);
                  setError('');
                }}
              />
            </label>
            <div className="dc-tools">
              <button type="submit" className="ui-btn" disabled={busy || !token.trim()}>
                {busy ? uiText('Validando…') : uiText('Validar token')}
              </button>
            </div>
            {bot && (
              <p className="dc-ok" role="status">
                <Icon name="check" />
                <span>{uiText('Conectado como {0}', bot.botName)}</span>
              </p>
            )}
          </form>
        )}

        {step === 3 && bot && (
          <>
            <p className="dc-lead">
              {uiText(
                'Agora convide o bot para o servidor onde está o seu canal de voz. No Discord, escolha o servidor e confirme.',
              )}
            </p>
            <div className="dc-tools">
              <button
                type="button"
                className="ui-btn"
                onClick={() =>
                  void bridge
                    .openLink(bot.inviteUrl)
                    .catch((cause) =>
                      setError(bridgeError(cause, 'Não consegui abrir o navegador.')),
                    )
                }
              >
                {uiText('Convidar para o meu servidor')}
              </button>
              {error && (
                <button
                  type="button"
                  className="ui-btn"
                  data-variant="secondary"
                  onClick={() => {
                    setError('');
                    setPollKey((key) => key + 1);
                  }}
                >
                  {uiText('Verificar de novo')}
                </button>
              )}
            </div>
            {!error && (
              <p className="dc-wait" role="status">
                <span className="ui-dot" data-tone="warn" aria-hidden="true" />
                {uiText('Esperando o bot aparecer no servidor…')}
              </p>
            )}
          </>
        )}

        {step === 4 && (
          <>
            <p className="dc-lead">
              {uiText(
                'Escolha o canal de voz em que o engenheiro vai falar. Use um canal privado: quem entrar nele ouve o rádio.',
              )}
            </p>
            {channels && channels.length === 0 && (
              <p className="cfg-hint">
                {uiText(
                  'O bot não encontrou canais de voz. Crie um canal de voz no servidor e atualize a lista.',
                )}
              </p>
            )}
            <div className="dc-groups">
              {groups.map(({ guildName, items }) => (
                <section key={guildName}>
                  <h3 className="dc-group-title">{guildName}</h3>
                  <div className="ui-list">
                    {items.map((channel) => (
                      <label
                        key={channel.channelId}
                        className="ui-list-item dc-channel"
                        data-checked={picked === channel.channelId}
                      >
                        <input
                          type="radio"
                          name="dc-channel"
                          className="dc-radio"
                          checked={picked === channel.channelId}
                          disabled={!channel.canSpeak}
                          onChange={() => setPicked(channel.channelId)}
                        />
                        <span className="dc-radio-mark" aria-hidden="true" />
                        <span className="ui-list-text">
                          <span className="ui-list-title">{channel.channelName}</span>
                          {!channel.canSpeak && (
                            <span className="ui-list-desc">{uiText(channel.reason)}</span>
                          )}
                        </span>
                        {!channel.canSpeak && (
                          <span className="ui-badge" data-tone="warn">
                            {uiText('Sem permissão')}
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </section>
              ))}
            </div>
            <div className="dc-tools">
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                data-size="sm"
                disabled={busy}
                onClick={() => void loadChannels()}
              >
                {uiText('Atualizar lista')}
              </button>
            </div>

            {chosen && (
              <div className="dc-test">
                <h3 className="dc-test-title">{uiText('Testar')}</h3>
                <p className="dc-lead">
                  {uiText(
                    'Entre no canal pelo PS5 (Game Base → Discord) e clique em Testar: o bot toca 10 bipes.',
                  )}
                </p>
                <div className="dc-tools">
                  {status.testing ? (
                    <button
                      type="button"
                      className="ui-btn"
                      data-variant="secondary"
                      onClick={() => void bridge.stopTest().catch(() => {})}
                    >
                      {uiText('Encerrar teste')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="ui-btn"
                      disabled={busy}
                      onClick={() => void runTest()}
                    >
                      {uiText('Testar com 10 bipes')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="ui-btn"
                    data-variant="ghost"
                    aria-expanded={calibrate}
                    onClick={() => setCalibrate((value) => !value)}
                  >
                    {uiText('Calibrar o atraso (opcional)')}
                  </button>
                </div>
                <p className="cfg-status" role="status">
                  {uiText(status.message)}
                </p>
                {calibrate && (
                  <label className="ui-field">
                    <span className="ui-label">{uiText('Atraso medido em ms')}</span>
                    <input
                      className="ui-input"
                      maxLength={400}
                      value={delay}
                      placeholder={uiText('Ex.: 280,300,315')}
                      onChange={(event) => setDelay(event.currentTarget.value)}
                    />
                    <span className="ui-help">
                      {uiText(
                        'Filme o celular perto do headset durante os 10 bipes e meça o tempo entre o BIP na tela e o som. Com várias medições separadas por vírgula, o Bono usa o percentil 90. Sem calibrar, o padrão é {0} ms.',
                        DISCORD_DEFAULT_DELAY_MS,
                      )}
                    </span>
                  </label>
                )}
              </div>
            )}
          </>
        )}

        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
