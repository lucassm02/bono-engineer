import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { DesktopDiscordSettings, DesktopDiscordStatus } from '@gt7/shared';
import { safeStorage } from 'electron';
import { discordConfig } from '../../server/src/discord-radio/config.ts';
import { startDiscordRadio } from '../../server/src/discord-radio/main.ts';
import { radioVoice } from '../../web/src/lib/radioVoices.ts';

type Stored = DesktopDiscordSettings & { encryptedToken: string };
const EMPTY: Stored = {
  channelId: '',
  driverId: '',
  delay: '',
  enabled: false,
  brakePercent: false,
  voice: 'alex',
  encryptedToken: '',
};

export class DesktopDiscord {
  #stop: (() => void) | undefined;
  #generation = 0;
  #status: DesktopDiscordStatus = {
    message: 'Rádio do Discord desligado.',
    error: false,
    testing: false,
  };

  constructor(
    private readonly file: string,
    private readonly radioDir: string,
    private readonly endpoint: () => URL | null,
    private readonly sendStatus: (status: DesktopDiscordStatus) => void,
  ) {}

  #read(): Stored {
    return existsSync(this.file)
      ? { ...EMPTY, ...JSON.parse(readFileSync(this.file, 'utf8')) }
      : EMPTY;
  }

  get() {
    const { channelId, driverId, delay, enabled, brakePercent, voice, encryptedToken } =
      this.#read();
    return {
      settings: { channelId, driverId, delay, enabled, brakePercent, voice },
      hasToken: !!encryptedToken,
      status: this.#status,
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
      BONO_DISCORD_DRIVER_ID: settings.driverId,
      BONO_DISCORD_DELAY_MS: settings.delay,
      BONO_DISCORD_BRAKE_PERCENT: settings.brakePercent ? '1' : '0',
      BONO_DISCORD_VOICE: settings.voice,
    };
  }

  save(input: unknown): void {
    if (!input || typeof input !== 'object') throw new Error('Configuração inválida.');
    const { channelId, driverId, delay, enabled, brakePercent, token, voice } = input as Record<
      string,
      unknown
    >;
    if (
      typeof channelId !== 'string' ||
      typeof driverId !== 'string' ||
      typeof delay !== 'string' ||
      delay.length > 400 ||
      typeof token !== 'string' ||
      token.length > 200 ||
      typeof enabled !== 'boolean' ||
      typeof brakePercent !== 'boolean'
    )
      throw new Error('Confira os campos de configuração do Discord.');

    const settings = {
      channelId: channelId.trim(),
      driverId: driverId.trim(),
      delay: delay.trim(),
      enabled,
      brakePercent,
      voice: typeof voice === 'string' && radioVoice(`radio:${voice}`) ? voice : this.#read().voice,
    };
    this.#checkEncryption();
    const prior = this.#read().encryptedToken;
    const secret =
      token.trim() || (prior ? safeStorage.decryptString(Buffer.from(prior, 'base64')) : '');
    if (
      !secret ||
      !/^\d{17,20}$/.test(settings.channelId) ||
      !/^\d{17,20}$/.test(settings.driverId)
    ) {
      throw new Error('Preencha o token do bot, o ID do canal e o ID da sua conta Discord.');
    }
    discordConfig(this.#env(settings, secret), !enabled);
    const stored: Stored = {
      ...settings,
      encryptedToken: token.trim() ? safeStorage.encryptString(secret).toString('base64') : prior,
    };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(stored), { mode: 0o600 });
    renameSync(tmp, this.file);
    this.resume();
  }

  /** Liga/desliga o rádio já configurado (usado pelo interruptor do painel ao vivo). */
  setEnabled(enabled: unknown): void {
    if (typeof enabled !== 'boolean') throw new Error('Valor inválido.');
    const saved = this.#read();
    if (enabled && (!saved.encryptedToken || !saved.channelId || !saved.driverId))
      throw new Error('Configure o bot do Discord em Configurações antes de ativar.');
    if (enabled && !saved.delay.trim())
      throw new Error('Informe o atraso medido em Configurações → Rádio no Discord.');
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...saved, enabled }), { mode: 0o600 });
    renameSync(tmp, this.file);
    this.resume();
  }

  setVoice(pack: unknown): void {
    if (typeof pack !== 'string' || !radioVoice(`radio:${pack}`))
      throw new Error('Voz do rádio inválida.');
    const saved = this.#read();
    if (!saved.encryptedToken || saved.voice === pack) return;
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ...saved, voice: pack }), { mode: 0o600 });
    renameSync(tmp, this.file);
    if (saved.enabled && !this.#status.testing) this.resume();
  }

  stop(): void {
    this.#generation++;
    this.#stop?.();
    this.#stop = undefined;
  }

  remove(): void {
    rmSync(this.file, { force: true });
    rmSync(`${this.file}.tmp`, { force: true });
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
    if (!saved.encryptedToken) throw new Error('Salve a configuração do bot antes de testar.');
    const endpoint = this.endpoint();
    if (!endpoint) throw new Error('Aguarde o servidor do Bono iniciar.');
    this.#checkEncryption();
    const token = safeStorage.decryptString(Buffer.from(saved.encryptedToken, 'base64'));
    const config = discordConfig(this.#env(saved, token), test);
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
