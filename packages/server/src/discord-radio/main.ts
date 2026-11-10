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
import { DISCORD_DEVICE_ID, type discordConfig } from './config.ts';

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

  function syncVoice(): void {
    if (!channel || closing) return;
    const driverChannel = channel.guild.voiceStates.cache.get(config.driverId)?.channelId;
    if (driverChannel !== channel.id) {
      if (voice) {
        stopRadio('piloto saiu do Discord');
        if (voice.state.status !== VoiceConnectionStatus.Destroyed) voice.destroy();
        voice = undefined;
        report('Aguardando o piloto no canal.');
      }
      return;
    }
    if (voice?.state.status === VoiceConnectionStatus.Disconnected) {
      voice.rejoin();
      return;
    }
    if (voice && voice.state.status !== VoiceConnectionStatus.Destroyed) return;
    voice = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
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
        outputLatencyMs: config.delayMs ?? 0,
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
  const reconnect = setInterval(syncVoice, 5000);
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
  client.on(Events.VoiceStateUpdate, (_before, after) => {
    if (after.id === config.driverId && after.guild.id === channel?.guild.id) syncVoice();
  });
  client.once(Events.ClientReady, async (connectedClient) => {
    try {
      const candidate = await client.channels.fetch(config.channelId);
      if (closing) return;
      if (candidate?.type !== ChannelType.GuildVoice) throw new Error();
      if (
        !candidate
          .permissionsFor(connectedClient.user)
          ?.has([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.Speak,
          ])
      )
        throw new Error();
      channel = candidate;
      report(
        test
          ? 'Teste pronto. Entre no canal pelo PS5.'
          : `Aguardando o piloto. Margem de áudio: ${config.delayMs} ms.`,
      );
      syncVoice();
      if (!test) connectBono();
    } catch {
      if (!closing) report('Confira o ID do canal e as permissões do bot.', true);
      close();
    }
  });
  void client.login(config.token).catch(() => {
    if (!closing) report('Falha no login do bot. Confira o token e a conexão com o Discord.', true);
    close();
  });
  return close;
}
