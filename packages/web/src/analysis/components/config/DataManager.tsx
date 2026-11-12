/**
 * Configurações → Contas e dados → "Seus dados" e "Backup e transferência".
 *
 *  - onde os dados ficam (e, no app para Windows, trocar a pasta, inclusive para OneDrive/Dropbox);
 *  - exportar um backup `.bono` (voltas, configurações, gravações) ou só as configurações;
 *  - importar um backup: somar ao que já existe ou substituir tudo (com cópia de segurança).
 */

import type { ApiBackupUpload, ApiImportResult, ApiStatus } from '@gt7/shared';
import { useRef, useState } from 'react';
import { Modal } from '../../../components/ui/Modal.tsx';
import { t as uiText, useLanguage } from '../../../lib/i18n.ts';
import { addNotice } from '../../../state/uiStore.ts';
import '../../../styles/data-manager.css';
import { api } from '../../api.ts';
import { formatBytes } from '../../lib/bytes.ts';
import { useFetch } from '../../useFetch.ts';
import { CopyBtn } from '../CopyBlock.tsx';
import { Panel } from '../Panel.tsx';
import { ErrorBox, Loading } from '../ui.tsx';
import { Choice } from './Choice.tsx';
import { CfgToggle } from './ConfigRow.tsx';
import { DataFolderModal } from './DataFolderModal.tsx';

