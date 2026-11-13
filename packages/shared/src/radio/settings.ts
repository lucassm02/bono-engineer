/**
 * Radio engineer preferences (spec do engenheiro de rádio, "Modos e configurações").
 *
 * Mode, reference and speech level are separate choices. Volume, voice, pace and the device that
 * plays the radio live in the web layer and are not touched here.
 */

export const RADIO_MODES = ['training', 'qualifying', 'race'] as const;
/** Treino · Classificação · Corrida, chosen by the driver. */
export type RadioMode = (typeof RADIO_MODES)[number];

export const RADIO_LEVELS = ['essential', 'detailed'] as const;
/** Essencial (default) or Detalhado. Mudo is the separate mute switch (see RadioSpeechLevel). */
export type RadioLevel = (typeof RADIO_LEVELS)[number];
/** What the engine applies: Mudo silences the audio and keeps the panel. */
export type RadioSpeechLevel = RadioLevel | 'mute';

export const TRAINING_PROFILES = ['learnTrack', 'gainTime', 'consistency', 'free'] as const;
/** Aprender pista · Ganhar tempo · Consistência · Livre. */
export type TrainingProfile = (typeof TRAINING_PROFILES)[number];

export const SUMMARY_FREQUENCIES = ['lap', 'block', 'onDemand', 'off'] as const;
/** Resumo por volta · por bloco · sob demanda · desligado. */
export type SummaryFrequency = (typeof SUMMARY_FREQUENCIES)[number];

export interface RadioPreferences {
  mode: RadioMode;
  level: RadioLevel;
  trainingProfile: TrainingProfile;
  learningBrakePercent: boolean;
  summary: SummaryFrequency;
  /** Generic praise ("Boa volta"), separate from the summary. Off by default. */
  praise: boolean;
  /**
   * Consistência: target lap time (ms) to repeat; null = the reference lap (the execution to
   * repeat), else the best lap of the block.
   */
  consistencyTargetMs: number | null;
  /** Engineer tasks the driver approved (spec 20): the engineer says them at their place on the lap. */
  tasksEnabled: boolean;
  /** Modes where the tasks are said (Corrida is off by default). */
  taskModes: RadioMode[];
  /** At most this many tasks per lap (1–4). */
  taskMaxPerLap: number;
}

/** Tasks per lap the driver may choose. */
export const TASK_MAX_PER_LAP_RANGE = [1, 4] as const;

export const DEFAULT_RADIO_PREFERENCES: Readonly<RadioPreferences> = {
  mode: 'training',
  level: 'essential',
  trainingProfile: 'learnTrack',
  learningBrakePercent: false,
  summary: 'onDemand',
  praise: false,
  consistencyTargetMs: null,
  tasksEnabled: true,
  taskModes: ['training', 'qualifying'],
  taskMaxPerLap: 2,
};

/** Target lap times accepted for Consistência (ms). */
export const CONSISTENCY_TARGET_RANGE_MS = [20_000, 1_800_000] as const;

const pick = <T extends string>(values: readonly T[], value: unknown, fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;

/**
 * Saved preferences → current model. Unknown values fall back to the defaults. Migration: the
 * old `detail` field ('essential' | 'full', where 'full' was the previous default) maps to
 * Essencial / Detalhado so an existing install keeps the calls it already heard.
 */
export function normalizeRadioPreferences(saved: unknown): RadioPreferences {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const legacy = s.detail === 'full' ? 'detailed' : s.detail === 'essential' ? 'essential' : null;
  const d = DEFAULT_RADIO_PREFERENCES;
  return {
    mode: pick(RADIO_MODES, s.mode, d.mode),
    level: pick(RADIO_LEVELS, s.level, legacy ?? d.level),
    trainingProfile: pick(TRAINING_PROFILES, s.trainingProfile, d.trainingProfile),
    learningBrakePercent: s.learningBrakePercent === true,
    summary: pick(SUMMARY_FREQUENCIES, s.summary, d.summary),
    praise: s.praise === true,
    consistencyTargetMs:
      typeof s.consistencyTargetMs === 'number' &&
      s.consistencyTargetMs >= CONSISTENCY_TARGET_RANGE_MS[0] &&
      s.consistencyTargetMs <= CONSISTENCY_TARGET_RANGE_MS[1]
        ? Math.round(s.consistencyTargetMs)
        : null,
    tasksEnabled: s.tasksEnabled !== false,
    taskModes: Array.isArray(s.taskModes)
      ? RADIO_MODES.filter((m) => (s.taskModes as unknown[]).includes(m))
      : [...d.taskModes],
    taskMaxPerLap:
      typeof s.taskMaxPerLap === 'number' && Number.isFinite(s.taskMaxPerLap)
        ? Math.min(
            TASK_MAX_PER_LAP_RANGE[1],
            Math.max(TASK_MAX_PER_LAP_RANGE[0], Math.round(s.taskMaxPerLap)),
          )
        : d.taskMaxPerLap,
  };
}

/** Panel tyre temperature scale (°C), the same shape as the web `TyreTempScale`. */
export interface RadioTyreScale {
  cold: number;
  idealMin: number;
  idealMax: number;
  hot: number;
}

/** Everything the decision engine needs besides the frames. Same config + frames → same log. */
export interface RadioEngineConfig {
  mode: RadioMode;
  speechLevel: RadioSpeechLevel;
  trainingProfile: TrainingProfile;
  learningBrakePercent: boolean;
  summary: SummaryFrequency;
  praise: boolean;
  consistencyTargetMs: number | null;
  /** A lap within this of the goal (target or reference) is "na meta" (ms). */
  goalToleranceMs: number;
  /** Extra anticipation (ms) for the corner calls (Antecipação). */
  anticipationMs: number;
  /** Panel scale, reused as the starting point of the tyre range. */
  tyreScale: RadioTyreScale;
  /**
   * Whether the tyre range is trusted for this condition. When false (or the scale is malformed)
   * the tyre values go to the panel only and nothing about tyre temperature is spoken.
   */
  tyreScaleValidated: boolean;
  /** The engineer tasks (spec 20): switch, modes and the limit per lap. */
  tasks: { enabled: boolean; modes: readonly RadioMode[]; maxPerLap: number };
}

/** Default goal tolerance (ms): three tenths. */
export const GOAL_TOLERANCE_MS = 300;

export const DEFAULT_TYRE_SCALE: Readonly<RadioTyreScale> = {
  cold: 50,
  idealMin: 70,
  idealMax: 95,
  hot: 115,
};

export function radioEngineConfig(
  prefs: RadioPreferences,
  extra: Partial<Omit<RadioEngineConfig, keyof RadioPreferences>> & { muted?: boolean } = {},
): RadioEngineConfig {
  return {
    mode: prefs.mode,
    speechLevel: extra.muted ? 'mute' : prefs.level,
    trainingProfile: prefs.trainingProfile,
    learningBrakePercent: prefs.learningBrakePercent,
    summary: prefs.summary,
    praise: prefs.praise,
    consistencyTargetMs: prefs.consistencyTargetMs ?? null,
    goalToleranceMs: extra.goalToleranceMs ?? GOAL_TOLERANCE_MS,
    anticipationMs: extra.anticipationMs ?? 0,
    tyreScale: extra.tyreScale ?? DEFAULT_TYRE_SCALE,
    tyreScaleValidated: extra.tyreScaleValidated ?? true,
    tasks: extra.tasks ?? {
      enabled: prefs.tasksEnabled,
      modes: prefs.taskModes,
      maxPerLap: prefs.taskMaxPerLap,
    },
  };
}
