/**
 * #/config — everything is configured here, in plain language: connection with the PS5 (with
 * automatic discovery), phone (QR + firewall), AI coach, data folder, AI integration (MCP) and about.
 * Cada assunto é um cartão com título e descrição; a navegação por abas leva às âncoras
 * `#/config?s=<secao>`. Technical options sit behind "Avançado".
 */

import {
  type ApiSettingsPatch,
  type ApiStatus,
  type CoachConfig,
  type CoachEffort,
  DELTA_REFERENCE_KINDS,
  type DeviceInfo,
  PACKET_FORMATS,
  PRODUCT_NAME,
  VIEW_IDS,
  type ViewId,
} from '@gt7/shared';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { ConnectionDetails } from '../../components/ConsoleLink.tsx';
import { FullscreenButton } from '../../components/FullscreenButton.tsx';
import { Icon } from '../../components/ui/Icon.tsx';
import { t as uiText } from '../../lib/i18n.ts';
import { GT7_INTEGRATION } from '../../lib/integrations.ts';
import { DELTA_REFERENCE_LABELS, VIEW_LABELS } from '../../lib/labels.ts';
import { ONBOARDING_KEY } from '../../lib/onboarding.ts';
import { type Route, routes } from '../../lib/route.ts';
import { saveString } from '../../lib/storage.ts';
import { addNotice, useUi } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { ConfirmModal } from '../components/ConfirmModal.tsx';
import { CodeBlock, CopyBtn } from '../components/CopyBlock.tsx';
import { DiscordSettings } from '../components/DiscordSettings.tsx';
import { LanguageSettings } from '../components/LanguageSettings.tsx';
import { Panel } from '../components/Panel.tsx';
import { ErrorBox, Loading, PageHead, useTitle } from '../components/ui.tsx';
import { formatAgo, PACKET_FORMAT_INFO } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';

const EFFORT_LABELS: Record<CoachEffort, string> = {
  get low() {
    return uiText('Baixo (rápido e barato)');
  },
  get medium() {
    return uiText('Médio');
  },
  get high() {
    return uiText('Alto (análise mais profunda)');
  },
};

