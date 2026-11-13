/**
 * Engenheiro em Configurações: as mesmas ações do menu ao vivo (`EngineerControls`), em linhas de
 * "título + descrição + controle". Na frente ficam as quatro escolhas do dia a dia (ligar, voz,
 * modo, volume) e o aparelho que toca; o resto vai em "Mais opções". Nenhuma regra nova: tudo
 * passa por `state/engineer.ts`, igual ao menu.
 */

import {
  CONSISTENCY_TARGET_RANGE_MS,
  DISCORD_RADIO_DEVICE_ID,
  RADIO_MODES,
  SUMMARY_FREQUENCIES,
  TRAINING_PROFILES,
} from '@gt7/shared';
import { type ReactNode, useId, useState } from 'react';
import { api } from '../analysis/api.ts';
import { Advanced, CfgRow, CfgToggle, rowDomId } from '../analysis/components/config/ConfigRow.tsx';
import { useFetch } from '../analysis/useFetch.ts';
import { t as uiText, useLanguage } from '../lib/i18n.ts';
import {
  RADIO_MODE_HINTS,
  RADIO_MODE_LABELS,
  SPEECH_LEVEL_LABELS,
  SUMMARY_LABELS,
  TRAINING_PROFILE_LABELS,
} from '../lib/radioLabels.ts';
import { RADIO_VOICES, voiceLabel } from '../lib/radioVoices.ts';
import { routes } from '../lib/route.ts';
import {
  type EngineerPace,
  setEngineerEnabled,
  setEngineerMuted,
  setEngineerVoice,
  setRadioControls,
  testEngineerVoice,
  useEngineer,
} from '../state/engineer.ts';
import { useUi } from '../state/uiStore.ts';
import { AskTrackSetting } from './AskTrackSetting.tsx';
import { setRadioAudioDevice } from './DiscordOutput.tsx';
import { EngineerReference } from './EngineerReference.tsx';
import { EngineerTasksSettings } from './EngineerTasksSettings.tsx';
import { RadioVoicePreview, RadioVoiceStatus } from './RadioVoice.tsx';

const pickOption = <T extends string>(values: readonly T[], value: string, fallback: T): T =>
  values.includes(value as T) ? (value as T) : fallback;

const SPEECH_LEVELS = ['essential', 'detailed', 'mute'] as const;
const PACES: readonly { id: EngineerPace; label: string }[] = [
  {
    id: 'calma',
    get label() {
      return uiText('Calmo');
    },
  },
  {
    id: 'normal',
    get label() {
      return uiText('Normal');
    },
  },
  {
    id: 'rapida',
    get label() {
      return uiText('Rápido');
    },
  },
];

