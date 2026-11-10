export interface DesktopDiscordSettings {
  channelId: string;
  driverId: string;
  delay: string;
  enabled: boolean;
  brakePercent: boolean;
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
  test(): Promise<void>;
  stopTest(): Promise<void>;
  remove(): Promise<void>;
  onStatus(callback: (status: DesktopDiscordStatus) => void): () => void;
}