function useSave() {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) addNotice('info', ok);
      return r;
    } catch (e) {
      addNotice('error', (e as Error).message, 7000);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Linha de opção com chave: título, descrição e interruptor. */
function Toggle({
  title,
  description,
  checked,
  disabled,
  hint,
  onChange,
}: {
  title: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: () => void;
}) {
  const id = useId();
  return (
    <div className="ui-toggle">
      <div className="ui-toggle-text">
        <span className="ui-toggle-title" id={id}>
          {title}
        </span>
        <span className="ui-toggle-desc">{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        className="ui-switch"
        disabled={disabled}
        title={hint}
        onClick={onChange}
      />
    </div>
  );
}

/** Linha de opção com um controle livre à direita (segmentado, select...). */
function Row({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="cfg-row">
      <div className="ui-toggle-text">
        <span className="ui-toggle-title">{title}</span>
        {description && <span className="ui-toggle-desc">{description}</span>}
      </div>
      <div className="cfg-row-control">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function ConnectionSection({ status, onChange }: { status: ApiStatus; onChange: () => void }) {
  const s = status.settings;
  const isDemo = (status.telemetrySource ?? (status.simulator ? 'demo' : 'gt7')) === 'demo';
  const { busy, run } = useSave();
  const patch = async (p: ApiSettingsPatch, ok: string) => {
    if (await run(() => api.patchSettings(p), ok)) onChange();
  };
  return (
    <Panel
      title={uiText('Integração de telemetria')}
      description={uiText('Como o app recebe os dados do jogo e o que ele guarda.')}
      id="conexao"
    >
      <div className="cfg-integration">
        <strong>{GT7_INTEGRATION.name}</strong>
        <span className="ui-badge" data-tone="accent">
          {GT7_INTEGRATION.platform}
        </span>
      </div>
      <div className="cx-inline">
        <ConnectionDetails />
      </div>
      {isDemo && (
        <div className="ui-card cfg-note" data-tone="warn" role="note">
          <span className="ui-badge" data-tone="warn">
            Demo
          </span>
          <span>{uiText('Modo demonstração: o console é simulado dentro do app.')}</span>
        </div>
      )}

      <div className="cfg-list">
        <Toggle
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
          hint={s.liveFormatAuto ? uiText('Para fixar um formato, abra “Avançado”.') : undefined}
          onChange={() => patch({ liveFormatAuto: true }, uiText('Formato automático ligado.'))}
        />
        <Toggle
          title={uiText('Gravar sessões brutas')}
          description={uiText(
            'Guarda todo pacote (~20 KB/s) para reprocessar depois e baixar o .gt7rec. Ocupa espaço em disco; deixe desligado se não precisar.',
          )}
          checked={s.record}
          disabled={busy}
          onChange={() =>
            patch(
              { record: !s.record },
              s.record ? uiText('Gravação desligada.') : uiText('Gravação ligada.'),
            )
          }
        />
        <Row
          title={uiText('Referência padrão do delta')}
          description={uiText('Cada aparelho ainda pode trocar com toque duplo no painel.')}
        >
          <fieldset className="ui-segmented" aria-label={uiText('Referência padrão do delta')}>
            {DELTA_REFERENCE_KINDS.map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={s.deltaReference.kind === k}
                disabled={busy}
                onClick={() =>
                  patch(
                    { deltaReference: { kind: k } },
                    uiText('Delta contra: {0}.', DELTA_REFERENCE_LABELS[k]),
                  )
                }
              >
                {DELTA_REFERENCE_LABELS[k]}
              </button>
            ))}
          </fieldset>
        </Row>
      </div>

      <details className="cfg-adv">
        <summary>{uiText('Avançado: formato do pacote')}</summary>
        <div className="cfg-adv-body">
          <p className="cfg-hint">
            {uiText(
              'Só mexa nisto se o modo automático não funcionar. Ao escolher um formato, o app para de trocar sozinho; para voltar, ligue o interruptor “Formato do pacote: automático”.',
            )}
          </p>
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
              'A captura de referência (replay) usa o formato acima: ela não troca mais o formato do pacote, porque o formato atual já entrega os dados do replay.',
            )}
          </p>
        </div>
      </details>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

/** Automatic session capture: one switch. Sessions open and close by themselves. */
function CaptureSection({ status, onChange }: { status: ApiStatus; onChange: () => void }) {
  const on = status.settings.autoCapture;
  const { busy, run } = useSave();
  const toggle = async () => {
    const next = !on;
    const ok = next
      ? uiText('Gravação automática ligada.')
      : uiText('Gravação automática desligada.');
    if (await run(() => api.patchSettings({ autoCapture: next }), ok)) onChange();
  };
  return (
    <Panel
      title={uiText('Captura')}
      description={uiText('Quando o app salva sessões, voltas e pistas por conta própria.')}
      id="captura"
    >
      <div className="cfg-list">
        <Toggle
          title={uiText('Gravar sessões automaticamente')}
          description={
            on
              ? uiText(
                  'Quando você entra numa pista no jogo, o app abre a sessão sozinho e a salva quando você sai. Não há botão de iniciar.',
                )
              : uiText(
                  'Desligado: o painel mostra tudo ao vivo, mas nenhuma sessão, volta ou pista nova é salva.',
                )
          }
          checked={on}
          disabled={busy}
          onChange={toggle}
        />
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

function LanSection({ status, onChange }: { status: ApiStatus; onChange: () => void }) {
  const lan = useFetch('lan', () => api.lan());
  const { busy, run } = useSave();
  const fw = status.firewall;
  return (
    <Panel
      title={uiText('Dispositivo remoto')}
      description={uiText('Abra o painel no celular ou tablet pela rede local.')}
      id="acesso-remoto"
    >
      <div className="cfg-lan">
        <div className="cfg-lan-urls">
          {lan.error ? (
            <ErrorBox error={lan.error} compact />
          ) : !lan.data ? (
            <Loading />
          ) : lan.data.urls.length === 0 ? (
            <p className="cfg-hint">
              {uiText(
                'Nenhum endereço de rede disponível. Conecte o PC e o dispositivo remoto à mesma rede local.',
              )}
            </p>
          ) : (
            <>
              <p className="cfg-lead">
                {uiText(
                  'Escaneie o QR Code com a câmera do dispositivo remoto ou abra um dos endereços abaixo no navegador. Os dois dispositivos precisam estar na mesma rede local.',
                )}
              </p>
              <ul className="cfg-urls">
                {lan.data.urls.map((u) => (
                  <li key={u}>
                    <a href={u} className="num">
                      {u}
                    </a>
                    {u === lan.data!.preferredUrl?.split('?')[0] && (
                      <span className="ui-badge" data-tone="accent">
                        {uiText('preferida')}
                      </span>
                    )}
                    <CopyBtn text={u} />
                  </li>
                ))}
              </ul>
              <p className="cfg-hint">
                {`${uiText(
                  'Se o navegador oferecer “Adicionar à tela inicial”, use essa opção para abrir o painel em tela cheia. Neste PC:',
                )} `}
                <span className="num">{lan.data.localUrl}</span>
              </p>
            </>
          )}
        </div>
        {lan.data?.qrSvgDataUrl && (
          <img
            className="cfg-qr"
            src={lan.data.qrSvgDataUrl}
            alt={uiText('QR Code para abrir o painel em outro dispositivo')}
          />
        )}
      </div>

      <div className="cfg-sub" data-state={fw.state}>
        <div className="cfg-sub-head">
          <div className="ui-toggle-text">
            <span className="ui-toggle-title">
              {uiText('Firewall do Windows')}{' '}
              <span
                className="ui-badge"
                data-tone={fw.state === 'ok' ? 'gain' : fw.state === 'missing' ? 'loss' : 'accent'}
              >
                {fw.state === 'ok'
                  ? uiText('liberado')
                  : fw.state === 'missing'
                    ? uiText('faltam regras')
                    : uiText('não verificado')}
              </span>
            </span>
            <span className="ui-toggle-desc">{fw.message}</span>
          </div>
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            data-size="sm"
            disabled={busy}
            onClick={async () => {
              if (await run(() => api.firewallCheck(), uiText('Firewall verificado.'))) onChange();
            }}
          >
            <Icon name="refresh" size={14} />
            {uiText('Verificar de novo')}
          </button>
        </div>
        {fw.rules.length > 0 && (
          <ul className="cfg-rules">
            {fw.rules.map((r) => (
              <li key={r.name}>
                <span
                  className="cfg-rule-mark"
                  data-tone={r.present ? 'gain' : r.present === false ? 'loss' : undefined}
                >
                  {r.present ? '✓' : r.present === false ? '✗' : '?'}
                </span>
                {r.name}
                {!r.name.includes(String(r.port)) && (
                  <span className="cfg-muted">
                    {' '}
                    ({r.protocol} {r.port})
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {fw.state !== 'ok' && fw.powershellCommands.length > 0 && (
          <>
            <CodeBlock
              label={uiText('PowerShell como administrador')}
              code={fw.powershellCommands.join('\n')}
            />
            {fw.netshCommands.length > 0 && (
              <CodeBlock
                label={uiText('Alternativa (netsh, prompt de administrador)')}
                code={fw.netshCommands.join('\n')}
              />
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

function DevicesSection() {
  const devices = useFetch('devices', () => api.devices(), 5000);
  const myId = useUi((s) => s.profile.deviceId);
  const [views, setViews] = useState<Record<string, ViewId>>({});
  const { busy, run } = useSave();
  const list = (devices.data ?? []).slice().sort((a, b) => Number(b.online) - Number(a.online));
  return (
    <Panel
      title={uiText('Aparelhos conectados')}
      description={uiText('Painéis abertos agora e a tela que cada um está mostrando.')}
      id="dispositivos"
    >
      {devices.error && !devices.data ? (
        <ErrorBox error={devices.error} compact />
      ) : !devices.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <div className="ui-empty">
          <strong>{uiText('Nenhum painel conectado ainda')}</strong>
          <p>{uiText('Use o QR Code ou o endereço da seção “Dispositivo remoto”.')}</p>
        </div>
      ) : (
        <div className="cfg-table-wrap cfg-devices">
          <table className="cfg-table">
            <thead>
              <tr>
                <th>{uiText('Aparelho')}</th>
                <th>{uiText('Situação')}</th>
                <th>{uiText('Tela atual')}</th>
                <th>{uiText('Mostrar no aparelho')}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d: DeviceInfo) => {
                const enabled = d.profile?.views?.length ? d.profile.views : VIEW_IDS;
                const sel = views[d.deviceId] ?? d.currentView ?? enabled[0] ?? 'corrida';
                return (
                  <tr key={d.deviceId}>
                    <td>
                      <strong>{d.name}</strong>
                      {d.deviceId === myId && (
                        <>
                          {' '}
                          <span className="ui-badge" data-tone="accent">
                            {uiText('este')}
                          </span>
                        </>
                      )}
                      <div className="cfg-muted cfg-id">{d.deviceId}</div>
                    </td>
                    <td>
                      {d.online ? (
                        <span className="ui-badge" data-tone="gain">
                          online{d.connections > 1 ? uiText(' · {0} abas', d.connections) : ''}
                        </span>
                      ) : (
                        <span className="cfg-muted">offline · {formatAgo(d.lastSeenAt)}</span>
                      )}
                    </td>
                    <td>
                      <span className="cfg-cell-label" aria-hidden="true">
                        {uiText('Tela atual')}
                      </span>
                      {d.currentView ? VIEW_LABELS[d.currentView] : '–'}
                    </td>
                    <td>
                      <div className="cfg-device-actions">
                        <select
                          className="ui-select"
                          value={sel}
                          aria-label={uiText('Tela para {0}', d.name)}
                          onChange={(e) =>
                            setViews({ ...views, [d.deviceId]: e.target.value as ViewId })
                          }
                        >
                          {VIEW_IDS.map((v) => (
                            <option key={v} value={v} disabled={!enabled.includes(v)}>
                              {VIEW_LABELS[v]}
                              {enabled.includes(v) ? '' : uiText(' (desligada)')}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="ui-btn"
                          data-size="sm"
                          disabled={!d.online || busy}
                          onClick={async () => {
                            if (
                              await run(
                                () => api.showView(d.deviceId, sel, myId),
                                `${d.name}: ${VIEW_LABELS[sel]}.`,
                              )
                            ) {
                              setTimeout(devices.reload, 600);
                            }
                          }}
                        >
                          {uiText('Mostrar tela')}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

const DESKTOP_CONFIG_PATH = '%APPDATA%\\Claude\\claude_desktop_config.json';

function McpSection({ status }: { status: ApiStatus }) {
  const info = useFetch('mcpinfo', () => api.mcpInfo());
  const i = info.data;
  const lanUrl = i?.http.lanUrls[0] ?? null;
  const localUrl = i?.http.localUrl ?? `http://localhost:${status.httpPort}/mcp`;
  const tokenRequired = i?.http.tokenRequired ?? status.tokenRequired;
  const codexConfig = [
    '[mcp_servers.bono]',
    `url = ${JSON.stringify(localUrl)}`,
    ...(tokenRequired ? ['bearer_token_env_var = "GT7_TOKEN"'] : []),
  ].join('\n');
  return (
    <Panel
      title={uiText('Integração com IA (MCP)')}
      description={uiText(
        'Opcional. Permite que o Codex ou o Claude consultem suas voltas e análises. Copie o trecho para o seu cliente; os endereços e caminhos correspondem a esta instalação.',
      )}
      id="mcp"
    >
      <div className="cfg-stack">
        <section className="cfg-client">
          <h3 className="cfg-h3">{uiText('Codex (com o app aberto — inclui o estado ao vivo)')}</h3>
          <CodeBlock
            label={uiText('Adicione ao ~/.codex/config.toml e reinicie o Codex')}
            code={codexConfig}
          />
          {tokenRequired && (
            <p className="cfg-hint">
              {`${uiText('Defina')} `}
              <code>GT7_TOKEN</code>
              {` ${uiText('no ambiente do Codex com o mesmo token de acesso do app.')}`}
            </p>
          )}
        </section>
        <section className="cfg-client">
          <h3 className="cfg-h3">
            {uiText('Claude Code (com o app aberto — inclui o estado ao vivo)')}
          </h3>
          {i && <CodeBlock label={uiText('Cole no terminal')} code={i.claudeCode.http} />}
          <ul className="cfg-urls">
            <li>
              <span className="num">{localUrl}</span>
              <span className="cfg-muted">{uiText('endereço neste PC')}</span>
              <CopyBtn text={localUrl} />
            </li>
            {lanUrl && (
              <li>
                <span className="num">{lanUrl}</span>
                <span className="cfg-muted">{uiText('de outro PC da rede')}</span>
                <CopyBtn text={lanUrl} />
              </li>
            )}
          </ul>
        </section>
        <section className="cfg-client">
          <h3 className="cfg-h3">
            {uiText('Claude Desktop (lê os dados salvos, mesmo com o app fechado)')}
          </h3>
          {info.error && !i && <ErrorBox error={info.error} compact onRetry={info.reload} />}
          {!i && !info.error && <Loading />}
          {i && (
            <CodeBlock
              label={uiText('Cole em {0} e reinicie o Claude Desktop', DESKTOP_CONFIG_PATH)}
              code={JSON.stringify(i.claudeDesktopConfig, null, 2)}
            />
          )}
        </section>
        {i && (
          <details className="cfg-adv">
            <summary>{uiText('Avançado: outras formas de conectar')}</summary>
            <div className="cfg-adv-body">
              {i.repoRoot && (
                <p className="cfg-hint">
                  {`${uiText('Pasta do repositório:')} `}
                  <span className="num">{i.repoRoot}</span>
                </p>
              )}
              <CodeBlock
                label={uiText('Claude Code (lê os dados salvos)')}
                code={i.claudeCode.stdio}
              />
              <CodeBlock label={uiText('Linha de comando')} code={i.stdio.commandLine} />
              {i.stdio.npmCommandLine && (
                <CodeBlock
                  label={uiText('Dentro da pasta do repositório')}
                  code={i.stdio.npmCommandLine}
                />
              )}
              <p className="cfg-hint">
                {i.repoRoot ? (
                  <>
                    O <code>--import</code>
                    {` ${uiText('precisa ser uma URL')} `}
                    <code>file:///</code>
                    {` ${uiText('absoluta.')}`}
                  </>
                ) : (
                  <>
                    {uiText('O executável do app roda o servidor MCP como Node graças a')}{' '}
                    <code>ELECTRON_RUN_AS_NODE=1</code>
                    {uiText('; não precisa instalar nada.')}
                  </>
                )}{' '}
                {`${uiText('Detalhes em')} `}
                <code>packages/mcp/README.md</code>.
              </p>
            </div>
          </details>
        )}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

function CoachSection() {
  const cfg = useFetch('coachcfg', () => api.coachConfig());
  const [key, setKey] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { busy, run } = useSave();
  const apply = async (p: Parameters<typeof api.putCoachConfig>[0], ok: string) => {
    const r = await run(() => api.putCoachConfig(p), ok);
    if (r) cfg.setData(r as CoachConfig);
    return r;
  };
  if (cfg.error && !cfg.data) {
    return (
      <Panel title={uiText('Coach IA (Claude)')} id="coach">
        <ErrorBox
          error={
            cfg.error.status === 404
              ? uiText(
                  'Este servidor ainda não tem o coach de IA (endpoint /api/coach/config ausente).',
                )
              : cfg.error
          }
          compact
          onRetry={cfg.reload}
        />
      </Panel>
    );
  }
  const c = cfg.data;
  return (
    <Panel
      title={uiText('Coach IA (Claude)')}
      description={uiText('O debrief em linguagem natural usa a API da Anthropic com a sua chave.')}
      id="coach"
    >
      {!c ? (
        <Loading />
      ) : (
        <div className="cfg-stack">
          <div className="cfg-keystate">
            <span className="ui-label">{uiText('Chave da API')}</span>
            {c.hasKey ? (
              <span className="cfg-keyline">
                <span className="ui-badge" data-tone="gain">
                  {uiText('configurada')}
                </span>
                <span className="num">…{c.keyLast4}</span>
                <span className="cfg-muted">
                  {c.keySource === 'env'
                    ? uiText('variável ANTHROPIC_API_KEY — tem prioridade')
                    : uiText('salva no app')}
                </span>
              </span>
            ) : (
              <span className="ui-badge" data-tone="loss">
                {uiText('sem chave')}
              </span>
            )}
          </div>
          <form
            className="cfg-keyform"
            autoComplete="off"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!key.trim()) return;
              if (await apply({ apiKey: key.trim() }, uiText('Chave salva.'))) setKey('');
            }}
          >
            <div className="ui-field">
              <label className="ui-label" htmlFor="coach-key">
                {uiText('Chave da API da Anthropic')}
              </label>
              <div className="cfg-inputrow">
                <input
                  id="coach-key"
                  className="ui-input"
                  type="password"
                  value={key}
                  placeholder={c.hasKey ? uiText('Digite para trocar a chave') : 'sk-ant-…'}
                  autoComplete="new-password"
                  spellCheck={false}
                  onChange={(e) => setKey(e.target.value)}
                />
                <button type="submit" className="ui-btn" disabled={busy || !key.trim()}>
                  {uiText('Salvar chave')}
                </button>
                {c.keySource === 'settings' && (
                  <button
                    type="button"
                    className="ui-btn"
                    data-variant="danger"
                    disabled={busy}
                    onClick={() => setConfirmRemove(true)}
                  >
                    {uiText('Remover chave')}
                  </button>
                )}
              </div>
              <span className="ui-help">
                {uiText(
                  'A chave fica só no PC (banco local) e nunca volta para o navegador — aqui aparecem só os 4 últimos caracteres. Crie uma em console.anthropic.com.',
                )}
              </span>
            </div>
          </form>
          <label className="ui-field">
            <span className="ui-label">{uiText('Modelo')}</span>
            <select
              className="ui-select"
              value={c.model}
              disabled={busy}
              onChange={(e) => apply({ model: e.target.value }, uiText('Modelo salvo.'))}
            >
              {c.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                  {m.id === c.defaultModel ? uiText(' (padrão)') : ''}
                </option>
              ))}
            </select>
            <span className="ui-help">{c.models.find((m) => m.id === c.model)?.description}</span>
          </label>
          <details className="cfg-adv">
            <summary>{uiText('Avançado: esforço e relatórios guardados')}</summary>
            <div className="cfg-adv-body cfg-two">
              <label className="ui-field">
                <span className="ui-label">{uiText('Esforço')}</span>
                <select
                  className="ui-select"
                  value={c.effort}
                  disabled={busy}
                  onChange={(e) =>
                    apply({ effort: e.target.value as CoachEffort }, uiText('Esforço salvo.'))
                  }
                >
                  {(Object.keys(EFFORT_LABELS) as CoachEffort[]).map((k) => (
                    <option key={k} value={k}>
                      {EFFORT_LABELS[k]}
                    </option>
                  ))}
                </select>
                <span className="ui-help">
                  {`${uiText('Até')} `}
                  {c.maxToolIterations}
                  {` ${uiText('rodadas de ferramentas por pedido.')}`}
                </span>
              </label>
              <label className="ui-field">
                <span className="ui-label">{uiText('Relatórios guardados')}</span>
                <select
                  className="ui-select"
                  value={c.maxReports}
                  disabled={busy}
                  onChange={(e) =>
                    apply(
                      { maxReports: Number(e.target.value) },
                      uiText('Limite de relatórios salvo.'),
                    )
                  }
                >
                  {[...new Set([10, 25, 50, 100, 200, c.maxReports])]
                    .sort((x, y) => x - y)
                    .map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                </select>
                <span className="ui-help">
                  {uiText(
                    'Os mais antigos são apagados ao terminar um novo (cada um guarda os gráficos).',
                  )}
                </span>
              </label>
            </div>
          </details>
          <ConfirmModal
            open={confirmRemove}
            title={uiText('Remover a chave da API?')}
            message={
              <>
                <p>
                  {uiText(
                    'A chave salva neste PC será apagada e o coach de IA deixa de funcionar aqui.',
                  )}
                </p>
                <p>{uiText('Você pode informar uma chave de novo quando quiser.')}</p>
              </>
            }
            confirmLabel={uiText('Remover chave')}
            busy={busy}
            onClose={() => setConfirmRemove(false)}
            onConfirm={async () => {
              await apply({ apiKey: null }, uiText('Chave removida.'));
              setConfirmRemove(false);
            }}
          />
        </div>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

function DataSection({ status }: { status: ApiStatus }) {
  const info = useFetch('mcpinfo', () => api.mcpInfo());
  const dir = info.data?.dataDir ?? null;
  return (
    <Panel
      title={uiText('Seus dados')}
      description={uiText('Suas sessões, voltas e gravações ficam só neste PC.')}
      id="dados"
    >
      <div className="cfg-stack">
        <div className="ui-field">
          <span className="ui-label">{uiText('Pasta dos dados')}</span>
          {info.error && !dir ? (
            <ErrorBox error={info.error} compact onRetry={info.reload} />
          ) : !dir ? (
            <Loading />
          ) : (
            <div className="cfg-datapath">
              <span className="num">{dir}</span>
              <CopyBtn text={dir} label={uiText('Copiar caminho')} />
            </div>
          )}
        </div>
        <p className="cfg-hint">
          {uiText(
            'Para fazer uma cópia de segurança, feche o app e copie essa pasta inteira. Ela fica fora da pasta do programa, então atualizar ou reinstalar o app não apaga nada.',
          )}
        </p>
        {status.simulator && (
          <div className="ui-card cfg-note" data-tone="warn" role="note">
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
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

function AboutSection({ status }: { status: ApiStatus }) {
  return (
    <Panel title={uiText('Sobre')} id="sobre">
      <div className="cfg-list">
        <Row
          title={PRODUCT_NAME}
          description={
            <>
              {`${uiText('Versão')} `}
              <span className="num">{status.serverVersion}</span>
              {` ${uiText('· porta')}`} <span className="num">{status.httpPort}</span>
              {status.tokenRequired ? uiText(' · acesso com senha (token)') : ''}
            </>
          }
        >
          <span className="ui-badge">v{status.serverVersion}</span>
        </Row>
        <Row
          title={uiText('Assistente de boas-vindas')}
          description={uiText(
            'Mostra de novo como encontrar o PS5 e abrir o painel em outro dispositivo.',
          )}
        >
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            onClick={() => {
              saveString(ONBOARDING_KEY, '0');
              useUi.setState({ onboarding: 'active' });
            }}
          >
            {uiText('Rever o assistente')}
          </button>
        </Row>
      </div>
      <p className="cfg-hint cfg-credit">
        {uiText(
          'Projeto pessoal, sem relação com a Polyphony Digital. O protocolo de telemetria do GT7 não tem documentação oficial; vem de engenharia reversa da comunidade.',
        )}
      </p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------

/** Old section anchors (links in the README / other pages) → current ids. */
const SECTION_ALIASES: Record<string, string> = {
  console: 'conexao',
  lan: 'acesso-remoto',
  celular: 'acesso-remoto',
};

const SECTIONS: { id: string; label: string; desktopOnly?: boolean }[] = [
  {
    id: 'idioma',
    get label() {
      return uiText('Idioma');
    },
  },
  {
    id: 'conexao',
    get label() {
      return uiText('Conexão');
    },
  },
  {
    id: 'captura',
    get label() {
      return uiText('Captura');
    },
  },
  {
    id: 'acesso-remoto',
    get label() {
      return uiText('Dispositivo remoto');
    },
  },
  {
    id: 'dispositivos',
    get label() {
      return uiText('Aparelhos');
    },
  },
  {
    id: 'discord',
    get label() {
      return uiText('Rádio no Discord');
    },
    desktopOnly: true,
  },
  {
    id: 'coach',
    get label() {
      return uiText('Coach IA');
    },
  },
  {
    id: 'dados',
    get label() {
      return uiText('Dados');
    },
  },
  {
    id: 'mcp',
    get label() {
      return uiText('Integração com IA');
    },
  },
  {
    id: 'sobre',
    get label() {
      return uiText('Sobre');
    },
  },
];

export function ConfigPage({ route }: { route: Route }) {
  useTitle(uiText('Configurações'));
  const status = useFetch('status', () => api.status(), 10000);
  const requested = route.query.s;
  const section = requested ? (SECTION_ALIASES[requested] ?? requested) : undefined;
  const [active, setActive] = useState<string>(section ?? 'idioma');
  const hasDiscord = !!window.bonoDiscord;
  const tabs = SECTIONS.filter((s) => !s.desktopOnly || hasDiscord);
  const ready = !!status.data;

  useEffect(() => {
    if (section && (ready || section === 'idioma')) {
      document.getElementById(section)?.scrollIntoView({ block: 'start' });
      setActive(section);
    }
  }, [section, ready]);

  // Mantém a aba ativa visível na faixa de abas (que rola de lado no celular).
  // biome-ignore lint/correctness/useExhaustiveDependencies: roda quando a aba ativa muda
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('.cfg-nav');
    const tab = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !tab) return;
    nav.scrollTo({
      left: tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2,
      behavior: 'smooth',
    });
  }, [active]);

  // Marca a aba da seção que está sob a faixa de abas.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tabs` só muda com hasDiscord
  useEffect(() => {
    if (!ready) return;
    const ids = tabs.map((t) => t.id);
    let raf = 0;
    const update = () => {
      raf = 0;
      const navBottom = document.querySelector('.cfg-nav')?.getBoundingClientRect().bottom ?? 0;
      let current = ids[0] ?? 'conexao';
      for (const id of ids) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= navBottom + 24) current = id;
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom && window.scrollY > 0) current = ids[ids.length - 1] ?? current;
      setActive(current);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ready, hasDiscord]);

  return (
    <div className="cfg-page">
      <PageHead
        title={uiText('Configurações')}
        sub={uiText('Tudo se ajusta aqui: nada de arquivo de configuração.')}
        actions={<FullscreenButton />}
      />
      <nav className="ui-tabs cfg-nav" aria-label={uiText('Seções')}>
        {tabs.map((t) => (
          <a
            key={t.id}
            href={routes.config(t.id)}
            aria-current={active === t.id ? 'page' : undefined}
            onClick={(e) => {
              if (section === t.id) {
                e.preventDefault();
                document.getElementById(t.id)?.scrollIntoView({ block: 'start' });
              }
              setActive(t.id);
            }}
          >
            {t.label}
          </a>
        ))}
      </nav>
      <div className="cfg-main">
        <LanguageSettings />
        {status.error && !status.data ? (
          <>
            <ErrorBox error={status.error} onRetry={status.reload} />
            <DiscordSettings />
          </>
        ) : !status.data ? (
          <>
            <Loading />
            <DiscordSettings />
          </>
        ) : (
          <>
            <ConnectionSection status={status.data} onChange={status.reload} />
            <CaptureSection status={status.data} onChange={status.reload} />
            <LanSection status={status.data} onChange={status.reload} />
            <DevicesSection />
            <DiscordSettings />
            <CoachSection />
            <DataSection status={status.data} />
            <McpSection status={status.data} />
            <AboutSection status={status.data} />
          </>
        )}
      </div>
    </div>
  );
}
