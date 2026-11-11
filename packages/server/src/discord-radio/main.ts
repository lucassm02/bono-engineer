import type { Readable } from 'node:stream';
import {
  AudioPlayerStatus,
  createAudioPlayer,
  createAudioResource,
  joinVoiceChannel,
  NoSubscriberBehavior,
  StreamType,
  type VoiceConnection,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import {
  type HelloMessage,
  RADIO_STALE_MS,
  RadioEngine,
  type ServerMessage,
  WS_PROTOCOL_VERSION,
} from '@gt7/shared';
import {
  ChannelType,
  Client,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  type VoiceChannel,
} from 'discord.js';
import { calibrationTone, radioAudio } from './audio.ts';
import {
  type ChannelOccupant,
  DISCORD_DEVICE_ID,
  type discordConfig,
  shouldJoinChannel,
} from './config.ts';
import { loginErrorMessage } from './inspect.ts';

export function startDiscordRadio(
  config: ReturnType<typeof discordConfig>,
  test: boolean,
  report: (message: string, error?: boolean) => void,
  radioDir?: string,
): () => void {
  const audio = test ? null : radioAudio(config.voice, config.volume, radioDir);
  const engine = new RadioEngine({
    config: config.engine,
    utteranceMs: (phrase) => audio?.durationMs(phrase) ?? null,
  });
  const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Stop } });
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });
  let channel: VoiceChannel | undefined;
  let voice: VoiceConnection | undefined;
  let socket: WebSocket | undefined;
  let retry: NodeJS.Timeout | undefined;
  let closing = false;
  let selected = false;
  let lastFrameAt = 0;
  let warnedBono = false;
  let beeps = 0;
  let nextBeepAt = 0;

  const stopRadio = (reason: string) => {
    engine.suspend(reason);
    player.stop(true);
  };
  const ready = () => voice?.state.status === VoiceConnectionStatus.Ready;
  const play = (stream: Readable) => {
    player.play(createAudioResource(stream, { inputType: StreamType.Raw }));
  };
  const playbackError = () => {
    engine.playbackFailed();
    report('Falha na reprodução.', true);
  };

  const botFlags = new Map<string, boolean>();
  /** Quem está no canal agora (sem o próprio bot). Descobre se é bot buscando o membro uma vez. */
  async function occupants(target: VoiceChannel): Promise<ChannelOccupant[]> {
    const states = target.guild.voiceStates.cache.filter(
      (state) => state.channelId === target.id && state.id !== client.user?.id,
    );
    return Promise.all(
      [...states.values()].map(async (state) => {
        const known = state.member?.user.bot ?? botFlags.get(state.id);
        if (known !== undefined) {
          botFlags.set(state.id, known);
          return { id: state.id, bot: known };
        }
        const member = await target.guild.members.fetch(state.id).catch(() => null);
        const bot = member?.user.bot ?? false;
        if (member) botFlags.set(state.id, bot);
        return { id: state.id, bot };
      }),
    );
  }

  let syncing = false;
  let syncAgain = false;
  /** Entra quando há alguém no canal e sai quando esvazia; chamadas simultâneas viram uma só. */
  async function syncVoice(): Promise<void> {
    if (syncing) {
      syncAgain = true;
      return;
    }
    syncing = true;
    try {
      do {
        syncAgain = false;
        if (channel && !closing) joinOrLeave(channel, await occupants(channel));
      } while (syncAgain && !closing);
    } finally {
      syncing = false;
    }
  }

  function joinOrLeave(target: VoiceChannel, people: ChannelOccupant[]): void {
    if (!shouldJoinChannel(people, config.followUserId)) {
      if (voice) {
        stopRadio('canal vazio');
        if (voice.state.status !== VoiceConnectionStatus.Destroyed) voice.destroy();
        voice = undefined;
        report(
          config.followUserId
            ? 'Aguardando o piloto escolhido entrar no canal.'
            : 'Aguardando alguém no canal. Entre no canal pelo PS5.',
        );
      }
      return;
    }
    if (voice?.state.status === VoiceConnectionStatus.Disconnected) {
      voice.rejoin();
      return;
    }
    if (voice && voice.state.status !== VoiceConnectionStatus.Destroyed) return;
    voice = joinVoiceChannel({
      channelId: target.id,
      guildId: target.guild.id,
      adapterCreator: target.guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false,
    });
    voice.on('error', () => stopRadio('erro na conexão de voz'));
    voice.on('stateChange', (before, after) => {
      if (after.status === VoiceConnectionStatus.Ready) {
        if (test) nextBeepAt = Date.now() + 1500;
        report('Rádio conectado ao Discord.');
      } else if (before.status === VoiceConnectionStatus.Ready) {
        stopRadio('conexão de voz interrompida');
      }
    });
    voice.subscribe(player);
  }

  function connectBono(): void {
    if (closing) return;
    const connection = new WebSocket(config.bonoUrl);
    socket = connection;
    connection.addEventListener('open', () => {
      warnedBono = false;
      const hello: HelloMessage = {
        type: 'hello',
        protocolVersion: WS_PROTOCOL_VERSION,
        deviceId: DISCORD_DEVICE_ID,
        deviceName: 'Discord · PS5',
      };
      connection.send(JSON.stringify(hello));
    });
    connection.addEventListener('message', ({ data }) => {
      if (closing || typeof data !== 'string') return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(data) as ServerMessage;
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'status') {
        const next = msg.status.engineerAudioDeviceId === DISCORD_DEVICE_ID;
        if (selected && !next) stopRadio('outra saída selecionada');
        selected = next;
      }
      if (msg.type !== 'frame' || !selected || !ready() || config.volume === 0) return;
      lastFrameAt = Date.now();
      const result = engine.step(msg.frame, {
        audio: 'ready',
        sampleAgeMs: Math.max(0, lastFrameAt - msg.frame.t),
        outputLatencyMs: config.delayMs,
      });
      if (result.stop) player.stop(true);
      const speech = result.speak;
      if (!speech) return;
      const stream = audio?.stream(speech.utterance);
      if (!stream || (!speech.interrupt && player.state.status !== AudioPlayerStatus.Idle)) {
        engine.playbackFailed();
        return;
      }
      try {
        play(stream);
      } catch {
        playbackError();
      }
    });
    connection.addEventListener('error', () => {
      if (!warnedBono && !closing) {
        warnedBono = true;
        report('Aguardando conexão com o Bono. Confira a porta e o acesso local.', true);
      }
    });
    connection.addEventListener('close', () => {
      selected = false;
      stopRadio('conexão com o Bono interrompida');
      if (!closing) retry = setTimeout(connectBono, 2000);
    });
  }

  const watchdog = setInterval(() => {
    const now = Date.now();
    if (!test && lastFrameAt && now - lastFrameAt > RADIO_STALE_MS) {
      stopRadio('telemetria desatualizada');
      lastFrameAt = 0;
    }
    if (test && ready() && beeps < 10 && now >= nextBeepAt) {
      const tone = calibrationTone();
      report(`BIP ${++beeps}/10 · ${new Date().toISOString()}`);
      try {
        play(tone);
      } catch {
        playbackError();
      }
      nextBeepAt = now + 2500;
    }
  }, 50);
  const reconnect = setInterval(() => void syncVoice(), 5000);
  const close = () => {
    if (closing) return;
    closing = true;
    clearInterval(watchdog);
    clearInterval(reconnect);
    clearTimeout(retry);
    socket?.close();
    player.stop(true);
    if (voice && voice.state.status !== VoiceConnectionStatus.Destroyed) voice.destroy();
    client.destroy();
  };
  player.on('error', playbackError);
  client.on('error', () => report('Erro na conexão do bot.', true));
  client.on(Events.VoiceStateUpdate, (before, after) => {
    // Qualquer pessoa entrando ou saindo do canal configurado reavalia se o bot deve estar nele.
    if (channel && (before.channelId === channel.id || after.channelId === channel.id))
      void syncVoice();
  });
  client.on(Events.ChannelDelete, (deleted) => {
    if (deleted.id !== channel?.id || closing) return;
    report('O canal de voz foi apagado. Reconfigure o Discord e escolha outro canal.', true);
    close();
  });
  client.once(Events.ClientReady, async (connectedClient) => {
    const fail = (message: string): void => {
      if (!closing) report(message, true);
      close();
    };
    const candidate = await client.channels.fetch(config.channelId).catch(() => null);
    if (closing) return;
    if (candidate?.type !== ChannelType.GuildVoice) {
      fail(
        'O canal de voz não existe mais ou o bot saiu do servidor. Reconfigure o Discord e escolha o canal.',
      );
      return;
    }
    const granted = candidate.permissionsFor(connectedClient.user);
    if (
      !granted?.has([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
      ])
    ) {
      fail('O bot está sem permissão no canal. Dê a ele Ver canal, Conectar e Falar.');
      return;
    }
    channel = candidate;
    report(
      test
        ? 'Teste pronto. Entre no canal pelo PS5.'
        : config.delayCalibrated
          ? `Aguardando alguém no canal. Margem de áudio: ${config.delayMs} ms.`
          : `Aguardando alguém no canal. Atraso padrão de ${config.delayMs} ms: o som pode chegar um pouco depois; calibre para sincronizar.`,
    );
    void syncVoice();
    if (!test) connectBono();
  });
  void client.login(config.token).catch((error: unknown) => {
    if (!closing) report(loginErrorMessage(error), true);
    close();
  });
  return close;
}
