/** Identificador do aparelho "Discord · PS5" (o bot se registra no servidor com este id). */
export const DISCORD_RADIO_DEVICE_ID = 'bono-discord-radio';

/** Atraso usado quando a pessoa ainda não calibrou: evita bloquear a transmissão. */
export const DISCORD_DEFAULT_DELAY_MS = 300;

/** Ver canal (1024) + Conectar (1048576) + Falar (2097152): o mínimo para o bot falar no canal. */
export const DISCORD_BOT_PERMISSIONS = 3146752;

export const DISCORD_PORTAL_URL = 'https://discord.com/developers/applications';

export interface DesktopDiscordSettings {
  channelId: string;
  /** Opcional (avançado): se preenchido, o bot só entra quando este usuário está no canal. */
  followUserId: string;
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

/** Resumo não secreto do que está salvo, para mostrar sem reiniciar o assistente. */
export interface DesktopDiscordSummary {
  botName: string;
  guildName: string;
  channelName: string;
  /** Últimos 4 caracteres do token salvo. O token inteiro nunca volta para a tela. */
  tokenTail: string;
}

export interface DiscordBotInfo {
  botName: string;
  applicationId: string;
  inviteUrl: string;
}

export interface DiscordVoiceChannel {
  guildName: string;
  channelId: string;
  channelName: string;
  canSpeak: boolean;
  /** Quando `canSpeak` é falso: o que falta e como resolver. */
  reason: string;
}

export interface DesktopDiscordBridge {
  get(): Promise<{
    settings: DesktopDiscordSettings;
    hasToken: boolean;
    status: DesktopDiscordStatus;
    summary: DesktopDiscordSummary;
  }>;
  /** `token` vazio mantém o token salvo (ou o último validado por `inspectToken`). */
  save(settings: DesktopDiscordSettings & { token: string }): Promise<void>;
  /** Liga ou desliga o bot salvo, sem reabrir as configurações. Falha se ainda não houver configuração. */
  setEnabled(enabled: boolean): Promise<void>;
  setVoice(pack: string): Promise<void>;
  test(): Promise<void>;
  stopTest(): Promise<void>;
  remove(): Promise<void>;
  /** Valida o token no Discord e devolve o nome do bot e o link de convite. */
  inspectToken(token: string): Promise<DiscordBotInfo>;
  /** Canais de voz dos servidores onde o bot já está (usa o token validado ou o salvo). */
  listVoiceChannels(): Promise<DiscordVoiceChannel[]>;
  /** Abre no navegador do sistema o portal do Discord ou um convite de bot (só discord.com). */
  openLink(url: string): Promise<void>;
  onStatus(callback: (status: DesktopDiscordStatus) => void): () => void;
}

/** Arquivo salvo no PC (token já cifrado). */
export interface StoredDiscordConfig extends DesktopDiscordSettings, DesktopDiscordSummary {
  encryptedToken: string;
}

export const EMPTY_DISCORD_CONFIG: StoredDiscordConfig = {
  channelId: '',
  followUserId: '',
  delay: '',
  enabled: false,
  brakePercent: false,
  voice: 'alex',
  botName: '',
  guildName: '',
  channelName: '',
  tokenTail: '',
  encryptedToken: '',
};

/**
 * Lê o arquivo salvo, aceitando versões antigas: o campo `driverId` (ID do piloto) deixou de existir
 * e é ignorado; campos ausentes ou com tipo errado voltam ao padrão em vez de impedir a abertura.
 */
export function migrateDiscordConfig(value: unknown): StoredDiscordConfig {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const text = (key: keyof StoredDiscordConfig) =>
    typeof raw[key] === 'string' ? (raw[key] as string) : EMPTY_DISCORD_CONFIG[key];
  const flag = (key: 'enabled' | 'brakePercent') =>
    typeof raw[key] === 'boolean' ? (raw[key] as boolean) : EMPTY_DISCORD_CONFIG[key];
  return {
    channelId: text('channelId') as string,
    followUserId: text('followUserId') as string,
    delay: text('delay') as string,
    enabled: flag('enabled'),
    brakePercent: flag('brakePercent'),
    voice: text('voice') as string,
    botName: text('botName') as string,
    guildName: text('guildName') as string,
    channelName: text('channelName') as string,
    tokenTail: text('tokenTail') as string,
    encryptedToken: text('encryptedToken') as string,
  };
}
