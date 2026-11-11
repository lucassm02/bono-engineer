import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { createAudioResource, StreamType } from '@discordjs/voice';
import {
  DISCORD_BOT_PERMISSIONS,
  DISCORD_DEFAULT_DELAY_MS,
  EMPTY_DISCORD_CONFIG,
  migrateDiscordConfig,
} from '@gt7/shared';
import { detailedBrakeUtterance } from '@gt7/shared/radio-phrases';
import { DiscordAPIError, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { calibrationTone, radioAudio } from './audio.ts';
import { calibratedDelay, discordConfig, shouldJoinChannel } from './config.ts';
import {
  applicationIdFromToken,
  DiscordSetupError,
  inspectToken,
  isAllowedDiscordLink,
  missingVoicePermissions,
  permissionReason,
  TOKEN_SHAPE,
} from './inspect.ts';

// Montado em tempo de execução: nenhum token (nem de mentira) pode existir como texto no repositório.
const APPLICATION_ID = '123456789012345678';
const FAKE_TOKEN = [
  Buffer.from(APPLICATION_ID).toString('base64url'),
  'a'.repeat(6),
  'b'.repeat(27),
].join('.');
const CHANNEL_ID = '223456789012345678';
const baseEnv = { BONO_DISCORD_TOKEN: FAKE_TOKEN, BONO_DISCORD_CHANNEL_ID: CHANNEL_ID };

describe('rádio do Discord', () => {
  it('uses the 90th percentile of the headset measurements', () => {
    expect(calibratedDelay('300,220,280,500,270,290,310,260,305,295')).toBe(310);
    expect(calibratedDelay(undefined)).toBeNull();
    expect(() => calibratedDelay('280,')).toThrow();
    expect(() => calibratedDelay('1600')).toThrow();
  });

  it.each(['alex', 'en-michael', 'es-alex'])(
    'matches the clip duration to the PCM sent to Discord for %s',
    async (pack) => {
      const radio = radioAudio(pack, 0.5);
      const phrase = detailedBrakeUtterance(50, 100);
      const pcm = await buffer(radio.stream(phrase)!);
      expect(pcm.length).toBeGreaterThan(0);
      expect(pcm.length / 192).toBe(radio.durationMs(phrase));
      expect(radio.stream('inexistente')).toBeNull();
      expect(await buffer(calibrationTone())).toHaveLength(19_200);
    },
  );

  it('encodes the calibration tone as Opus with the installed voice dependencies', async () => {
    const resource = createAudioResource(calibrationTone(), { inputType: StreamType.Raw });
    const encoded = await buffer(resource.playStream);
    expect(encoded.length).toBeGreaterThan(0);
  });

  it('uses the default delay when not calibrated and lets the measured value win', () => {
    const fresh = discordConfig(baseEnv);
    expect(fresh.delayMs).toBe(DISCORD_DEFAULT_DELAY_MS);
    expect(fresh.delayMs).toBe(300);
    expect(fresh.delayCalibrated).toBe(false);
    const measured = discordConfig({ ...baseEnv, BONO_DISCORD_DELAY_MS: '220,260,240' });
    expect(measured.delayMs).toBe(260);
    expect(measured.delayCalibrated).toBe(true);
  });

  it('no longer asks for the driver user id, and only validates the optional follow id', () => {
    expect(discordConfig({ ...baseEnv, BONO_DISCORD_DRIVER_ID: 'ignorado' }).followUserId).toBe('');
    expect(
      discordConfig({ ...baseEnv, BONO_DISCORD_FOLLOW_USER_ID: CHANNEL_ID }).followUserId,
    ).toBe(CHANNEL_ID);
    expect(() => discordConfig({ ...baseEnv, BONO_DISCORD_FOLLOW_USER_ID: 'abc' })).toThrow();
    expect(() => discordConfig({ BONO_DISCORD_TOKEN: FAKE_TOKEN })).toThrow();
  });
});

describe('entrada e saída do bot no canal', () => {
  const person = (id: string) => ({ id, bot: false });
  const bot = (id: string) => ({ id, bot: true });

  it('stays out of an empty channel and joins once anyone is there', () => {
    expect(shouldJoinChannel([])).toBe(false);
    expect(shouldJoinChannel([person('1')])).toBe(true);
    expect(shouldJoinChannel([person('1'), person('2')])).toBe(true);
  });

  it('does not count other bots', () => {
    expect(shouldJoinChannel([bot('9')])).toBe(false);
    expect(shouldJoinChannel([bot('9'), person('1')])).toBe(true);
  });

  it('can follow a single user when asked', () => {
    expect(shouldJoinChannel([person('1'), person('2')], '2')).toBe(true);
    expect(shouldJoinChannel([person('1')], '2')).toBe(false);
    expect(shouldJoinChannel([bot('2')], '2')).toBe(false);
  });
});

describe('assistente: token e convite', () => {
  const fetchBot = async () => ({ username: 'Bono Rádio' });

  it('derives the application id from the first token segment', () => {
    expect(TOKEN_SHAPE.test(FAKE_TOKEN)).toBe(true);
    expect(applicationIdFromToken(FAKE_TOKEN)).toBe(APPLICATION_ID);
    expect(applicationIdFromToken('lixo')).toBeNull();
  });

  it('returns the bot name and an invite with the voice permissions', async () => {
    const info = await inspectToken(`  ${FAKE_TOKEN}\n`, fetchBot);
    expect(info.botName).toBe('Bono Rádio');
    expect(info.applicationId).toBe(APPLICATION_ID);
    const invite = new URL(info.inviteUrl);
    expect(invite.origin + invite.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(invite.searchParams.get('client_id')).toBe(APPLICATION_ID);
    expect(invite.searchParams.get('scope')).toBe('bot');
    expect(invite.searchParams.get('permissions')).toBe('3146752');
    expect(DISCORD_BOT_PERMISSIONS).toBe(
      Number(
        PermissionFlagsBits.ViewChannel | PermissionFlagsBits.Connect | PermissionFlagsBits.Speak,
      ),
    );
    expect(isAllowedDiscordLink(info.inviteUrl)).toBe(true);
  });

  it('explains why a token was refused, without echoing it', async () => {
    await expect(inspectToken('abc', fetchBot)).rejects.toThrow(DiscordSetupError);
    const revoked = async () => {
      throw new DiscordAPIError({ message: '401: Unauthorized', code: 0 }, 0, 401, 'GET', '', {});
    };
    const refused = await inspectToken(FAKE_TOKEN, revoked).catch((error: Error) => error);
    expect(refused).toBeInstanceOf(DiscordSetupError);
    expect((refused as Error).message).toContain('recusou o token');
    expect((refused as Error).message).not.toContain(FAKE_TOKEN);
    const offline = async () => {
      throw new Error('ENOTFOUND');
    };
    await expect(inspectToken(FAKE_TOKEN, offline)).rejects.toThrow('conexão');
  });

  it('only opens the Discord portal and bot invites in the browser', () => {
    expect(isAllowedDiscordLink('https://discord.com/developers/applications')).toBe(true);
    expect(isAllowedDiscordLink('http://discord.com/developers/applications')).toBe(false);
    expect(isAllowedDiscordLink('https://discord.com.evil.example/oauth2/authorize')).toBe(false);
    expect(isAllowedDiscordLink('https://discord.com/channels/1/2')).toBe(false);
    expect(isAllowedDiscordLink('file:///C:/x.exe')).toBe(false);
    expect(isAllowedDiscordLink('lixo')).toBe(false);
  });

  it('explains which voice permissions are missing', () => {
    const granted =
      (...flags: bigint[]) =>
      (flag: bigint) =>
        flags.includes(flag);
    const all = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
    ];
    expect(missingVoicePermissions(granted(...all))).toEqual([]);
    const missing = missingVoicePermissions(
      granted(PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect),
    );
    expect(missing).toEqual(['Falar']);
    expect(permissionReason(missing)).toContain('falta Falar');
    expect(permissionReason([])).toBe('');
  });
});

describe('arquivo de configuração salvo', () => {
  it('opens old files that still carry the driver user id, dropping it silently', () => {
    const migrated = migrateDiscordConfig({
      channelId: CHANNEL_ID,
      driverId: '323456789012345678',
      delay: '280',
      enabled: true,
      brakePercent: false,
      voice: 'alex',
      encryptedToken: 'abc',
    });
    expect(migrated).not.toHaveProperty('driverId');
    expect(migrated.followUserId).toBe('');
    expect(migrated).toMatchObject({ channelId: CHANNEL_ID, delay: '280', enabled: true });
    expect(migrated.encryptedToken).toBe('abc');
  });

  it('falls back to defaults for damaged or empty files', () => {
    expect(migrateDiscordConfig(null)).toEqual(EMPTY_DISCORD_CONFIG);
    expect(migrateDiscordConfig({ enabled: 'sim', delay: 5 })).toEqual(EMPTY_DISCORD_CONFIG);
  });
});

describe('segredos fora do repositório', () => {
  const root = resolve(import.meta.dirname, '../../../..');
  const TOKEN_PATTERN = /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/;
  const BINARY =
    /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|mp3|ogg|wav|opus|mp4|zip|gz|asar|exe|pdf|db|sqlite)$/i;

  function leaks(files: string[]): string[] {
    return files.filter((file) => {
      const path = join(root, file);
      if (BINARY.test(file) || !existsSync(path)) return false;
      const info = statSync(path);
      return info.isFile() && info.size < 3e6 && TOKEN_PATTERN.test(readFileSync(path, 'utf8'));
    });
  }

  function walk(dir: string): string[] {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
    );
  }

  it('has no Discord token pattern in any file tracked by git', () => {
    let tracked: string[];
    try {
      tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
        .split('\0')
        .filter(Boolean);
    } catch {
      return; // fora de um clone git (pacote extraído): não há o que rastrear
    }
    expect(tracked.length).toBeGreaterThan(100);
    expect(leaks(tracked)).toEqual([]);
  });

  it('has no Discord token pattern in built output', () => {
    const built = ['packages/web/dist', 'packages/desktop/dist']
      .filter((dir) => existsSync(join(root, dir)))
      .flatMap(walk);
    expect(leaks(built)).toEqual([]);
  });

  it('detects the pattern when it is present (guard against a broken regex)', () => {
    expect(TOKEN_PATTERN.test(FAKE_TOKEN)).toBe(true);
  });
});