/** Voz do engenheiro: o nome da linha já diz o que é, então o select só leva um rótulo acessível. */
function VoiceSelect() {
  const language = useLanguage();
  const voiceUri = useEngineer((s) => s.voiceUri);
  const pace = useEngineer((s) => s.pace);
  return (
    <select
      className="ui-select cfg-select"
      aria-label={uiText('Voz do engenheiro')}
      disabled={typeof AudioContext === 'undefined' && !window.bonoDiscord}
      value={voiceUri}
      onChange={(event) => setEngineerVoice(event.currentTarget.value, pace)}
    >
      {RADIO_VOICES.filter((voice) => voice.language === language).map((voice) => (
        <option key={voice.id} value={voice.id}>
          {`${voiceLabel(voice)} · ${voice.description}`}
        </option>
      ))}
    </select>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  disabled?: boolean;
  onPick: (id: T) => void;
}) {
  return (
    <fieldset className="ui-segmented" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          disabled={disabled}
          aria-pressed={value === o.id}
          onClick={() => onPick(o.id)}
        >
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

function Note({ tone, children }: { tone: 'info' | 'warn' | 'loss'; children: ReactNode }) {
  return (
    <p
      className="bn-note cfg-note-line"
      data-tone={tone}
      role={tone === 'loss' ? 'status' : undefined}
    >
      {children}
    </p>
  );
}

export function EngineerSettingsPanel({ openMore }: { openMore?: boolean }) {
  const enabled = useEngineer((s) => s.enabled);
  const controls = useEngineer((s) => s.controls);
  const muted = useEngineer((s) => s.muted);
  const voiceUri = useEngineer((s) => s.voiceUri);
  const pace = useEngineer((s) => s.pace);
  const audioAvailable = typeof AudioContext !== 'undefined';
  const deviceId = useUi((s) => s.profile.deviceId);
  const serverStatus = useUi((s) => s.serverStatus);
  const [deviceError, setDeviceError] = useState(false);
  const [savingDevice, setSavingDevice] = useState(false);
  const settings = useFetch('engineer-reference', api.settings);
  const volumeId = useId();

  const audioDevice = serverStatus?.engineerAudioDeviceId ?? '';
  const audioHere = !audioDevice || audioDevice === deviceId;
  const audioDiscord = audioDevice === DISCORD_RADIO_DEVICE_ID;
  const otherDevices =
    serverStatus?.devices.filter(
      (device) => device.deviceId !== deviceId && device.deviceId !== DISCORD_RADIO_DEVICE_ID,
    ) ?? [];
  const training = controls.mode === 'training';
  const consistency = controls.trainingProfile === 'consistency';
  const summaries = consistency
    ? SUMMARY_FREQUENCIES.filter((frequency) => frequency !== 'lap')
    : SUMMARY_FREQUENCIES;
  const summary = consistency && controls.summary === 'lap' ? 'block' : controls.summary;
  const speechLevel = muted ? 'mute' : controls.level;

  /** Mudo guarda o ao vivo e o nível escolhido; Essencial/Detalhado também religam o som. */
  function selectSpeechLevel(value: (typeof SPEECH_LEVELS)[number]) {
    if (value === 'mute') {
      setEngineerMuted(true);
      return;
    }
    setRadioControls({ level: value === 'detailed' ? 'detailed' : 'essential' });
    if (muted) setEngineerMuted(false, audioHere && enabled);
  }

  async function selectAudioDevice(value: string) {
    setSavingDevice(true);
    setDeviceError(false);
    if (!audioHere && (!value || value === deviceId) && enabled && !muted) testEngineerVoice(false);
    try {
      await setRadioAudioDevice(value || null);
    } catch {
      setDeviceError(true);
    } finally {
      setSavingDevice(false);
    }
  }

  return (
    <div className="cfg-stack">
      <section className="ui-card" id="engenheiro-basico" aria-label={uiText('Engenheiro')}>
        <div className="cfg-list">
          <CfgToggle
            id="engineer-on"
            title={uiText('Ligar o engenheiro')}
            description={uiText('Instruções em voz e na tela. O ajuste fica salvo neste aparelho.')}
            checked={enabled}
            onChange={() => setEngineerEnabled(!enabled, audioHere)}
          />

          <CfgRow
            id="voice"
            title={uiText('Voz')}
            description={uiText('Quem fala com você. Use “Testar voz” para ouvir.')}
            wide
          >
            <div className="cfg-voice">
              <VoiceSelect />
              <RadioVoicePreview />
            </div>
          </CfgRow>
          <RadioVoiceStatus />

          <CfgRow
            id="mode"
            title={uiText('Modo do engenheiro')}
            description={RADIO_MODE_HINTS[controls.mode]}
            wide
          >
            <div className="cfg-pair">
              <select
                className="ui-select cfg-select"
                aria-label={uiText('Modo')}
                value={controls.mode}
                onChange={(event) =>
                  setRadioControls({
                    mode: pickOption(RADIO_MODES, event.currentTarget.value, controls.mode),
                  })
                }
              >
                {RADIO_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {RADIO_MODE_LABELS[mode]}
                  </option>
                ))}
              </select>
              {training && (
                <select
                  className="ui-select cfg-select"
                  aria-label={uiText('Perfil do treino')}
                  value={controls.trainingProfile}
                  onChange={(event) =>
                    setRadioControls({
                      trainingProfile: pickOption(
                        TRAINING_PROFILES,
                        event.currentTarget.value,
                        controls.trainingProfile,
                      ),
                    })
                  }
                >
                  {TRAINING_PROFILES.map((profile) => (
                    <option key={profile} value={profile}>
                      {TRAINING_PROFILE_LABELS[profile]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </CfgRow>

          {training && controls.trainingProfile === 'learnTrack' && (
            <CfgRow
              title={uiText('Instruções de freada')}
              description={uiText('Quanto detalhe ele dá ao mandar frear.')}
              wide
            >
              <select
                className="ui-select cfg-select"
                aria-label={uiText('Instruções de freada')}
                value={controls.learningBrakePercent ? 'detailed' : 'basic'}
                onChange={(event) =>
                  setRadioControls({
                    learningBrakePercent: event.currentTarget.value === 'detailed',
                  })
                }
              >
                <option value="basic">{uiText('Básicas · freada leve, forte ou normal')}</option>
                <option value="detailed">{uiText('Detalhadas · percentual do pedal')}</option>
              </select>
            </CfgRow>
          )}

          {training && consistency && (
            <CfgRow
              title={uiText('Meta por volta, em segundos')}
              description={uiText('Vazio usa o tempo da volta de referência.')}
              wide
            >
              <input
                className="ui-input cfg-select"
                aria-label={uiText('Meta por volta, em segundos')}
                key={controls.consistencyTargetMs ?? 'reference'}
                type="number"
                min={CONSISTENCY_TARGET_RANGE_MS[0] / 1000}
                max={CONSISTENCY_TARGET_RANGE_MS[1] / 1000}
                step={0.001}
                placeholder={uiText('Tempo da referência')}
                defaultValue={
                  controls.consistencyTargetMs === null ? '' : controls.consistencyTargetMs / 1000
                }
                onBlur={({ currentTarget: field }) => {
                  if (field.validity.valid) {
                    setRadioControls({
                      consistencyTargetMs: field.value
                        ? Math.round(field.valueAsNumber * 1000)
                        : null,
                    });
                  } else {
                    field.value =
                      controls.consistencyTargetMs === null
                        ? ''
                        : String(controls.consistencyTargetMs / 1000);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                }}
              />
            </CfgRow>
          )}

          <CfgRow
            id="volume"
            title={uiText('Volume')}
            description={uiText('Volume da voz do engenheiro neste aparelho.')}
          >
            <div className="cfg-range">
              <input
                id={volumeId}
                className="ui-range"
                type="range"
                aria-label={uiText('Volume')}
                min={0}
                max={100}
                step={5}
                value={Math.round(controls.volume * 100)}
                onChange={(event) =>
                  setRadioControls({ volume: Number(event.currentTarget.value) / 100 })
                }
              />
              <output htmlFor={volumeId} className="num">
                {Math.round(controls.volume * 100)}%
              </output>
            </div>
          </CfgRow>

          <CfgRow
            id="audio-device"
            title={uiText('Onde ele fala')}
            description={uiText('Este aparelho, o Discord ou outro aparelho conectado.')}
            wide
          >
            <select
              className="ui-select cfg-select"
              aria-label={uiText('Aparelho que toca o engenheiro')}
              value={audioDevice}
              disabled={savingDevice || !serverStatus}
              onChange={(event) => void selectAudioDevice(event.currentTarget.value)}
            >
              <option value="">{uiText('Cada aparelho controla o próprio som')}</option>
              <option value={deviceId}>{uiText('Somente neste aparelho')}</option>
              <option value={DISCORD_RADIO_DEVICE_ID}>Discord · PS5</option>
              {otherDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.name}
                </option>
              ))}
              {audioDevice &&
                !audioHere &&
                !audioDiscord &&
                !otherDevices.some((device) => device.deviceId === audioDevice) && (
                  <option value={audioDevice}>
                    {uiText('Aparelho selecionado · desconectado')}
                  </option>
                )}
            </select>
          </CfgRow>
          {!audioHere && (
            <Note tone="info">
              {audioDiscord ? (
                <>
                  {uiText(
                    'O som sai pelo canal do Discord. O Bono para Windows precisa estar aberto com o rádio do Discord ativado.',
                  )}{' '}
                  {window.bonoDiscord && (
                    <a href={routes.config('discord')}>{uiText('Ajustar o Discord')}</a>
                  )}
                </>
              ) : (
                uiText('Ative o engenheiro no aparelho escolhido para ouvi-lo.')
              )}
            </Note>
          )}
          {deviceError && <Note tone="loss">{uiText('Não foi possível alterar o aparelho.')}</Note>}

          <div id={rowDomId('ask-track')}>
            <AskTrackSetting />
          </div>
        </div>
      </section>

      <Advanced id="engenheiro-mais" summary={uiText('Mais opções')} forceOpen={openMore}>
        <div className="cfg-list">
          <CfgRow
            id="speech-level"
            title={uiText('Nível de fala')}
            description={uiText('Essencial, detalhado ou mudo.')}
          >
            <Segmented
              label={uiText('Nível de fala')}
              value={speechLevel}
              options={SPEECH_LEVELS.map((id) => ({ id, label: SPEECH_LEVEL_LABELS[id] }))}
              onPick={selectSpeechLevel}
            />
          </CfgRow>
          <CfgRow
            id="pace"
            title={uiText('Ritmo da fala')}
            description={uiText('Calmo, normal ou rápido.')}
          >
            <Segmented
              label={uiText('Ritmo da fala')}
              value={pace}
              disabled={!audioAvailable}
              options={PACES}
              onPick={(id) => setEngineerVoice(voiceUri, id)}
            />
          </CfgRow>
          <CfgRow
            id="anticipation"
            title={uiText('Antecipação')}
            description={uiText('Quanto antes da curva o aviso é dado.')}
            wide
          >
            <select
              className="ui-select cfg-select"
              aria-label={uiText('Antecipação')}
              value={controls.anticipationMs}
              onChange={(event) =>
                setRadioControls({ anticipationMs: Number(event.currentTarget.value) })
              }
            >
              <option value={0}>{uiText('Padrão')}</option>
              <option value={350}>{uiText('Mais cedo (+0,35 s)')}</option>
              <option value={700}>{uiText('Bem antes (+0,7 s)')}</option>
            </select>
          </CfgRow>
          {training && controls.trainingProfile !== 'free' && (
            <CfgRow
              id="summary"
              title={uiText('Resumo do treino')}
              description={uiText('Com que frequência ele resume o treino.')}
              wide
            >
              <select
                className="ui-select cfg-select"
                aria-label={uiText('Resumo do treino')}
                value={summary}
                onChange={(event) =>
                  setRadioControls({
                    summary: pickOption(summaries, event.currentTarget.value, summary),
                  })
                }
              >
                {summaries.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {SUMMARY_LABELS[frequency]}
                  </option>
                ))}
              </select>
            </CfgRow>
          )}
          {training && controls.trainingProfile !== 'free' && !consistency && (
            <CfgToggle
              id="praise"
              title={uiText('Reforço positivo')}
              description={uiText('O engenheiro também avisa quando você acerta a curva.')}
              checked={controls.praise}
              onChange={() => setRadioControls({ praise: !controls.praise })}
            />
          )}
          <EngineerTasksSettings />
        </div>

        <div className="cfg-delta" id="cfg-row-delta-ref">
          <EngineerReference settings={settings} audioHere={audioHere} />
        </div>
      </Advanced>
    </div>
  );
}
