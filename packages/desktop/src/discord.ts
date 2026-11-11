import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import {
  type DesktopDiscordSettings,
  type DesktopDiscordStatus,
  type DesktopDiscordSummary,
  type DiscordBotInfo,
  type DiscordVoiceChannel,
  EMPTY_DISCORD_CONFIG,
  migrateDiscordConfig,
  type StoredDiscordConfig,
} from '@gt7/shared';
import { safeStorage, shell } from 'electron';
import { DISCORD_ID, discordConfig } from '../../server/src/discord-radio/config.ts';
import {
  DiscordSetupError,
  inspectToken,
  isAllowedDiscordLink,
  loginErrorMessage,
  VoiceChannelLister,
} from '../../server/src/discord-radio/inspect.ts';
import { startDiscordRadio } from '../../server/src/discord-radio/main.ts';
import { radioVoice } from '../../web/src/lib/radioVoices.ts';

export class DesktopDiscord {
  #stop: (() => void) | undefined;
  #generation = 0;
  #status: DesktopDiscordStatus = {
    message: 'Rádio do Discord desligado.',
    error: false,
    testing: false,
  };
  /**
   * Token validado pelo assistente, usado só para listar os canais. Fica na memória deste processo,
   * nunca é gravado nem devolvido à tela, e é descartado por `get()` (a tela chama `get()` ao
   * abrir), `save()`, `remove()` e `stop()`.
   */
  #draft: { token: string; botName: string } | undefined;
  /** Servidor e canal vistos na última listagem, para guardar os nomes ao salvar. */
  #seen = new Map<string, { guildName: string; channelName: string }>();
  readonly #lister = new VoiceChannelLister();

  constructor(
    private readonly file: string,
    private readonly radioDir: string,
    private readonly endpoint: () => URL | null,
    private readonly sendStatus: (status: DesktopDiscordStatus) => void,
  ) {}

  #read(): StoredDiscordConfig {
    if (!existsSync(this.file)) return EMPTY_DISCORD_CONFIG;
    try {
      return migrateDiscordConfig(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      return EMPTY_DISCORD_CONFIG;
    }
  }

  #write(stored: StoredDiscordConfig): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(stored), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  get(): {
    settings: DesktopDiscordSettings;
    hasToken: boolean;
    status: DesktopDiscordStatus;
    summary: DesktopDiscordSummary;
  } {
    this.#draft = undefined;
    const {
      channelId,
      followUserId,
      delay,
      enabled,
      brakePercent,
      voice,
      encryptedToken,
      botName,
      guildName,
      channelName,
      tokenTail,
    } = this.#read();
    return {
      settings: { channelId, followUserId, delay, enabled, brakePercent, voice },
      hasToken: !!encryptedToken,
      status: this.#status,
      summary: { botName, guildName, channelName, tokenTail },
    };
  }

  #publish(message: string, error = false, testing = false): void {
    this.#status = { message, error, testing };
    this.sendStatus(this.#status);
  }

  #checkEncryption(): void {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
    ) {
      throw new Error('O armazenamento seguro do sistema não está disponível.');
    }
  }

  #env(settings: DesktopDiscordSettings, token: string): NodeJS.ProcessEnv {
    return {
      BONO_DISCORD_TOKEN: token,
      BONO_DISCORD_CHANNEL_ID: settings.channelId,
      BONO_DISCORD_FOLLOW_USER_ID: settings.followUserId,
      BONO_DISCORD_DELAY_MS: settings.delay,
      BONO_DISCORD_BRAKE_PERCENT: settings.brakePercent ? '1' : '0',
      BONO_DISCORD_VOICE: settings.voice,
    };
  }

  #savedToken(): string {
    const { encryptedToken } = this.#read();
    this.#checkEncryption();
    return encryptedToken ? safeStorage.decryptString(Buffer.from(encryptedToken, 'base64')) : '';
  }

  /** Valida o token no Discord. Se for válido, guarda na memória para as próximas etapas do assistente. */
  async inspectToken(input: unknown): Promise<DiscordBotInfo> {
    if (typeof input !== 'string' || input.length > 200) throw new Error('Token inválido.');
    const info = await inspectToken(input);
    this.#draft = { token: input.trim(), botName: info.botName };
    return info;
  }

  async listVoiceChannels(): Promise<DiscordVoiceChannel[]> {
    const token = this.#draft?.token || this.#savedToken();
    if (!token) throw new Error('Cole o token do bot primeiro.');
    try {
      const channels = await this.#lister.list(token);
      this.#seen = new Map(
        channels.map((channel) => [
          channel.channelId,
          { guildName: channel.guildName, channelName: channel.channelName },
        ]),
      );
      return channels;
    } catch (error) {
      throw error instanceof DiscordSetupError ? error : new Error(loginErrorMessage(error));
    }
  }

  async openLink(url: unknown): Promise<void> {
    if (typeof url !== 'string' || !isAllowedDiscordLink(url))
      throw new Error('Link não permitido.');
    await shell.openExternal(url);
  }

  save(input: unknown): void {
    if (!input || typeof input !== 'object') throw new Error('Configuração inválida.');
    const { channelId, followUserId, delay, enabled, brakePercent, token, voice } = input as Record<
      string,
      unknown
    >;
    if (
      typeof channelId !== 'string' ||
      typeof delay !== 'string' ||
      delay.length > 400 ||
      (followUserId !== undefined && typeof followUserId !== 'string') ||
      typeof token !== 'string' ||
      token.length > 200 ||
      typeof enabled !== 'boolean' ||
      typeof brakePercent !== 'boolean'
    )
      throw new Error('Confira os campos de configuração do Discord.');

    const prior = this.#read();
    const settings: DesktopDiscordSettings = {
      channelId: channelId.trim(),
      followUserId: (followUserId ?? '').trim(),
      delay: delay.trim(),
      enabled,
      brakePercent,
      voice: typeof voice === 'string' && radioVoice(`radio:${voice}`) ? voice : prior.voice,
    };
    this.#checkEncryption();
    const typed = token.trim();
    const secret =
      typed ||
      (prior.encryptedToken
        ? safeStorage.decryptString(Buffer.from(prior.encryptedToken, 'base64'))
        : '');
    if (!secret || !DISCORD_ID.test(settings.channelId)) {
      throw new Error('Cole o token do bot e escolha o canal de voz.');
    }
    if (settings.followUserId && !DISCORD_ID.test(settings.followUserId)) {
      throw new Error('O ID do usuário a seguir deve ter de 17 a 20 dígitos.');
    }
    discordConfig(this.#env(settings, secret));
    const seen = this.#seen.get(settings.channelId);
    const sameChannel = prior.channelId === settings.channelId;
    this.#write({
      ...settings,
      encryptedToken: typed
        ? safeStorage.encryptString(secret).toString('base64')
        : prior.encryptedToken,
      tokenTail: secret.slice(-4),
      botName: !typed ? prior.botName : this.#draft?.token === typed ? this.#draft.botName : '',
      guildName: seen?.guildName ?? (sameChannel ? prior.guildName : ''),
      channelName: seen?.channelName ?? (sameChannel ? prior.channelName : ''),
    });
    this.#draft = undefined;
    this.#lister.close();
    this.resume();
  }

  /** Liga/desliga o rádio já configurado (usado pelo interruptor do painel ao vivo). */
  setEnabled(enabled: unknown): void {
    if (typeof enabled !== 'boolean') throw new Error('Valor inválido.');
    const saved = this.#read();
    if (enabled && (!saved.encryptedToken || !saved.channelId))
      throw new Error('Configure o bot do Discord em Configurações antes de ativar.');
    this.#write({ ...saved, enabled });
    this.resume();
  }

  setVoice(pack: unknown): void {
    if (typeof pack !== 'string' || !radioVoice(`radio:${pack}`))
      throw new Error('Voz do rádio inválida.');
    const saved = this.#read();
    if (!saved.encryptedToken || saved.voice === pack) return;
    this.#write({ ...saved, voice: pack });
    if (saved.enabled && !this.#status.testing) this.resume();
  }

  stop(): void {
    this.#draft = undefined;
    this.#generation++;
    this.#stop?.();
    this.#stop = undefined;
    this.#lister.close();
  }

  remove(): void {
    rmSync(this.file, { force: true });
    rmSync(`${this.file}.tmp`, { force: true });
    this.#draft = undefined;
    this.stop();
    this.#publish('Configuração e token do Discord removidos.');
  }

  resume(): void {
    try {
      this.#start(false);
    } catch {
      this.#publish('Confira a configuração e o token salvos no Bono.', true);
    }
  }

  test(): void {
    this.#start(true);
  }

  #start(test: boolean): void {
    const saved = this.#read();
    if (!test && !saved.enabled) {
      this.stop();
      this.#publish('Rádio do Discord desligado.');
      return;
    }
    if (!saved.encryptedToken || !saved.channelId)
      throw new Error('Salve a configuração do bot antes de testar.');
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('Aguarde o servidor do Bono iniciar.');
    this.#checkEncryption();
    const token = safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64'));
    const config = discordConfig(this.#env(saved, token));
    this.stop();
    const generation = this.#generation;
    this.#publish('Conectando ao Discord…', false, test);
    this.#stop = startDiscordRadio(
      { ...config, bonoUrl: endpoint },
      test,
      (message, error) => {
        if (generation === this.#generation) this.#publish(message, error, test);
      },
      this.radioDir,
    );
  }
}
