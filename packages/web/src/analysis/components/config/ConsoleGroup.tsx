/**
 * Grupo "Console": o PS5 (estado + "Procurar de novo"), a gravação automática das sessões e, num
 * bloco recolhido, o que só importa quando algo falha: outro IP, formato do pacote, gravar
 * pacotes brutos e a nota sobre o formato do replay.
 */

import { type ApiSettingsPatch, type ApiStatus, PACKET_FORMATS } from '@gt7/shared';
import { useState } from 'react';
import { IpForm, LinkDot } from '../../../components/ConsoleLink.tsx';
import { Icon } from '../../../components/ui/Icon.tsx';
import { agoText, describeLink, ipSourceLabel, type LinkTone } from '../../../lib/consoleLink.ts';
import { recordingStateText } from '../../../lib/copy.ts';
import { t as uiText } from '../../../lib/i18n.ts';
import { GT7_INTEGRATION } from '../../../lib/integrations.ts';
import { backToAutomatic, rescanConsole } from '../../../net/consoleActions.ts';
import { useConsoleConnection } from '../../../state/consoleLink.ts';
import { useUi } from '../../../state/uiStore.ts';
import { api } from '../../api.ts';
import { PACKET_FORMAT_INFO } from '../../lib/labels.ts';
import { Panel } from '../Panel.tsx';
import { Advanced, CfgRow, CfgToggle, rowDomId, useSave } from './ConfigRow.tsx';

const DOT_TONE: Record<LinkTone, string> = {
  ok: 'gain',
  busy: 'accent',
  info: 'accent',
  warn: 'warn',
  bad: 'loss',
};

