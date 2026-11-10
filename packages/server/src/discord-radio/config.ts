import {
  DEFAULT_HTTP_PORT,
  normalizeRadioPreferences,
  radioEngineConfig,
  RADIO_MODES,
  TRAINING_PROFILES,
  WS_PATH,
} from '@gt7/shared';

export const DISCORD_DEVICE_ID = 'bono-discord-radio';

export function calibratedDelay(value: string | undefined): number | null {
  if (!value) return null;
  const samples = value.split(',').map((sample) => (sample.trim() ? Number(sample) : Number.NaN));
  if (samples.some((ms) => !Number.isFinite(ms) || ms < 0 || ms > 1500)) {
    throw new Error(
      'BONO_DISCORD_DELAY_MS deve conter medições de 0 a 1500 ms, separadas por vírgula.',
    );
  }
  samples.sort((a, b) => a - b);
  return Math.ceil(samples[Math.ceil(samples.length * 0.9) - 1]!);
}

export function discordConfig(env: NodeJS.ProcessEnv, test: boolean) {
  const token = env.BONO_DISCORD_TOKEN?.trim();
  const channelId = env.BONO_DISCORD_CHANNEL_ID?.trim();
  const driverId = env.BONO_DISCORD_DRIVER_ID?.trim();
  if (
    !token ||
    !channelId ||
    !driverId ||
    !/^\d{17,20}$/.test(channelId) ||
    !/^\d{17,20}$/.test(driverId)
  ) {
    throw new Error(
      'Configure BONO_DISCORD_TOKEN, BONO_DISCORD_CHANNEL_ID e BONO_DISCORD_DRIVER_ID.',
    );
  }
  const delayMs = calibratedDelay(env.BONO_DISCORD_DELAY_MS);
  if (!test && delayMs === null) {
    throw new Error(
      'Execute o teste de rádio e informe BONO_DISCORD_DELAY_MS antes de transmitir.',
    );
  }
  const port = Number(env.BONO_DISCORD_BONO_PORT ?? DEFAULT_HTTP_PORT);
  const volume = Number(env.BONO_DISCORD_VOLUME ?? 1);
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !Number.isFinite(volume) ||
    volume < 0 ||
    volume > 1
  ) {
    throw new Error('Confira a porta local do Bono (1–65535) e o volume (0–1).');
  }
  const mode = env.BONO_DISCORD_MODE ?? 'training';
  const trainingProfile = env.BONO_DISCORD_PROFILE ?? 'learnTrack';
  if (
    !RADIO_MODES.some((item) => item === mode) ||
    !TRAINING_PROFILES.some((item) => item === trainingProfile)
  ) {
    throw new Error('Modo ou perfil de treino inválido para o rádio do Discord.');
  }
  const bonoUrl = new URL(`ws://127.0.0.1:${port}${WS_PATH}`);
  if (env.BONO_DISCORD_BONO_TOKEN) bonoUrl.searchParams.set('token', env.BONO_DISCORD_BONO_TOKEN);
  const engine = radioEngineConfig(
    normalizeRadioPreferences({
      mode,
      trainingProfile,
      level: env.BONO_DISCORD_LEVEL,
      learningBrakePercent: env.BONO_DISCORD_BRAKE_PERCENT === '1',
      summary: env.BONO_DISCORD_SUMMARY ?? 'lap',
    }),
    { tyreScaleValidated: true },
  );
  return {
    token,
    channelId,
    driverId,
    delayMs,
    bonoUrl,
    engine,
    volume,
    voice: env.BONO_DISCORD_VOICE ?? 'alex',
  };
}
