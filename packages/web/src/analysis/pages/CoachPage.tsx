/**
 * #/coach[/:reportId]?session=&lap=&ref=&corner= — in-app AI debrief (Claude with the same MCP
 * tools): request form, streamed Markdown answer with tool progress, follow-up chat and the history
 * of saved reports. Without an API key it explains how to configure one (or use MCP instead).
 */

import type { CoachConfig, CoachReport, CoachReportSummary, Lap, Session } from '@gt7/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import { formatLapTime } from '../../lib/format.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { type CoachToolCall, streamCoach } from '../coachStream.ts';
import { ConfirmModal } from '../components/ConfirmModal.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { Panel } from '../components/Panel.tsx';
import { ErrorBox, Loading, PageHead, useTitle } from '../components/ui.tsx';
import { coachToolLabel, formatDateTime, REFERENCE_KIND_LABELS } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';

interface Entry {
  role: 'user' | 'assistant';
  text: string;
  tools: CoachToolCall[];
  streaming?: boolean;
  error?: string | null;
}

const REF_OPTIONS = ['auto', 'bestReference', 'personalBest', 'sessionBest'] as const;

function sessionLabel(s: Session, trackNames: Map<string, string>): string {
  const t = s.trackId ? (trackNames.get(s.trackId) ?? 'Pista') : 'Pista ?';
  return `${formatDateTime(s.startedAt)} · ${t} · ${s.lapCount} voltas${s.mode === 'replayCapture' ? ' · replay' : ''}`;
}

function ToolChips({ tools }: { tools: CoachToolCall[] }) {
  if (!tools.length) return null;
  return (
    <ul className="coach-tools" aria-label="Ferramentas usadas">
      {tools.map((t) => (
        <li key={t.id} data-status={t.status} title={t.summary}>
          {t.status === 'running' ? (
            <span className="a-spinner a-spinner-sm" aria-hidden="true" />
          ) : null}
          {t.status === 'done' ? '✓ ' : t.status === 'error' ? '✗ ' : ''}
          {coachToolLabel(t.name)}
          {t.status === 'running' ? '…' : ''}
        </li>
      ))}
    </ul>
  );
}

function NoKey() {
  return (
    <Panel
      tone="accent"
      title="Configure o coach de IA"
      description="O coach usa a API do Claude com as mesmas ferramentas de análise do app."
    >
      <div className="coach-nokey">
        <p>
          Para usar aqui dentro, informe uma chave da API da Anthropic em{' '}
          <a href={routes.config('coach')}>Configurações → Coach IA</a> (ou defina a variável{' '}
          <code>ANTHROPIC_API_KEY</code> antes de iniciar o servidor).
        </p>
        <p className="coach-muted">
          Sem chave? As mesmas ferramentas funcionam no <strong>Claude Desktop</strong> ou no{' '}
          <strong>Claude Code</strong> pelo MCP — veja{' '}
          <a href={routes.config('mcp')}>como conectar</a> e use o prompt “debrief_sessao”.
        </p>
        <a className="ui-btn" href={routes.config('coach')}>
          Abrir Configurações
        </a>
      </div>
    </Panel>
  );
}

function Thinking() {
  return (
    <div className="coach-thinking" role="status">
      <Loading text="Pensando…" />
      <div className="coach-skel" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    </div>
  );
}

