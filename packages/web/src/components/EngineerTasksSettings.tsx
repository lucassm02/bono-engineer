/**
 * Configurações → Engenheiro → Tarefas (spec 20): the switch, the modes, the limit per lap, the
 * download of the task voice (opt-in, only the voice in use) and the requests the dictionary could
 * not say. Rows of the "Mais opções" list of the engineer panel.
 */

import { RADIO_MODES, TASK_MAX_PER_LAP_RANGE } from '@gt7/shared';
import { useEffect } from 'react';
import { api } from '../analysis/api.ts';
import { CfgRow, CfgToggle } from '../analysis/components/config/ConfigRow.tsx';
import { formatBytes } from '../analysis/lib/bytes.ts';
import { useFetch } from '../analysis/useFetch.ts';
import { t as uiText } from '../lib/i18n.ts';
import { RADIO_MODE_LABELS } from '../lib/radioLabels.ts';
import { setRadioControls, useEngineer } from '../state/engineer.ts';
import { retryTaskVoice, setTaskVoiceEnabled, syncTaskVoice, useTasks } from '../state/tasks.ts';
import '../styles/tasks.css';

const MAX_OPTIONS = Array.from(
  { length: TASK_MAX_PER_LAP_RANGE[1] - TASK_MAX_PER_LAP_RANGE[0] + 1 },
  (_, i) => TASK_MAX_PER_LAP_RANGE[0] + i,
);

function VoiceState() {
  const voice = useTasks((s) => s.voice);
  useEffect(() => {
    void syncTaskVoice();
  }, []);
  if (!voice) return <span className="dim a-small">{uiText('Verificando…')}</span>;
  if (voice.status === 'unavailable') {
    return <span className="dim a-small">{uiText('Esta voz ainda não tem tarefas faladas.')}</span>;
  }
  if (voice.status === 'ready') {
    return (
      <span className="tk-voice">
        <span>{uiText('Pronta')}</span>
        <button
          type="button"
          className="ui-btn"
          data-variant="ghost"
          data-size="sm"
          onClick={() => void setTaskVoiceEnabled(false)}
        >
          {uiText('Desligar o download')}
        </button>
      </span>
    );
  }
  if (voice.status === 'downloading') {
    const pct = Math.round((voice.progress ?? 0) * 100);
    return (
      <span className="tk-voice" role="status">
        <span>{uiText('Baixando… {0}%', pct)}</span>
        <span className="tk-bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </span>
      </span>
    );
  }
  if (voice.status === 'failed') {
    return (
      <span className="tk-voice">
        <span className="ui-error">{voice.error ?? uiText('Não foi possível baixar.')}</span>
        <button
          type="button"
          className="ui-btn"
          data-size="sm"
          onClick={() => void retryTaskVoice()}
        >
          {uiText('Tentar de novo')}
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="ui-btn"
      data-size="sm"
      onClick={() => void setTaskVoiceEnabled(true)}
    >
      {voice.bytes
        ? uiText('Baixar voz das tarefas ({0})', formatBytes(voice.bytes))
        : uiText('Baixar voz das tarefas')}
    </button>
  );
}

export function EngineerTasksSettings() {
  const controls = useEngineer((s) => s.controls);
  const misses = useFetch('task-misses', () => api.taskMisses());
  const missList = misses.data ?? [];

  const toggleMode = (mode: (typeof RADIO_MODES)[number]) => {
    const has = controls.taskModes.includes(mode);
    setRadioControls({
      taskModes: has ? controls.taskModes.filter((m) => m !== mode) : [...controls.taskModes, mode],
    });
  };

  return (
    <>
      <CfgToggle
        id="tasks"
        title={uiText('Tarefas do engenheiro')}
        description={uiText(
          'O engenheiro fala, no ponto da volta, as instruções que você aprovou. Em silêncio sem elas.',
        )}
        checked={controls.tasksEnabled}
        onChange={() => setRadioControls({ tasksEnabled: !controls.tasksEnabled })}
      />
      {controls.tasksEnabled && (
        <>
          <CfgRow
            id="task-modes"
            title={uiText('Falar tarefas em')}
            description={uiText(
              'Os modos em que as tarefas são faladas. Na corrida fica desligado.',
            )}
            wide
          >
            <fieldset className="ui-segmented" aria-label={uiText('Falar tarefas em')}>
              {RADIO_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={controls.taskModes.includes(mode)}
                  onClick={() => toggleMode(mode)}
                >
                  {RADIO_MODE_LABELS[mode]}
                </button>
              ))}
            </fieldset>
          </CfgRow>
          <CfgRow
            id="task-max"
            title={uiText('Tarefas por volta')}
            description={uiText('As que passarem do limite ficam só na tela.')}
            wide
          >
            <select
              className="ui-select cfg-select"
              aria-label={uiText('Tarefas por volta')}
              value={controls.taskMaxPerLap}
              onChange={(e) => setRadioControls({ taskMaxPerLap: Number(e.currentTarget.value) })}
            >
              {MAX_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </CfgRow>
          <CfgRow
            id="task-voice"
            title={uiText('Voz das tarefas')}
            description={uiText(
              'O áudio das tarefas vem do GitHub, só da voz em uso, e fica neste computador.',
            )}
            wide
          >
            <VoiceState />
          </CfgRow>
          {missList.length > 0 && (
            <CfgRow
              id="task-misses"
              title={uiText('Pedidos sem frase ({0})', missList.length)}
              description={uiText(
                'O que um agente tentou pedir e o dicionário não sabe falar: ajuda a decidir o que falta.',
              )}
              wide
            >
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                data-size="sm"
                onClick={() => void api.clearTaskMisses().then(misses.reload)}
              >
                {uiText('Limpar lista')}
              </button>
            </CfgRow>
          )}
        </>
      )}
    </>
  );
}