/** Estado do PS5 e a ação de busca no mesmo cartão. */
function ConsoleStatusRow() {
  const conn = useConsoleConnection();
  const mock = useUi((s) => s.source === 'mock');
  const view = describeLink(conn);
  const [busy, setBusy] = useState(false);
  const rescan = async () => {
    setBusy(true);
    try {
      await rescanConsole();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cfg-status-row" id={rowDomId('ps5')}>
      <div className="ui-card cfg-status-main" data-tone={DOT_TONE[view.tone]}>
        <div className="cx-status" role="status">
          <LinkDot tone={view.tone} busy={view.busy} />
          <div>
            <strong>{conn?.state === 'found' ? view.short : view.title}</strong>
            {conn?.state === 'found' ? (
              <p>{uiText('Abra o Gran Turismo 7 no PS5 e entre numa pista.')}</p>
            ) : (
              view.detail && <p>{view.detail}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          className="ui-btn"
          disabled={busy || (!mock && !conn)}
          onClick={rescan}
        >
          <Icon name="refresh" size={18} />
          {uiText('Procurar de novo')}
        </button>
      </div>
      {conn && (
        <p className="cfg-facts-line">
          <span>
            {uiText('Endereço do PS5')}:{' '}
            {conn.consoleIp ? (
              <>
                <span className="num">{conn.consoleIp}</span> ({ipSourceLabel(conn.source)})
              </>
            ) : (
              uiText('ainda não encontrado')
            )}
          </span>
          <span>
            {uiText('Último sinal')}: {agoText(conn.lastPacketAt)}
          </span>
        </p>
      )}
    </div>
  );
}

export function ConsoleGroup({
  status,
  onChange,
  openAdvanced,
}: {
  status: ApiStatus;
  onChange: () => void;
  /** O link apontou para algo dentro do bloco recolhido. */
  openAdvanced?: boolean;
}) {
  const s = status.settings;
  const conn = useConsoleConnection();
  const isDemo = (status.telemetrySource ?? (status.simulator ? 'demo' : 'gt7')) === 'demo';
  const { busy, run } = useSave();
  const patch = async (p: ApiSettingsPatch, ok: string) => {
    if (await run(() => api.patchSettings(p), ok)) onChange();
  };
  const recording = recordingStateText(s.autoCapture, s.record);
  return (
    <>
      <Panel
        id="connection"
        title={uiText('PS5')}
        description={uiText('Como o Bono recebe os dados do jogo.')}
        actions={
          <span className="cfg-integration">
            <strong>{GT7_INTEGRATION.name}</strong>
            <span className="ui-badge" data-tone="accent">
              {GT7_INTEGRATION.platform}
            </span>
          </span>
        }
      >
        <ConsoleStatusRow />
        {isDemo && (
          <div className="ui-card cfg-note" data-tone="warn" role="note">
            <span className="ui-badge" data-tone="warn">
              Demo
            </span>
            <span>{uiText('Modo demonstração: o console é simulado dentro do app.')}</span>
          </div>
        )}
      </Panel>

      <Panel
        id="capture"
        title={uiText('Gravação')}
        description={uiText('Quando o app salva sessões, voltas e pistas por conta própria.')}
      >
        <div className="cfg-list">
          <CfgToggle
            id="auto-record"
            title={uiText('Gravar sessões automaticamente')}
            description={
              s.autoCapture
                ? uiText(
                    'Ao entrar numa pista, o app abre a sessão e salva quando você sai. Sem botão de iniciar.',
                  )
                : recording.detail
            }
            checked={s.autoCapture}
            disabled={busy}
            onChange={() =>
              patch(
                { autoCapture: !s.autoCapture },
                s.autoCapture
                  ? uiText('Gravação automática desligada.')
                  : uiText('Gravação automática ligada.'),
              )
            }
          />
        </div>
      </Panel>

      <Advanced
        id="avancado-console"
        summary={uiText('Avançado: outro IP, formato do pacote e pacotes brutos')}
        forceOpen={openAdvanced}
      >
        <CfgRow
          id="manual-ip"
          title={uiText('Usar outro IP')}
          description={
            conn?.source === 'manual'
              ? uiText('Fixado por você: {0}.', conn.consoleIp ?? '')
              : uiText('Só se a busca automática não achar o console.')
          }
          wide
        >
          {conn?.source === 'manual' ? (
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              disabled={busy}
              onClick={() => void backToAutomatic()}
            >
              {uiText('Voltar ao automático')}
            </button>
          ) : (
            <span className="cfg-muted">{uiText('Automático')}</span>
          )}
        </CfgRow>
        <IpForm />

        <hr className="ui-divider" />

        <div id={rowDomId('packet-format')} className="cfg-stack">
          <CfgToggle
            title={uiText('Formato do pacote: automático (recomendado)')}
            description={
              <>
                {uiText('O app descobre sozinho o formato que o seu console aceita.')}
                {s.liveFormatAuto
                  ? uiText(' Em uso agora: {0}.', PACKET_FORMAT_INFO[s.liveFormat].label)
                  : uiText(' Fixado em {0}.', PACKET_FORMAT_INFO[s.liveFormat].label)}
              </>
            }
            checked={s.liveFormatAuto}
            disabled={busy || s.liveFormatAuto}
            hint={
              s.liveFormatAuto ? uiText('Para fixar um formato, escolha um abaixo.') : undefined
            }
            onChange={() => patch({ liveFormatAuto: true }, uiText('Formato automático ligado.'))}
          />
          <fieldset className="cfg-radios">
            <legend>{uiText('Formato ao vivo')}</legend>
            <label className="cfg-radio">
              <input
                type="radio"
                name="liveFormat"
                checked={s.liveFormatAuto}
                disabled={busy}
                onChange={() =>
                  patch({ liveFormatAuto: true }, uiText('Formato automático ligado.'))
                }
              />
              <span>
                <strong>{uiText('Automático (recomendado)')}</strong>
                <small>{uiText('Testa ~, depois B e A, e guarda o que funcionar.')}</small>
              </span>
            </label>
            {PACKET_FORMATS.map((f) => (
              <label key={f} className="cfg-radio">
                <input
                  type="radio"
                  name="liveFormat"
                  checked={!s.liveFormatAuto && s.liveFormat === f}
                  disabled={busy}
                  onChange={() =>
                    patch({ liveFormat: f }, uiText('Trocando para o formato {0} (até ~15 s).', f))
                  }
                />
                <span>
                  <strong>{PACKET_FORMAT_INFO[f].label}</strong>
                  <small>{PACKET_FORMAT_INFO[f].text}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="cfg-hint">
            {uiText(
              'Ao escolher um formato, o app para de trocar sozinho. Para voltar, ligue o interruptor “Formato do pacote: automático”.',
            )}
          </p>
          <p className="cfg-hint" id={rowDomId('replay-format')}>
            {uiText(
              'Gravar volta de replay usa o formato acima: ela não troca mais o formato do pacote, porque o formato atual já entrega os dados do replay.',
            )}
          </p>
        </div>

        <hr className="ui-divider" />

        <CfgToggle
          id="raw-record"
          title={uiText('Gravar pacotes brutos')}
          description={uiText(
            'Guarda todo pacote (~20 KB/s) para reprocessar depois e baixar o .gt7rec. Ocupa espaço em disco; deixe desligado se não precisar.',
          )}
          checked={s.record}
          disabled={busy}
          onChange={() =>
            patch(
              { record: !s.record },
              s.record
                ? uiText('Gravação de pacotes brutos desligada.')
                : uiText('Gravação de pacotes brutos ligada.'),
            )
          }
        />
      </Advanced>
    </>
  );
}