export function CoachPage({ route }: { route: Route }) {
  useTitle('Coach IA');
  const reportId = route.params.id ?? null;
  const q = route.query;
  const cfg = useFetch('coachcfg', () => api.coachConfig());
  const reports = useFetch('coachreports', () => api.coachReports(50));
  const sessions = useFetch('coachsessions', () => api.sessions({ limit: 40 }));
  const tracks = useFetch('tracks', () => api.tracks());
  const trackNames = useMemo(
    () => new Map((tracks.data ?? []).map((t) => [t.id, t.name])),
    [tracks.data],
  );

  // Request form (prefilled from the query: session/comparison pages link here).
  const [sessionId, setSessionId] = useState(q.session ?? '');
  const [lapId, setLapId] = useState(q.lap ?? '');
  const [ref, setRef] = useState(q.ref ?? 'auto');
  const [corner, setCorner] = useState(q.corner ?? '');
  const [question, setQuestion] = useState('');
  useEffect(() => {
    if (q.session) setSessionId(q.session);
    if (q.lap) setLapId(q.lap);
    if (q.ref) setRef(q.ref);
    if (q.corner) setCorner(q.corner);
  }, [q.session, q.lap, q.ref, q.corner]);

  const effectiveSession =
    sessionId || (sessions.data?.find((s) => s.mode === 'live' && s.lapCount > 0)?.id ?? '');
  const detail = useFetch(effectiveSession ? `cs:${effectiveSession}` : null, () =>
    api.session(effectiveSession),
  );
  const trackId = detail.data?.session.trackId ?? null;
  const track = useFetch(trackId ? `track:${trackId}` : null, () => api.track(trackId!));

  // Conversation.
  const [entries, setEntries] = useState<Entry[]>([]);
  const [activeReport, setActiveReport] = useState<CoachReport | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(reportId);
  const [streaming, setStreaming] = useState(false);
  const [chat, setChat] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const pending = useRef('');
  const raf = useRef(0);
  const skipLoad = useRef<string | null>(null);

  // Load a saved report when the URL names one.
  // biome-ignore lint/correctness/useExhaustiveDependencies: load on URL change only
  useEffect(() => {
    setCurrentId(reportId);
    if (!reportId) {
      if (!streaming) {
        setEntries([]);
        setActiveReport(null);
      }
      return;
    }
    if (skipLoad.current === reportId) {
      // Just produced by the stream on this page: the entries are already there.
      skipLoad.current = null;
      return;
    }
    let alive = true;
    api
      .coachReport(reportId)
      .then((r) => {
        if (!alive) return;
        setActiveReport(r);
        const t: Entry[] = r.transcript.length
          ? r.transcript.map((e) => ({
              role: e.role,
              text: e.text,
              tools: (e.tools ?? []).map((x, i) => ({
                id: `${i}`,
                name: x.name,
                status: x.isError ? ('error' as const) : ('done' as const),
              })),
            }))
          : [{ role: 'assistant', text: r.markdown, tools: [] }];
        setEntries(
          r.error ? [...t, { role: 'assistant', text: '', tools: [], error: r.error }] : t,
        );
      })
      .catch((e: Error) => {
        if (alive) setEntries([{ role: 'assistant', text: '', tools: [], error: e.message }]);
      });
    return () => {
      alive = false;
    };
  }, [reportId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const flush = useCallback(() => {
    raf.current = 0;
    const add = pending.current;
    if (!add) return;
    pending.current = '';
    setEntries((es) => {
      const last = es[es.length - 1];
      if (last?.role !== 'assistant') return es;
      return [...es.slice(0, -1), { ...last, text: last.text + add }];
    });
  }, []);

  const updateLast = (fn: (e: Entry) => Entry) =>
    setEntries((es) => {
      const last = es[es.length - 1];
      return last ? [...es.slice(0, -1), fn(last)] : es;
    });

  const run = async (
    path: '/api/coach/debrief' | '/api/coach/chat',
    body: Parameters<typeof streamCoach>[1],
    userText: string,
    fresh: boolean,
  ) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStreaming(true);
    pending.current = '';
    const userEntry: Entry = { role: 'user', text: userText, tools: [] };
    const botEntry: Entry = { role: 'assistant', text: '', tools: [], streaming: true };
    setEntries((es) => (fresh ? [userEntry, botEntry] : [...es, userEntry, botEntry]));
    if (fresh) setActiveReport(null);
    await streamCoach(
      path,
      body,
      {
        onStart: (id) => {
          if (id) {
            setCurrentId(id);
            skipLoad.current = id;
          }
        },
        onText: (d) => {
          pending.current += d;
          if (!raf.current) raf.current = requestAnimationFrame(flush);
        },
        onTool: (t) =>
          updateLast((e) => {
            const i = e.tools.findIndex((x) => x.id === t.id);
            const tools =
              i < 0 ? [...e.tools, t] : e.tools.map((x, k) => (k === i ? { ...x, ...t } : x));
            return { ...e, tools };
          }),
        onDone: (id) => {
          flush();
          updateLast((e) => ({
            ...e,
            streaming: false,
            tools: e.tools.map((t) => (t.status === 'running' ? { ...t, status: 'done' } : t)),
          }));
          if (id) {
            setCurrentId(id);
            skipLoad.current = id;
            navigate(routes.coach({ id }), true);
          }
          reports.reload();
        },
        onError: (code, message, id) => {
          flush();
          updateLast((e) => ({
            ...e,
            streaming: false,
            error: code === 'aborted' ? 'Interrompido.' : message,
            tools: e.tools.map((t) => (t.status === 'running' ? { ...t, status: 'error' } : t)),
          }));
          if (code === 'noKey' || code === 'invalidKey') cfg.reload();
          if (id) {
            setCurrentId(id);
            skipLoad.current = id;
          }
          reports.reload();
        },
      },
      ac.signal,
    );
    if (abortRef.current === ac) abortRef.current = null;
    setStreaming(false);
  };

  const startDebrief = () => {
    const parts = [
      corner ? `Foco na curva ${corner}` : 'Debrief da sessão',
      lapId ? 'volta escolhida' : 'melhor volta',
      `referência: ${REFERENCE_KIND_LABELS[ref as keyof typeof REFERENCE_KIND_LABELS] ?? 'volta escolhida'}`,
    ];
    void run(
      '/api/coach/debrief',
      {
        ...(effectiveSession ? { sessionId: effectiveSession } : {}),
        ...(lapId ? { lapId } : {}),
        ...(ref ? { ref } : {}),
        ...(corner ? { focusCorner: corner } : {}),
        ...(question.trim() ? { question: question.trim() } : {}),
      },
      `${parts.join(' · ')}${question.trim() ? `\n\n${question.trim()}` : ''}`,
      true,
    );
  };

  const sendChat = () => {
    const msg = chat.trim();
    if (!msg || !currentId) return;
    setChat('');
    void run('/api/coach/chat', { reportId: currentId, message: msg }, msg, false);
  };

  const config: CoachConfig | null = cfg.data;
  const noCoachEndpoint = cfg.error?.status === 404;
  const laps: Lap[] = detail.data?.laps ?? [];
  const reportList: CoachReportSummary[] = reports.data ?? [];
  const [toDelete, setToDelete] = useState<CoachReportSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const canGenerate = !streaming && !(config !== null && !config.hasKey) && !noCoachEndpoint;

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api.deleteCoachReport(toDelete.id);
      reports.reload();
      if (toDelete.id === currentId) navigate(routes.coach(), true);
    } catch (e) {
      addNotice('error', (e as Error).message, 6000);
    } finally {
      setDeleting(false);
      setToDelete(null);
    }
  };

  return (
    <div className="coach-page">
      <PageHead
        title="Coach IA"
        sub="Debrief com números e uma ação por curva, a partir das mesmas métricas da página de análise."
        actions={
          currentId && (
            <a
              className="ui-btn"
              data-variant="secondary"
              href={routes.coach()}
              onClick={() => abortRef.current?.abort()}
            >
              Novo debrief
            </a>
          )
        }
      />
      <div className="coach-layout">
        <div className="coach-main">
          {cfg.error && !noCoachEndpoint && !config && (
            <ErrorBox error={cfg.error} compact onRetry={cfg.reload} />
          )}
          {noCoachEndpoint && (
            <ErrorBox
              error="Este servidor ainda não tem o coach de IA (endpoints /api/coach ausentes)."
              compact
            />
          )}
          {config && !config.hasKey && <NoKey />}

          {!currentId && entries.length === 0 && (
            <Panel
              title="Pedir um debrief"
              description="Escolha o que o coach deve olhar. Sem escolher nada, ele analisa a melhor volta da sessão mais recente."
            >
              <form
                className="coach-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  startDebrief();
                }}
              >
                <label className="ui-field coach-span2">
                  <span className="ui-label">Sessão</span>
                  <select
                    className="ui-select"
                    value={effectiveSession}
                    onChange={(e) => {
                      setSessionId(e.target.value);
                      setLapId('');
                      setCorner('');
                    }}
                  >
                    {!sessions.data?.length && <option value="">Mais recente</option>}
                    {(sessions.data ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {sessionLabel(s, trackNames)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-field">
                  <span className="ui-label">Volta</span>
                  <select
                    className="ui-select"
                    value={lapId}
                    onChange={(e) => setLapId(e.target.value)}
                  >
                    <option value="">Melhor volta da sessão</option>
                    {laps.map((l) => (
                      <option key={l.id} value={l.id}>
                        Volta {l.number} · {formatLapTime(l.timeMs)}
                        {l.valid ? '' : ' (inválida)'}
                        {l.isReference ? ' · ref' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ui-field">
                  <span className="ui-label">Referência</span>
                  <select
                    className="ui-select"
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                  >
                    {REF_OPTIONS.map((k) => (
                      <option key={k} value={k}>
                        {REFERENCE_KIND_LABELS[k]}
                      </option>
                    ))}
                    {!(REF_OPTIONS as readonly string[]).includes(ref) && (
                      <option value={ref}>Volta escolhida na comparação</option>
                    )}
                  </select>
                </label>
                <label className="ui-field coach-span2">
                  <span className="ui-label">Foco</span>
                  <select
                    className="ui-select"
                    value={corner}
                    onChange={(e) => setCorner(e.target.value)}
                  >
                    <option value="">Volta inteira (debrief)</option>
                    {(track.data?.corners ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.id}
                        {c.name ? ` · ${c.name}` : ''}
                      </option>
                    ))}
                    {corner && !(track.data?.corners ?? []).some((c) => c.id === corner) && (
                      <option value={corner}>{corner}</option>
                    )}
                  </select>
                </label>
                <label className="ui-field coach-span2">
                  <span className="ui-label">Pergunta (opcional)</span>
                  <textarea
                    className="ui-input"
                    rows={3}
                    maxLength={1000}
                    value={question}
                    placeholder="ex.: por que perco tanto na saída da T3?"
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </label>
                <div className="coach-actions coach-span2">
                  <button type="submit" className="ui-btn" data-size="lg" disabled={!canGenerate}>
                    Gerar debrief
                  </button>
                  <span className="coach-muted">
                    {config
                      ? `Modelo: ${config.models.find((m) => m.id === config.model)?.label ?? config.model}`
                      : ''}
                  </span>
                </div>
              </form>
            </Panel>
          )}

          {(entries.length > 0 || currentId) && (
            <div className="coach-conv">
              {activeReport && (
                <div className="coach-meta">
                  <strong>{activeReport.title}</strong>
                  <span className="ui-badge">{formatDateTime(activeReport.createdAt)}</span>
                  <span className="ui-badge">{activeReport.model}</span>
                  {activeReport.usage && (
                    <span className="ui-badge">
                      {activeReport.usage.inputTokens + activeReport.usage.outputTokens} tokens
                    </span>
                  )}
                </div>
              )}
              {entries.length === 0 && <Loading text="Abrindo o relatório…" />}
              {entries.map((e, i) =>
                e.role === 'user' ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only conversation
                  <div key={i} className="coach-msg coach-msg-user">
                    <span className="coach-who">Você</span>
                    {e.text}
                  </div>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only conversation
                  <article key={i} className="ui-card coach-msg coach-msg-bot">
                    <header className="coach-who-row">
                      <span className="coach-avatar" aria-hidden="true">
                        <Icon name="coach" size={16} />
                      </span>
                      <span className="coach-who">Coach IA</span>
                      {e.streaming && (
                        <span className="ui-badge" data-tone="accent">
                          respondendo
                        </span>
                      )}
                    </header>
                    <ToolChips tools={e.tools} />
                    {e.text ? (
                      <Markdown className="coach-md" text={e.text} />
                    ) : e.streaming && !e.tools.length ? (
                      <Thinking />
                    ) : null}
                    {e.streaming && e.text && <span className="coach-caret" aria-hidden="true" />}
                    {e.error && (
                      <div className="ui-card coach-error" data-tone="loss" role="alert">
                        <Icon name="alert" size={18} />
                        <p>
                          {e.error}
                          {/chave|key/i.test(e.error) && (
                            <>
                              {' '}
                              <a href={routes.config('coach')}>Configurar</a>
                            </>
                          )}
                        </p>
                      </div>
                    )}
                  </article>
                ),
              )}
              {streaming ? (
                <div className="coach-actions">
                  <button
                    type="button"
                    className="ui-btn"
                    data-variant="secondary"
                    onClick={() => abortRef.current?.abort()}
                  >
                    <Icon name="stop" size={16} />
                    Parar
                  </button>
                </div>
              ) : (
                currentId && (
                  <form
                    className="coach-chat"
                    onSubmit={(e) => {
                      e.preventDefault();
                      sendChat();
                    }}
                  >
                    <textarea
                      className="ui-input"
                      rows={2}
                      value={chat}
                      maxLength={2000}
                      aria-label="Pergunta de acompanhamento"
                      placeholder="Pergunte mais (ex.: e na T5? como treino isso?)"
                      onChange={(e) => setChat(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendChat();
                        }
                      }}
                    />
                    <button type="submit" className="ui-btn" disabled={!chat.trim()}>
                      Enviar
                    </button>
                  </form>
                )
              )}
            </div>
          )}
        </div>

        <aside className="coach-side">
          <Panel title="Relatórios" description="Debriefs salvos, do mais recente ao mais antigo.">
            {reports.error && !reports.data ? (
              <p className="coach-muted">
                {noCoachEndpoint ? 'Indisponível neste servidor.' : reports.error.message}
              </p>
            ) : !reports.data ? (
              <Loading />
            ) : reportList.length === 0 ? (
              <p className="coach-muted">Nenhum relatório ainda.</p>
            ) : (
              <ul className="coach-reports">
                {reportList.map((r) => (
                  <li key={r.id} data-current={r.id === currentId ? '1' : '0'}>
                    <a href={routes.coach({ id: r.id })}>
                      <strong>{r.title}</strong>
                      <span className="coach-report-date">
                        {formatDateTime(r.createdAt)}
                        {r.status !== 'done' && (
                          <>
                            {' '}
                            <span
                              className="ui-badge"
                              data-tone={r.status === 'error' ? 'loss' : 'accent'}
                            >
                              {r.status === 'error' ? 'erro' : 'em andamento'}
                            </span>
                          </>
                        )}
                      </span>
                      {r.preview && <span className="coach-report-preview">{r.preview}</span>}
                    </a>
                    <button
                      type="button"
                      className="ui-icon-btn coach-report-del"
                      aria-label={`Apagar o relatório ${r.title}`}
                      title="Apagar"
                      onClick={() => setToDelete(r)}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
      <ConfirmModal
        open={!!toDelete}
        title="Apagar este relatório?"
        message={
          <>
            <p>
              <strong>{toDelete?.title}</strong> será apagado junto com os gráficos que ele guardou.
            </p>
            <p>Essa ação não pode ser desfeita.</p>
          </>
        }
        confirmLabel="Apagar relatório"
        busy={deleting}
        onClose={() => setToDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
