/**
 * #/config — console & packet formats, recording, default delta reference, firewall, LAN URLs + QR,
 * connected devices (remote "show view"), MCP connection snippets and the AI coach settings.
 */

import {
  type ApiSettingsPatch,
  type ApiStatus,
  type CoachConfig,
  type CoachEffort,
  DELTA_REFERENCE_KINDS,
  type DeviceInfo,
  PACKET_FORMATS,
  VIEW_IDS,
  type ViewId,
} from '@gt7/shared';
import { useEffect, useState } from 'react';
import { DELTA_REFERENCE_LABELS, VIEW_LABELS } from '../../lib/labels.ts';
import type { Route } from '../../lib/route.ts';
import { addNotice, useUi } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import {
  Card,
  CodeBlock,
  CopyButton,
  ErrorBox,
  Loading,
  PageHead,
  Tag,
  useTitle,
} from '../components/ui.tsx';
import { formatAgo, PACKET_FORMAT_INFO } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';

const EFFORT_LABELS: Record<CoachEffort, string> = {
  low: 'Baixo (rápido e barato)',
  medium: 'Médio',
  high: 'Alto (análise mais profunda)',
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

// ---------------------------------------------------------------------------------------------

function ConsoleSection({ status, onChange }: { status: ApiStatus; onChange: () => void }) {
  const s = status.settings;
  const [ip, setIp] = useState(s.consoleIp ?? '');
  const { busy, run } = useSave();
  useEffect(() => setIp(s.consoleIp ?? ''), [s.consoleIp]);
  const patch = async (p: ApiSettingsPatch, ok: string) => {
    if (await run(() => api.patchSettings(p), ok)) onChange();
  };
  const ipValid = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(ip.trim());
  return (
    <Card title="Console e formatos" id="console">
      <form
        className="a-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ipValid) void patch({ consoleIp: ip.trim() }, 'IP do console salvo.');
        }}
      >
        <label>
          IP do PlayStation
          <input
            className="a-input num"
            value={ip}
            placeholder="192.168.0.20"
            inputMode="decimal"
            onChange={(e) => setIp(e.target.value)}
            aria-invalid={ip.trim() !== '' && !ipValid}
          />
        </label>
        <button
          type="submit"
          className="a-btn"
          disabled={busy || !ipValid || ip.trim() === s.consoleIp}
        >
          Salvar
        </button>
        <span className="dim a-small">
          {status.consoleIp
            ? `Em uso: ${status.consoleIp}`
            : 'Sem IP: o app procura o console por broadcast.'}
          {status.simulator && ' · modo demonstração (console simulado)'}
        </span>
      </form>

      <div className="a-format-grid a-mt">
        <fieldset className="a-fieldset">
          <legend>Formato ao vivo</legend>
          {PACKET_FORMATS.map((f) => (
            <label key={f} className="a-radio">
              <input
                type="radio"
                name="liveFormat"
                checked={s.liveFormat === f}
                disabled={busy}
                onChange={() =>
                  patch({ liveFormat: f }, `Trocando para o formato ${f} (até ~15 s).`)
                }
              />
              <span>
                <strong>{PACKET_FORMAT_INFO[f].label}</strong>
                <span className="dim a-small">{PACKET_FORMAT_INFO[f].text}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="a-fieldset">
          <legend>Formato da captura de replay</legend>
          {PACKET_FORMATS.map((f) => (
            <label key={f} className="a-radio">
              <input
                type="radio"
                name="captureFormat"
                checked={s.captureFormat === f}
                disabled={busy}
                onChange={() => patch({ captureFormat: f }, `Capturas usarão o formato ${f}.`)}
              />
              <span>
                <strong>
                  {f === 'B' ? 'B (recomendado para replay)' : PACKET_FORMAT_INFO[f].label}
                </strong>
                {f === '~' && <span className="dim a-small">Não funciona em replay.</span>}
              </span>
            </label>
          ))}
          <p className="dim a-small">
            O jogo só manda <strong>~</strong> ao vivo; em replay use <strong>B</strong>. A troca de
            formato espera ~15 s (o console precisa parar de receber o pedido anterior).
          </p>
        </fieldset>
      </div>

      <div className="a-setting-row a-mt">
        <div>
          <strong>Gravar sessões brutas</strong>
          <div className="dim a-small">
            Guarda todo pacote (~20 KB/s) para reprocessar depois e baixar o .gt7rec.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={s.record}
          aria-label="Gravar sessões brutas"
          className="switch"
          disabled={busy}
          onClick={() =>
            patch({ record: !s.record }, s.record ? 'Gravação desligada.' : 'Gravação ligada.')
          }
        >
          <span className="switch-knob" />
        </button>
      </div>

      <div className="a-setting-row a-mt">
        <div>
          <strong>Referência padrão do delta</strong>
          <div className="dim a-small">
            Cada aparelho ainda pode trocar com toque duplo no painel.
          </div>
        </div>
        <fieldset className="a-seg" aria-label="Referência padrão do delta">
          {DELTA_REFERENCE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={s.deltaReference.kind === k}
              disabled={busy}
              onClick={() =>
                patch(
                  { deltaReference: { kind: k } },
                  `Delta contra: ${DELTA_REFERENCE_LABELS[k]}.`,
                )
              }
            >
              {DELTA_REFERENCE_LABELS[k]}
            </button>
          ))}
        </fieldset>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

function LanSection({ status, onChange }: { status: ApiStatus; onChange: () => void }) {
  const lan = useFetch('lan', () => api.lan());
  const { busy, run } = useSave();
  const fw = status.firewall;
  return (
    <Card title="Abrir no celular" id="lan">
      <div className="a-lan">
        <div className="a-lan-urls">
          {lan.error ? (
            <ErrorBox error={lan.error} compact />
          ) : !lan.data ? (
            <Loading />
          ) : lan.data.urls.length === 0 ? (
            <p className="dim">
              Nenhuma rede local encontrada. Conecte o PC ao Wi-Fi/cabo da mesma rede do celular.
            </p>
          ) : (
            <>
              <p>Abra no navegador do celular (mesma rede Wi-Fi):</p>
              <ul className="a-url-list">
                {lan.data.urls.map((u) => (
                  <li key={u}>
                    <a href={u} className="num">
                      {u}
                    </a>
                    <CopyButton text={u} />
                    {u === lan.data!.preferredUrl?.split('?')[0] && (
                      <Tag tone="info">preferida</Tag>
                    )}
                  </li>
                ))}
              </ul>
              <p className="dim a-small">
                No celular use “Adicionar à tela inicial” para abrir em tela cheia. Neste PC:{' '}
                <span className="num">{lan.data.localUrl}</span>
              </p>
            </>
          )}
        </div>
        {lan.data?.qrSvgDataUrl && (
          <img
            className="a-qr"
            src={lan.data.qrSvgDataUrl}
            alt={`QR code de ${lan.data.preferredUrl ?? ''}`}
          />
        )}
      </div>

      <div className="a-firewall a-mt" data-state={fw.state}>
        <div className="a-setting-row">
          <div>
            <strong>Firewall do Windows</strong>{' '}
            <Tag tone={fw.state === 'ok' ? 'sb' : fw.state === 'missing' ? 'bad' : 'info'}>
              {fw.state === 'ok'
                ? 'liberado'
                : fw.state === 'missing'
                  ? 'faltam regras'
                  : 'não verificado'}
            </Tag>
            <div className="dim a-small">{fw.message}</div>
          </div>
          <button
            type="button"
            className="a-btn a-btn-ghost a-btn-sm"
            disabled={busy}
            onClick={async () => {
              if (await run(() => api.firewallCheck(), 'Firewall verificado.')) onChange();
            }}
          >
            Verificar de novo
          </button>
        </div>
        {fw.rules.length > 0 && (
          <ul className="a-rules">
            {fw.rules.map((r) => (
              <li key={r.name}>
                <span data-tone={r.present ? 'gain' : r.present === false ? 'loss' : undefined}>
                  {r.present ? '✓' : r.present === false ? '✗' : '?'}
                </span>{' '}
                {r.name}
                {!r.name.includes(String(r.port)) && (
                  <span className="dim">
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
              label="PowerShell como administrador"
              code={fw.powershellCommands.join('\n')}
            />
            {fw.netshCommands.length > 0 && (
              <CodeBlock
                label="Alternativa (netsh, prompt de administrador)"
                code={fw.netshCommands.join('\n')}
              />
            )}
          </>
        )}
      </div>
    </Card>
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
    <Card title="Dispositivos" id="dispositivos">
      {devices.error && !devices.data ? (
        <ErrorBox error={devices.error} compact />
      ) : !devices.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <p className="dim">Nenhum painel conectado ainda. Abra a URL da rede local no celular.</p>
      ) : (
        <div className="a-table-wrap">
          <table className="a-table">
            <thead>
              <tr>
                <th>Aparelho</th>
                <th>Situação</th>
                <th>Tela atual</th>
                <th>Controle remoto</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d: DeviceInfo) => {
                const enabled = d.profile?.views?.length ? d.profile.views : VIEW_IDS;
                const sel = views[d.deviceId] ?? d.currentView ?? enabled[0] ?? 'corrida';
                return (
                  <tr key={d.deviceId}>
                    <td>
                      {d.name}
                      {d.deviceId === myId && <Tag tone="info">este</Tag>}
                      <div className="dim a-small">{d.deviceId}</div>
                    </td>
                    <td>
                      {d.online ? (
                        <Tag tone="sb">
                          online{d.connections > 1 ? ` · ${d.connections} abas` : ''}
                        </Tag>
                      ) : (
                        <span className="dim">offline · {formatAgo(d.lastSeenAt)}</span>
                      )}
                    </td>
                    <td>{d.currentView ? VIEW_LABELS[d.currentView] : '–'}</td>
                    <td>
                      <div className="a-row-actions">
                        <select
                          value={sel}
                          aria-label={`Tela para ${d.name}`}
                          onChange={(e) =>
                            setViews({ ...views, [d.deviceId]: e.target.value as ViewId })
                          }
                        >
                          {VIEW_IDS.map((v) => (
                            <option key={v} value={v} disabled={!enabled.includes(v)}>
                              {VIEW_LABELS[v]}
                              {enabled.includes(v) ? '' : ' (desligada)'}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="a-btn a-btn-sm"
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
                          Mostrar tela
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
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

/** MCP snippets; the repo path is not exposed by the API, so it is a placeholder to edit. */
export function mcpSnippets(httpUrl: string, repo = 'C:\\caminho\\para\\gt7') {
  const fwd = repo.replace(/\\/g, '/');
  const desktop = JSON.stringify(
    {
      mcpServers: {
        gt7: {
          command: 'node',
          args: [
            '--disable-warning=ExperimentalWarning',
            '--import',
            `file:///${fwd}/node_modules/tsx/dist/loader.mjs`,
            `${repo}\\packages\\mcp\\src\\stdio.ts`,
            '--data',
            `${repo}\\data`,
          ],
        },
      },
    },
    null,
    2,
  );
  const code = `claude mcp add gt7 -- node --disable-warning=ExperimentalWarning --import file:///${fwd}/node_modules/tsx/dist/loader.mjs ${repo}\\packages\\mcp\\src\\stdio.ts --data ${repo}\\data`;
  const http = `claude mcp add --transport http gt7-live ${httpUrl}`;
  return { desktop, code, http };
}

function McpSection({ status }: { status: ApiStatus }) {
  const lanHost = status.lanUrls[0] ? new URL(status.lanUrls[0]).hostname : null;
  const localUrl = `http://localhost:${status.httpPort}/mcp`;
  const lanUrl = lanHost ? `http://${lanHost}:${status.httpPort}/mcp` : null;
  const [repo, setRepo] = useState('C:\\caminho\\para\\gt7');
  const s = mcpSnippets(localUrl, repo);
  return (
    <Card title="IA no Claude Desktop / Claude Code (MCP)" id="mcp">
      <p>
        As mesmas ferramentas do coach (comparar voltas, curvas, consistência, evolução, gráficos)
        ficam disponíveis para o Claude pelo protocolo MCP.
      </p>
      <h3 className="a-h3">HTTP (com o app rodando — inclui o estado ao vivo)</h3>
      <ul className="a-url-list">
        <li>
          <span className="num">{localUrl}</span> <CopyButton text={localUrl} />
          <span className="dim a-small"> neste PC</span>
        </li>
        {lanUrl && (
          <li>
            <span className="num">{lanUrl}</span> <CopyButton text={lanUrl} />
            <span className="dim a-small"> de outro PC da rede</span>
          </li>
        )}
      </ul>
      <CodeBlock label="Claude Code" code={s.http} />
      <h3 className="a-h3">stdio (Claude Desktop lê os dados gravados, mesmo com o app fechado)</h3>
      <label className="a-inline-label">
        Pasta do repositório
        <input
          className="a-input"
          value={repo}
          onChange={(e) => setRepo(e.target.value)}
          spellCheck={false}
        />
      </label>
      <CodeBlock label="%APPDATA%\Claude\claude_desktop_config.json" code={s.desktop} />
      <CodeBlock label="Claude Code (stdio)" code={s.code} />
      <p className="dim a-small">
        O <code>--import</code> precisa ser uma URL <code>file:///</code> absoluta. Detalhes em{' '}
        <code>packages/mcp/README.md</code>.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

function CoachSection() {
  const cfg = useFetch('coachcfg', () => api.coachConfig());
  const [key, setKey] = useState('');
  const { busy, run } = useSave();
  const apply = async (p: Parameters<typeof api.putCoachConfig>[0], ok: string) => {
    const r = await run(() => api.putCoachConfig(p), ok);
    if (r) cfg.setData(r as CoachConfig);
    return r;
  };
  if (cfg.error && !cfg.data) {
    return (
      <Card title="Coach IA (Claude)" id="coach">
        <ErrorBox
          error={
            cfg.error.status === 404
              ? 'Este servidor ainda não tem o coach de IA (endpoint /api/coach/config ausente).'
              : cfg.error
          }
          compact
          onRetry={cfg.reload}
        />
      </Card>
    );
  }
  const c = cfg.data;
  return (
    <Card title="Coach IA (Claude)" id="coach">
      {!c ? (
        <Loading />
      ) : (
        <>
          <p>
            Chave:{' '}
            {c.hasKey ? (
              <>
                <Tag tone="sb">configurada</Tag> <span className="num">…{c.keyLast4}</span>{' '}
                <span className="dim a-small">
                  (
                  {c.keySource === 'env'
                    ? 'variável ANTHROPIC_API_KEY — tem prioridade'
                    : 'salva no app'}
                  )
                </span>
              </>
            ) : (
              <Tag tone="bad">sem chave</Tag>
            )}
          </p>
          <form
            className="a-inline-form"
            autoComplete="off"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!key.trim()) return;
              if (await apply({ apiKey: key.trim() }, 'Chave salva.')) setKey('');
            }}
          >
            <label className="a-grow">
              Chave da API da Anthropic
              <input
                className="a-input"
                type="password"
                value={key}
                placeholder={c.hasKey ? 'Digite para trocar a chave' : 'sk-ant-…'}
                autoComplete="new-password"
                spellCheck={false}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <button type="submit" className="a-btn" disabled={busy || !key.trim()}>
              Salvar chave
            </button>
            {c.keySource === 'settings' && (
              <button
                type="button"
                className="a-btn a-btn-ghost"
                disabled={busy}
                onClick={() => apply({ apiKey: null }, 'Chave removida.')}
              >
                Remover chave
              </button>
            )}
          </form>
          <p className="dim a-small">
            A chave fica só no PC (banco local) e nunca volta para o navegador — aqui aparecem só os
            4 últimos caracteres. Crie uma em console.anthropic.com.
          </p>
          <div className="a-format-grid a-mt">
            <label>
              Modelo
              <select
                value={c.model}
                disabled={busy}
                onChange={(e) => apply({ model: e.target.value }, 'Modelo salvo.')}
              >
                {c.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                    {m.id === c.defaultModel ? ' (padrão)' : ''}
                  </option>
                ))}
              </select>
              <span className="a-help">{c.models.find((m) => m.id === c.model)?.description}</span>
            </label>
            <label>
              Esforço
              <select
                value={c.effort}
                disabled={busy}
                onChange={(e) => apply({ effort: e.target.value as CoachEffort }, 'Esforço salvo.')}
              >
                {(Object.keys(EFFORT_LABELS) as CoachEffort[]).map((k) => (
                  <option key={k} value={k}>
                    {EFFORT_LABELS[k]}
                  </option>
                ))}
              </select>
              <span className="a-help">
                Até {c.maxToolIterations} rodadas de ferramentas por pedido.
              </span>
            </label>
          </div>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

export function ConfigPage({ route }: { route: Route }) {
  useTitle('Configurações');
  const status = useFetch('status', () => api.status(), 10000);
  const section = route.query.s;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll once the content is there
  useEffect(() => {
    if (section && status.data)
      document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [section, !!status.data]);

  return (
    <>
      <PageHead
        title="Configurações"
        sub={
          status.data
            ? `Servidor ${status.data.serverVersion} · porta ${status.data.httpPort}${status.data.tokenRequired ? ' · com token' : ''}`
            : undefined
        }
      />
      <nav className="a-toc" aria-label="Seções">
        <a href="#/config?s=console">Console</a>
        <a href="#/config?s=lan">Celular e firewall</a>
        <a href="#/config?s=dispositivos">Dispositivos</a>
        <a href="#/config?s=mcp">MCP</a>
        <a href="#/config?s=coach">Coach IA</a>
      </nav>
      {status.error && !status.data ? (
        <ErrorBox error={status.error} onRetry={status.reload} />
      ) : !status.data ? (
        <Loading />
      ) : (
        <div className="a-config">
          <ConsoleSection status={status.data} onChange={status.reload} />
          <LanSection status={status.data} onChange={status.reload} />
          <DevicesSection />
          <McpSection status={status.data} />
          <CoachSection />
        </div>
      )}
    </>
  );
}