/** Data and backup panels. `status` only tells whether this is the demo (separate data). */
export function DataSection({ status }: { status: ApiStatus }) {
  const summary = useFetch('data-summary', () => api.dataSummary());
  const data = summary.data;
  const bridge = window.bonoData;
  const [folderOpen, setFolderOpen] = useState(false);
  const lang = useLanguage();
  const total = data
    ? data.sizes.databaseBytes + data.sizes.tracesBytes + data.sizes.recordingsBytes
    : 0;

  return (
    <>
      <Panel
        id="dados"
        title={uiText('Seus dados')}
        description={uiText(
          'Suas sessões, voltas e gravações ficam só neste PC, na pasta que você escolher.',
        )}
      >
        {summary.error && !data ? (
          <ErrorBox error={summary.error} compact onRetry={summary.reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <div className="dm-stack">
            <div className="dm-stats">
              <Stat label={uiText('Sessões')} value={data.counts.sessions.toLocaleString(lang)} />
              <Stat label={uiText('Voltas')} value={data.counts.laps.toLocaleString(lang)} />
              <Stat label={uiText('Pistas')} value={data.counts.tracks.toLocaleString(lang)} />
              <Stat label={uiText('Espaço usado')} value={formatBytes(total, lang)} />
            </div>

            <div className="ui-field">
              <span className="ui-label">{uiText('Pasta dos dados')}</span>
              <div className="dm-path">
                <span className="num dm-path-text">{data.dataDir}</span>
                {data.cloudProvider && (
                  <span className="ui-badge" data-tone="warn">
                    {data.cloudProvider}
                  </span>
                )}
              </div>
              <div className="dm-actions">
                <CopyBtn text={data.dataDir} label={uiText('Copiar caminho')} />
                {bridge ? (
                  <>
                    <button
                      type="button"
                      className="ui-btn"
                      data-variant="secondary"
                      onClick={() => void window.bonoData?.openFolder()}
                    >
                      {uiText('Abrir pasta')}
                    </button>
                    <button type="button" className="ui-btn" onClick={() => setFolderOpen(true)}>
                      {uiText('Alterar pasta…')}
                    </button>
                  </>
                ) : (
                  <span className="ui-help">
                    {uiText('Para trocar a pasta, use o aplicativo Bono para Windows.')}
                  </span>
                )}
              </div>
            </div>

            {data.cloudProvider && (
              <div className="ui-card dm-note" data-tone="warn" role="note">
                <strong>{uiText('Pasta sincronizada pelo {0}', data.cloudProvider)}</strong>
                <span>
                  {uiText(
                    'Use o Bono em um PC por vez e espere a sincronização terminar antes de abri-lo em outro. Dois PCs na mesma pasta ao mesmo tempo podem corromper o histórico. Para guardar cópias na nuvem com segurança, prefira exportar um backup para essa pasta.',
                  )}
                </span>
              </div>
            )}

            {status.simulator && (
              <div className="ui-card dm-note" data-tone="warn" role="note">
                <span className="ui-badge" data-tone="warn">
                  Demo
                </span>
                <span>
                  {uiText(
                    'Você está no modo demonstração: estes dados são de um piloto simulado e ficam numa subpasta separada (',
                  )}
                  <code>demo</code>
                  {uiText('), sem misturar com os reais.')}
                </span>
              </div>
            )}
          </div>
        )}
      </Panel>

      <BackupPanel
        recordingsBytes={data?.sizes.recordingsBytes ?? 0}
        counts={data?.counts ?? null}
        onImported={summary.reload}
      />

      {bridge && folderOpen && (
        <DataFolderModal
          bridge={bridge}
          onClose={() => setFolderOpen(false)}
          cloudHint={data?.cloudProvider ?? null}
        />
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="ui-stat">
      <span className="ui-stat-label">{label}</span>
      <span className="ui-stat-value num">{value}</span>
    </div>
  );
}

function BackupPanel({
  recordingsBytes,
  counts,
  onImported,
}: {
  recordingsBytes: number;
  counts: { sessions: number; laps: number; tracks: number; recordings: number } | null;
  onImported: () => void;
}) {
  const lang = useLanguage();
  const [laps, setLaps] = useState(true);
  const [settings, setSettings] = useState(true);
  const [recordings, setRecordings] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<ApiBackupUpload | null>(null);

  const canExport = laps || settings;
  const exportHref = api.dataExportUrl({ laps, settings, recordings: laps && recordings });

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      setUpload(await api.dataImportUpload(file));
    } catch (e) {
      addNotice('error', (e as Error).message, 8000);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <Panel
      id="backup"
      title={uiText('Backup e transferência')}
      description={uiText(
        'Leve suas voltas para outro PC ou guarde uma cópia, no OneDrive por exemplo. Chaves e senhas nunca vão no arquivo.',
      )}
    >
      <div className="dm-stack">
        <h3 className="a-h3">{uiText('Exportar')}</h3>
        <div className="cfg-list">
          <CfgToggle
            id="export-laps"
            title={uiText('Sessões e voltas')}
            description={
              counts
                ? uiText(
                    'Sessões: {0} · Voltas: {1} · Pistas: {2}',
                    counts.sessions,
                    counts.laps,
                    counts.tracks,
                  )
                : uiText('Seu histórico completo.')
            }
            checked={laps}
            onChange={() => setLaps(!laps)}
          />
          <CfgToggle
            id="export-settings"
            title={uiText('Configurações')}
            description={uiText('Idioma, engenheiro, telas dos aparelhos e preferências.')}
            checked={settings}
            onChange={() => setSettings(!settings)}
          />
          <CfgToggle
            id="export-recordings"
            title={uiText('Gravações brutas')}
            description={
              recordingsBytes > 0
                ? uiText(
                    'Ocupam {0}. Só vale a pena se você quer reprocessar as sessões.',
                    formatBytes(recordingsBytes, lang),
                  )
                : uiText('Você não tem gravações brutas guardadas.')
            }
            checked={laps && recordings}
            disabled={!laps || recordingsBytes === 0}
            onChange={() => setRecordings(!recordings)}
          />
        </div>
        <div className="dm-actions">
          <a
            className="ui-btn"
            href={canExport ? exportHref : undefined}
            aria-disabled={!canExport}
            download
          >
            {uiText('Exportar backup (.bono)')}
          </a>
          <a
            className="ui-btn"
            data-variant="secondary"
            href={api.dataExportUrl({ laps: false, settings: true, recordings: false })}
            download
          >
            {uiText('Exportar só as configurações')}
          </a>
        </div>
        {!canExport && <p className="ui-error">{uiText('Escolha o que exportar.')}</p>}

        <hr className="ui-divider" />

        <h3 className="a-h3">{uiText('Importar')}</h3>
        <p className="ui-help">
          {uiText(
            'Escolha um arquivo .bono. Você decide se ele é somado ao que você já tem ou se substitui tudo.',
          )}
        </p>
        <div className="dm-actions">
          <input
            ref={fileRef}
            type="file"
            accept=".bono,.zip,application/zip,application/octet-stream"
            hidden
            onChange={(e) => void onFile(e.currentTarget.files?.[0])}
          />
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? uiText('Lendo o arquivo…') : uiText('Importar backup…')}
          </button>
        </div>
      </div>

      {upload && (
        <ImportModal
          upload={upload}
          onClose={() => {
            void api.dataImportDiscard(upload.uploadId).catch(() => {});
            setUpload(null);
          }}
          onDone={() => {
            setUpload(null);
            onImported();
          }}
        />
      )}
    </Panel>
  );
}

function ImportModal({
  upload,
  onClose,
  onDone,
}: {
  upload: ApiBackupUpload;
  onClose: () => void;
  onDone: () => void;
}) {
  const lang = useLanguage();
  const m = upload.manifest;
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [withSettings, setWithSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ApiImportResult | null>(null);

  async function apply() {
    setBusy(true);
    setError('');
    try {
      setResult(await api.dataImportApply(upload.uploadId, { mode, settings: withSettings }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal
        open
        onClose={onDone}
        size="sm"
        title={uiText('Backup importado')}
        footer={
          <button type="button" className="ui-btn" onClick={onDone}>
            {uiText('Concluir')}
          </button>
        }
      >
        <div className="dm-stack">
          <ul className="dm-result">
            <li>{uiText('Sessões adicionadas: {0}', result.sessions)}</li>
            <li>{uiText('Voltas adicionadas: {0}', result.laps)}</li>
            <li>
              {uiText('Pistas novas: {0}', result.tracks)}
              {result.tracksMatched > 0 &&
                uiText(' · reconhecidas como já existentes: {0}', result.tracksMatched)}
            </li>
            {result.coachReports > 0 && (
              <li>{uiText('Relatórios do coach: {0}', result.coachReports)}</li>
            )}
            {result.settings > 0 && <li>{uiText('Configurações aplicadas')}</li>}
          </ul>
          {result.safetyBackup && (
            <p className="ui-help">
              {uiText('Uma cópia do que existia antes ficou em {0}.', result.safetyBackup)}
            </p>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={busy ? () => {} : onClose}
      size="md"
      title={uiText('Importar backup')}
      subtitle={uiText(
        'Criado em {0} no Bono {1}',
        new Date(m.createdAt).toLocaleString(lang),
        m.app.version,
      )}
      footer={
        <>
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            disabled={busy}
            onClick={onClose}
          >
            {uiText('Cancelar')}
          </button>
          <button
            type="button"
            className="ui-btn"
            data-variant={mode === 'replace' ? 'danger' : undefined}
            disabled={busy}
            onClick={() => void apply()}
          >
            {busy
              ? uiText('Importando…')
              : mode === 'replace'
                ? uiText('Substituir tudo')
                : uiText('Adicionar ao meu histórico')}
          </button>
        </>
      }
    >
      <div className="dm-stack">
        <div className="dm-stats">
          <Stat label={uiText('Sessões')} value={m.counts.sessions.toLocaleString(lang)} />
          <Stat label={uiText('Voltas')} value={m.counts.laps.toLocaleString(lang)} />
          <Stat label={uiText('Pistas')} value={m.counts.tracks.toLocaleString(lang)} />
          <Stat label={uiText('Tamanho')} value={formatBytes(upload.sizeBytes, lang)} />
        </div>

        <div className="dm-choices" role="radiogroup" aria-label={uiText('Como importar')}>
          <Choice
            name="import-mode"
            checked={mode === 'merge'}
            onChange={() => setMode('merge')}
            title={uiText('Adicionar ao que eu já tenho')}
            description={uiText(
              'Recomendado. Mantém seu histórico e soma só o que ainda não está aqui. Pistas iguais são reconhecidas.',
            )}
          />
          <Choice
            name="import-mode"
            danger
            checked={mode === 'replace'}
            onChange={() => setMode('replace')}
            title={uiText('Substituir tudo')}
            description={uiText(
              'Apaga o histórico atual e fica só com o do arquivo. Antes, uma cópia do que existe hoje é guardada na pasta backups.',
            )}
          />
        </div>

        {m.includes.settings && (
          <CfgToggle
            id="import-settings"
            title={uiText('Importar também as configurações')}
            description={uiText('Troca idioma, engenheiro e telas dos aparelhos pelos do arquivo.')}
            checked={withSettings}
            onChange={() => setWithSettings(!withSettings)}
          />
        )}

        {error && (
          <p className="ui-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
