/** Identificador do aparelho "Discord · PS5" (o bot se registra no servidor com este id). */
export const DISCORD_RADIO_DEVICE_ID = 'bono-discord-radio';

export interface DesktopDiscordSettings {
  channelId: string;
  driverId: string;
  delay: string;
  enabled: boolean;
  brakePercent: boolean;
  voice: string;
}

export interface DesktopDiscordStatus {
  message: string;
  error: boolean;
  testing: boolean;
}

export interface DesktopDiscordBridge {
  get(): Promise<{
    settings: DesktopDiscordSettings;
    hasToken: boolean;
    status: DesktopDiscordStatus;
  }>;
  save(settings: DesktopDiscordSettings & { token: string }): Promise<void>;
  /** Liga ou desliga o bot salvo, sem reabrir as configurações. Falha se ainda não houver configuração. */
  setEnabled(enabled: boolean): Promise<void>;
  setVoice(pack: string): Promise<void>;
  test(): Promise<void>;
  stopTest(): Promise<void>;
  remove(): Promise<void>;
  onStatus(callback: (status: DesktopDiscordStatus) => void): () => void;
}
