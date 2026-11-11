import {
  DISCORD_BOT_PERMISSIONS,
  type DiscordBotInfo,
  type DiscordVoiceChannel,
} from '@gt7/shared';
import {
  ChannelType,
  Client,
  DiscordAPIError,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
} from 'discord.js';

/** Forma de um token de bot: ID em base64, carimbo de data e HMAC. */
export const TOKEN_SHAPE = /^[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}$/;

/** Erro com mensagem pronta para a tela (já em pt-BR). */
export class DiscordSetupError extends Error {}

/** Só páginas do Discord que o assistente precisa abrir: portal e convite de bot. */
export function isAllowedDiscordLink(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' &&
    url.hostname === 'discord.com' &&
    !url.username &&
    !url.password &&
    !url.port &&
    (url.pathname === '/oauth2/authorize' ||
      url.pathname === '/developers/applications' ||
      url.pathname === '/developers/applications/')
  );
}

/** O primeiro trecho do token é o ID do bot (= ID da aplicação) em base64. */
export function applicationIdFromToken(token: string): string | null {
  const id = Buffer.from(token.trim().split('.')[0] ?? '', 'base64').toString('utf8');
  return /^\d{17,20}$/.test(id) ? id : null;
}

export function inviteUrl(applicationId: string): string {
  const query = new URLSearchParams({
    client_id: applicationId,
    scope: 'bot',
    permissions: String(DISCORD_BOT_PERMISSIONS),
  });
  return `https://discord.com/oauth2/authorize?${query}`;
}

async function fetchBotUser(token: string): Promise<{ username: string }> {
  const rest = new REST({ version: '10' }).setToken(token);
  return (await rest.get(Routes.user('@me'))) as { username: string };
}

/**
 * Valida o token no Discord (consulta REST, sem abrir o gateway) e devolve o nome do bot, o ID da
 * aplicação e o link de convite. O token nunca é registrado nem devolvido.
 */
export async function inspectToken(
  input: string,
  fetchBot: (token: string) => Promise<{ username: string }> = fetchBotUser,
): Promise<DiscordBotInfo> {
  const token = input.trim();
  const applicationId = TOKEN_SHAPE.test(token) ? applicationIdFromToken(token) : null;
  if (!applicationId) {
    throw new DiscordSetupError(
      'Isso não parece um token de bot. Copie o token inteiro em Bot → Reset Token.',
    );
  }
  let bot: { username: string };
  try {
    bot = await fetchBot(token);
  } catch (error) {
    if (error instanceof DiscordAPIError && (error.status === 401 || error.status === 403)) {
      throw new DiscordSetupError(
        'O Discord recusou o token. Ele pode ter sido trocado: gere outro em Bot → Reset Token.',
      );
    }
    throw new DiscordSetupError(
      'Não consegui falar com o Discord. Confira a conexão e tente de novo.',
    );
  }
  return { botName: bot.username, applicationId, inviteUrl: inviteUrl(applicationId) };
}

/** Mensagem acionável para uma falha de login do bot (token revogado, intent desligada...). */
export function loginErrorMessage(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'TokenInvalid')
    return 'O Discord recusou o token (revogado ou trocado). Gere outro em Bot → Reset Token e configure de novo.';
  if (code === 'DisallowedIntents')
    return 'O bot não tem a permissão de voz habilitada no Developer Portal. Confira as intents em Bot.';
  return 'Falha no login do bot. Confira o token e a conexão com o Discord.';
}

export const VOICE_PERMISSIONS: ReadonlyArray<readonly [bigint, string]> = [
  [PermissionFlagsBits.ViewChannel, 'Ver canal'],
  [PermissionFlagsBits.Connect, 'Conectar'],
  [PermissionFlagsBits.Speak, 'Falar'],
];

/** Nomes (pt-BR) das permissões de voz que o bot ainda não tem no canal. */
export function missingVoicePermissions(has: (flag: bigint) => boolean): string[] {
  return VOICE_PERMISSIONS.filter(([flag]) => !has(flag)).map(([, name]) => name);
}

export function permissionReason(missing: readonly string[]): string {
  return missing.length
    ? `Sem permissão: falta ${missing.join(', ')}. Dê ao bot Ver canal, Conectar e Falar neste canal.`
    : '';
}

const IDLE_MS = 20_000;
const READY_TIMEOUT_MS = 20_000;

/**
 * Lista os canais de voz dos servidores do bot. Mantém uma conexão de inspeção aberta só enquanto o
 * assistente consulta (o passo 3 repete a consulta a cada 3 s) e a encerra após alguns segundos
 * parada ou ao chamar `close()`, para não gastar logins do Discord.
 */
export class VoiceChannelLister {
  #client: Client | undefined;
  #ready: Promise<Client> | undefined;
  #token = '';
  #idle: NodeJS.Timeout | undefined;

  async list(token: string): Promise<DiscordVoiceChannel[]> {
    clearTimeout(this.#idle);
    try {
      const client = await this.#connect(token);
      return await this.#rows(client);
    } finally {
      if (this.#client) {
        this.#idle = setTimeout(() => this.close(), IDLE_MS);
        this.#idle.unref();
      }
    }
  }

  close(): void {
    clearTimeout(this.#idle);
    this.#client?.destroy();
    this.#client = undefined;
    this.#ready = undefined;
    this.#token = '';
  }

  #connect(token: string): Promise<Client> {
    if (this.#client && this.#token !== token) this.close();
    if (this.#ready) return this.#ready;
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    client.on('error', () => {});
    this.#client = client;
    this.#token = token;
    const ready = new Promise<Client>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new DiscordSetupError('O Discord demorou a responder. Tente de novo.')),
        READY_TIMEOUT_MS,
      );
      client.once(Events.ClientReady, () => {
        clearTimeout(timer);
        resolve(client);
      });
      client.login(token).catch((error: unknown) => {
        clearTimeout(timer);
        reject(new DiscordSetupError(loginErrorMessage(error)));
      });
    });
    this.#ready = ready;
    ready.catch(() => {
      if (this.#ready === ready) this.close();
    });
    return ready;
  }

  async #rows(client: Client): Promise<DiscordVoiceChannel[]> {
    const rows: DiscordVoiceChannel[] = [];
    const guilds = [...client.guilds.cache.values()].sort((a, b) => a.name.localeCompare(b.name));
    for (const guild of guilds) {
      const me = guild.members.me ?? (await guild.members.fetchMe().catch(() => null));
      const channels = [...guild.channels.cache.values()]
        .filter((channel) => channel.type === ChannelType.GuildVoice)
        .sort((a, b) => a.rawPosition - b.rawPosition);
      for (const channel of channels) {
        const granted = me ? channel.permissionsFor(me) : null;
        const missing = granted
          ? missingVoicePermissions((flag) => granted.has(flag))
          : VOICE_PERMISSIONS.map(([, name]) => name);
        rows.push({
          guildName: guild.name,
          channelId: channel.id,
          channelName: channel.name,
          canSpeak: missing.length === 0,
          reason: permissionReason(missing),
        });
      }
    }
    return rows;
  }
}
