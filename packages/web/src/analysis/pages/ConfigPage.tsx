/**
 * #/config — everything is configured here, in plain language: connection with the PS5 (with
 * automatic discovery), phone (QR + firewall), AI coach, data folder, AI integration (MCP) and about.
 * Technical options sit behind "Avançado".
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
import { ConnectionDetails } from '../../components/ConsoleLink.tsx';
import { DELTA_REFERENCE_LABELS, VIEW_LABELS } from '../../lib/labels.ts';
import { ONBOARDING_KEY } from '../../lib/onboarding.ts';
import { type Route, routes } from '../../lib/route.ts';
import { saveString } from '../../lib/storage.ts';
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

function ConnectionSection({ status, onChange }: { status: ApiStatus; onChange: () => void }) {
  const s = status.settings;
  const { busy, run } = useSave();
  const patch = async (p: ApiSettingsPatch, ok: string) => {
    if (await run(() => api.patchSettings(p), ok)) onChange();
  };
  return (
    <Card title="Conexão com o PS5" id="conexao">
      <div className="cx-inline">
        <ConnectionDetails />
      </div>
      {status.simulator && (
        <p className="a-note a-mt">
          <Tag tone="warn">Demo</Tag> Modo demonstração: o console é simulado dentro do app.
        </p>
      )}

      <div className="a-setting-row a-mt">
        <div>
          <strong>Formato do pacote: automático (recomendado)</strong>
          <div className="dim a-small">
            O app descobre sozinho o formato que o seu console aceita.
            {s.liveFormatAuto
              ? ` Em uso agora: ${PACKET_FORMAT_INFO[s.liveFormat].label}.`
              : ` Fixado em ${PACKET_FORMAT_INFO[s.liveFormat].label}.`}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={s.liveFormatAuto}
          aria-label="Formato do pacote automático"
          className="switch"
          disabled={busy || s.liveFormatAuto}
          title={s.liveFormatAuto ? 'Para fixar um formato, abra “Avançado”.' : undefined}
          onClick={() => patch({ liveFormatAuto: true }, 'Formato automático ligado.')}
        >
          <span className="switch-knob" />
        </button>
      </div>

      <div className="a-setting-row a-mt">
        <div>
          <strong>Gravar sessões brutas</strong>
          <div className="dim a-small">
            Guarda todo pacote (~20 KB/s) para reprocessar depois e baixar o .gt7rec. Ocupa espaço
            em disco; deixe desligado se não precisar.
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

      <details className="a-advanced a-mt">
        <summary>Avançado: formato do pacote</summary>
        <p className="dim a-small">
          Só mexa nisto se o modo automático não funcionar. Ao escolher um formato, o app para de
          trocar sozinho; para voltar, ligue o interruptor “Formato do pacote: automático”.
        </p>
        <div className="a-format-grid">
          <fieldset className="a-fieldset">
            <legend>Formato ao vivo</legend>
            <label className="a-radio">
              <input
                type="radio"
                name="liveFormat"
                checked={s.liveFormatAuto}
                disabled={busy}
                onChange={() => patch({ liveFormatAuto: true }, 'Formato automático ligado.')}
              />
              <span>
                <strong>Automático (recomendado)</strong>
                <span className="dim a-small">
                  Testa ~, depois B e A, e guarda o que funcionar.
                </span>
              </span>
            </label>
            {PACKET_FORMATS.map((f) => (
              <label key={f} className="a-radio">
                <input
                  type="radio"
                  name="liveFormat"
                  checked={!s.liveFormatAuto && s.liveFormat === f}
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
          <p className="dim a-small">
            A captura de referência (replay) usa o formato acima: ela não troca mais o formato do
            pacote, porque o formato atual já entrega os dados do replay.
          </p>
        </div>
      </details>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

/** Automatic session capture: one switch. Sessions open and close by themselves. */
function CaptureSection({ status, onChange }: { status: ApiStatus; onChange: () => void }) {
  const on = status.settings.autoCapture;
  const { busy, run } = useSave();
  const toggle = async () => {
    const next = !on;
    const ok = next ? 'Gravação automática ligada.' : 'Gravação automática desligada.';
    if (await run(() => api.patchSettings({ autoCapture: next }), ok)) onChange();
  };
  return (
    <Card title="Captura" id="captura">
      <div className="a-setting-row">
        <div>
          <strong>Gravar sessões automaticamente</strong>
          <div className="dim a-small">
            {on
              ? 'Quando você entra numa pista no jogo, o app abre a sessão sozinho e a salva quando você sai. Não há botão de iniciar.'
              : 'Desligado: o painel mostra tudo ao vivo, mas nenhuma sessão, volta ou pista nova é salva.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Gravar sessões automaticamente"
          className="switch"
          disabled={busy}
          onClick={toggle}
        >
          <span className="switch-knob" />
        </button>
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
    <Card title="Dispositivo remoto" id="acesso-remoto">
      <div className="a-lan">
        <div className="a-lan-urls">
          {lan.error ? (
            <ErrorBox error={lan.error} compact />
          ) : !lan.data ? (
            <Loading />
          ) : lan.data.urls.length === 0 ? (
            <p className="dim">
              Nenhum endereço de rede disponível. Conecte o PC e o dispositivo remoto à mesma rede
              local.
            </p>
          ) : (
            <>
              <p>
                Escaneie o QR Code com a câmera do dispositivo remoto ou abra um dos endereços
                abaixo no navegador. Os dois dispositivos precisam estar na mesma rede local.
              </p>
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
                Se o navegador oferecer “Adicionar à tela inicial”, use essa opção para abrir o
                painel em tela cheia. Neste PC: <span className="num">{lan.data.localUrl}</span>
              </p>
            </>
          )}
        </div>
        {lan.data?.qrSvgDataUrl && (
          <img
            className="a-qr"
            src={lan.data.qrSvgDataUrl}
            alt="QR Code para abrir o painel em outro dispositivo"
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
    <Card title="Aparelhos conectados" id="dispositivos">
      {devices.error && !devices.data ? (
        <ErrorBox error={devices.error} compact />
      ) : !devices.data ? (
        <Loading />
      ) : list.length === 0 ? (
        <p className="dim">
          Nenhum painel conectado ainda. Use o QR Code ou o endereço da seção “Dispositivo remoto”.
        </p>
      ) : (
        <div className="a-table-wrap a-devices-table">
          <table className="a-table">
            <thead>
              <tr>
                <th>Aparelho</th>
                <th>Situação</th>
                <th>Tela atual</th>
                <th>Mostrar no aparelho</th>
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
                    <td>
                      <span className="a-device-mobile-label" aria-hidden="true">
                        Tela atual
                      </span>
                      {d.currentView ? VIEW_LABELS[d.currentView] : '–'}
                    </td>
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

const DESKTOP_CONFIG_PATH = '%APPDATA%\\Claude\\claude_desktop_config.json';

function McpSection({ status }: { status: ApiStatus }) {
  const info = useFetch('mcpinfo', () => api.mcpInfo());
  const i = info.data;
  const lanUrl = i?.http.lanUrls[0] ?? null;
  const localUrl = i?.http.localUrl ?? `http://localhost:${status.httpPort}/mcp`;
  return (
    <Card title="Integração com IA (Claude Desktop / Claude Code)" id="mcp">
      <p>
        Opcional. Permite que o Claude (no seu PC) consulte suas voltas e análises. Copie o trecho
        que combina com o seu programa; os caminhos já são os desta instalação.
      </p>
      <h3 className="a-h3">Claude Code (com o app aberto — inclui o estado ao vivo)</h3>
      {i && <CodeBlock label="Cole no terminal" code={i.claudeCode.http} />}
      <ul className="a-url-list">
        <li>
          <span className="num">{localUrl}</span> <CopyButton text={localUrl} />
          <span className="dim a-small"> endereço neste PC</span>
        </li>
        {lanUrl && (
          <li>
            <span className="num">{lanUrl}</span> <CopyButton text={lanUrl} />
            <span className="dim a-small"> de outro PC da rede</span>
          </li>
        )}
      </ul>
      <h3 className="a-h3">Claude Desktop (lê os dados salvos, mesmo com o app fechado)</h3>
      {info.error && !i && <ErrorBox error={info.error} compact onRetry={info.reload} />}
      {!i && !info.error && <Loading />}
      {i && (
        <CodeBlock
          label={`Cole em ${DESKTOP_CONFIG_PATH} e reinicie o Claude Desktop`}
          code={JSON.stringify(i.claudeDesktopConfig, null, 2)}
        />
      )}
      {i && (
        <details className="a-advanced">
          <summary>Avançado: outras formas de conectar</summary>
          <p className="dim a-small">
            Pasta do repositório: <span className="num">{i.repoRoot}</span>
          </p>
          <CodeBlock label="Claude Code (lê os dados salvos)" code={i.claudeCode.stdio} />
          <CodeBlock label="Linha de comando" code={i.stdio.commandLine} />
          <CodeBlock label="Dentro da pasta do repositório" code={i.stdio.npmCommandLine} />
          <p className="dim a-small">
            O <code>--import</code> precisa ser uma URL <code>file:///</code> absoluta. Detalhes em{' '}
            <code>packages/mcp/README.md</code>.
          </p>
        </details>
      )}
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
          </div>
          <details className="a-advanced a-mt">
            <summary>Avançado: esforço e relatórios guardados</summary>
            <div className="a-format-grid a-mt">
              <label>
                Esforço
                <select
                  value={c.effort}
                  disabled={busy}
                  onChange={(e) =>
                    apply({ effort: e.target.value as CoachEffort }, 'Esforço salvo.')
                  }
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
              <label>
                Relatórios guardados
                <select
                  value={c.maxReports}
                  disabled={busy}
                  onChange={(e) =>
                    apply({ maxReports: Number(e.target.value) }, 'Limite de relatórios salvo.')
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
                <span className="a-help">
                  Os mais antigos são apagados ao terminar um novo (cada um guarda os gráficos).
                </span>
              </label>
            </div>
          </details>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

function DataSection({ status }: { status: ApiStatus }) {
  const info = useFetch('mcpinfo', () => api.mcpInfo());
  const dir = info.data?.dataDir ?? null;
  return (
    <Card title="Seus dados" id="dados">
      <p>
        Suas sessões, voltas e gravações ficam <strong>só neste PC</strong>, nesta pasta:
      </p>
      {info.error && !dir ? (
        <ErrorBox error={info.error} compact onRetry={info.reload} />
      ) : !dir ? (
        <Loading />
      ) : (
        <p className="a-datapath">
          <span className="num">{dir}</span> <CopyButton text={dir} label="Copiar caminho" />
        </p>
      )}
      <p className="dim a-small">
        Para fazer uma cópia de segurança, feche o app e copie essa pasta inteira. Ela fica fora da
        pasta do programa, então atualizar ou reinstalar o app não apaga nada.
      </p>
      {status.simulator && (
        <p className="a-note">
          <Tag tone="warn">Demo</Tag> Você está no modo demonstração: estes dados são de um piloto
          simulado e ficam numa subpasta separada (<code>demo</code>), sem misturar com os reais.
        </p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

function AboutSection({ status }: { status: ApiStatus }) {
  return (
    <Card title="Sobre" id="sobre">
      <div className="a-setting-row">
        <div>
          <strong>GT7 Engenheiro</strong>
          <div className="dim a-small">
            Versão <span className="num">{status.serverVersion}</span> · porta{' '}
            <span className="num">{status.httpPort}</span>
            {status.tokenRequired ? ' · acesso com senha (token)' : ''}
          </div>
        </div>
      </div>
      <div className="a-setting-row a-mt">
        <div>
          <strong>Assistente de boas-vindas</strong>
          <div className="dim a-small">
            Mostra de novo como encontrar o PS5 e abrir o painel em outro dispositivo.
          </div>
        </div>
        <button
          type="button"
          className="a-btn a-btn-ghost"
          onClick={() => {
            saveString(ONBOARDING_KEY, '0');
            useUi.setState({ onboarding: 'active' });
          }}
        >
          Rever o assistente
        </button>
      </div>
      <p className="dim a-small a-mt">
        Projeto pessoal, sem relação com a Polyphony Digital. O protocolo de telemetria do GT7 não
        tem documentação oficial; vem de engenharia reversa da comunidade.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------

/** Old section anchors (links in the README / other pages) → current ids. */
const SECTION_ALIASES: Record<string, string> = {
  console: 'conexao',
  lan: 'acesso-remoto',
  celular: 'acesso-remoto',
};

export function ConfigPage({ route }: { route: Route }) {
  useTitle('Configurações');
  const status = useFetch('status', () => api.status(), 10000);
  const requested = route.query.s;
  const section = requested ? (SECTION_ALIASES[requested] ?? requested) : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll once the content is there
  useEffect(() => {
    if (section && status.data)
      document.getElementById(section)?.scrollIntoView({ block: 'start' });
  }, [section, !!status.data]);

  return (
    <>
      <PageHead title="Configurações" sub="Tudo se ajusta aqui: nada de arquivo de configuração." />
      <nav className="a-toc" aria-label="Seções">
        <a href="#/config?s=conexao">Conexão</a>
        <a href="#/config?s=captura">Captura</a>
        <a href={routes.config('acesso-remoto')}>Dispositivo remoto</a>
        <a href="#/config?s=dispositivos">Aparelhos</a>
        <a href="#/config?s=coach">Coach IA</a>
        <a href="#/config?s=dados">Dados</a>
        <a href="#/config?s=mcp">Integração com IA</a>
        <a href="#/config?s=sobre">Sobre</a>
      </nav>
      {status.error && !status.data ? (
        <ErrorBox error={status.error} onRetry={status.reload} />
      ) : !status.data ? (
        <Loading />
      ) : (
        <div className="a-config">
          <ConnectionSection status={status.data} onChange={status.reload} />
          <CaptureSection status={status.data} onChange={status.reload} />
          <LanSection status={status.data} onChange={status.reload} />
          <DevicesSection />
          <CoachSection />
          <DataSection status={status.data} />
          <McpSection status={status.data} />
          <AboutSection status={status.data} />
        </div>
      )}
    </>
  );
}
