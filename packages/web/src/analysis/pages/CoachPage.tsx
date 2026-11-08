/**
 * #/coach[/:reportId]?session=&lap=&ref=&corner= — in-app AI debrief (Claude with the same MCP
 * tools): request form, streamed Markdown answer with tool progress, follow-up chat and the history
 * of saved reports. Without an API key it explains how to configure one (or use MCP instead).
 */

import type { CoachConfig, CoachReport, CoachReportSummary, Lap, Session } from '@gt7/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatLapTime } from '../../lib/format.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { type CoachToolCall, streamCoach } from '../coachStream.ts';
import { Markdown } from '../components/Markdown.tsx';
import {
  Card,
  ConfirmButton,
  ErrorBox,
  Loading,
  PageHead,
  Tag,
  useTitle,
} from '../components/ui.tsx';
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
    <ul className="a-tools" aria-label="Ferramentas usadas">
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
    <Card className="a-nokey" title="Configure o coach de IA">
      <p>
        O coach usa a API do Claude com as mesmas ferramentas de análise do app. Para usar aqui
        dentro, informe uma chave da API da Anthropic em{' '}
        <a href={routes.config('coach')}>Configurações → Coach IA</a> (ou defina a variável{' '}
        <code>ANTHROPIC_API_KEY</code> antes de iniciar o servidor).
      </p>
      <p className="dim">
        Sem chave? As mesmas ferramentas funcionam no <strong>Claude Desktop</strong> ou no{' '}
        <strong>Claude Code</strong> pelo MCP — veja{' '}
        <a href={routes.config('mcp')}>como conectar</a> e use o prompt “debrief_sessao”.
      </p>
    </Card>
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
      if (!last || last.role !== 'assistant') return es;
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

  return (
    <>
      <PageHead
        title="Coach IA"
        sub="Debrief com números e uma ação por curva, a partir das mesmas métricas da página de análise."
        actions={
          currentId && (
            <a
              className="a-btn a-btn-ghost"
              href={routes.coach()}
              onClick={() => abortRef.current?.abort()}
            >
              Novo debrief
            </a>
          )
        }
      />
      <div className="a-coach">
        <div className="a-coach-main">
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
            <Card title="Pedir um debrief">
              <form
                className="a-form a-coach-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  startDebrief();
                }}
              >
                <label>
                  Sessão
                  <select
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
                <label>
                  Volta
                  <select value={lapId} onChange={(e) => setLapId(e.target.value)}>
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
                <label>
                  Referência
                  <select value={ref} onChange={(e) => setRef(e.target.value)}>
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
                <label>
                  Foco
                  <select value={corner} onChange={(e) => setCorner(e.target.value)}>
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
                <label className="a-span2">
                  Pergunta (opcional)
                  <textarea
                    className="a-input"
                    rows={2}
                    maxLength={1000}
                    value={question}
                    placeholder="ex.: por que perco tanto na saída da T3?"
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </label>
                <div className="a-actions a-span2">
                  <button
                    type="submit"
                    className="a-btn"
                    disabled={streaming || (config !== null && !config.hasKey) || noCoachEndpoint}
                  >
                    Gerar debrief
                  </button>
                  <span className="dim a-small">
                    {config
                      ? `Modelo: ${config.models.find((m) => m.id === config.model)?.label ?? config.model}`
                      : ''}
                  </span>
                </div>
              </form>
            </Card>
          )}

          {(entries.length > 0 || currentId) && (
            <div className="a-conv">
              {activeReport && (
                <div className="a-report-meta dim a-small">
                  {activeReport.title} · {formatDateTime(activeReport.createdAt)} ·{' '}
                  {activeReport.model}
                  {activeReport.usage && (
                    <>
                      {' '}
                      · {activeReport.usage.inputTokens + activeReport.usage.outputTokens} tokens
                    </>
                  )}
                </div>
              )}
              {entries.length === 0 && <Loading text="Abrindo o relatório…" />}
              {entries.map((e, i) =>
                e.role === 'user' ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only conversation
                  <div key={i} className="a-msg a-msg-user">
                    {e.text}
                  </div>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only conversation
                  <div key={i} className="a-msg a-msg-bot">
                    <ToolChips tools={e.tools} />
                    {e.text ? (
                      <Markdown text={e.text} />
                    ) : e.streaming && !e.tools.length ? (
                      <Loading text="Pensando…" />
                    ) : null}
                    {e.streaming && e.text && <span className="a-caret" aria-hidden="true" />}
                    {e.error && (
                      <p className="a-form-error">
                        {e.error}
                        {/chave|key/i.test(e.error) && (
                          <>
                            {' '}
                            <a href={routes.config('coach')}>Configurar</a>
                          </>
                        )}
                      </p>
                    )}
                  </div>
                ),
              )}
              {streaming ? (
                <button
                  type="button"
                  className="a-btn a-btn-ghost"
                  onClick={() => abortRef.current?.abort()}
                >
                  Parar
                </button>
              ) : (
                currentId && (
                  <form
                    className="a-chat"
                    onSubmit={(e) => {
                      e.preventDefault();
                      sendChat();
                    }}
                  >
                    <textarea
                      className="a-input"
                      rows={2}
                      value={chat}
                      maxLength={2000}
                      placeholder="Pergunte mais (ex.: e na T5? como treino isso?)"
                      onChange={(e) => setChat(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendChat();
                        }
                      }}
                    />
                    <button type="submit" className="a-btn" disabled={!chat.trim()}>
                      Enviar
                    </button>
                  </form>
                )
              )}
            </div>
          )}
        </div>

        <aside className="a-coach-side">
          <Card title="Relatórios">
            {reports.error && !reports.data ? (
              <p className="dim a-small">
                {noCoachEndpoint ? 'Indisponível neste servidor.' : reports.error.message}
              </p>
            ) : !reports.data ? (
              <Loading />
            ) : reportList.length === 0 ? (
              <p className="dim a-small">Nenhum relatório ainda.</p>
            ) : (
              <ul className="a-reports">
                {reportList.map((r) => (
                  <li key={r.id} data-current={r.id === currentId ? '1' : '0'}>
                    <a href={routes.coach({ id: r.id })}>
                      <strong>{r.title}</strong>
                      <span className="dim a-small">
                        {formatDateTime(r.createdAt)}
                        {r.status !== 'done' && (
                          <>
                            {' '}
                            <Tag tone={r.status === 'error' ? 'bad' : 'info'}>
                              {r.status === 'error' ? 'erro' : 'em andamento'}
                            </Tag>
                          </>
                        )}
                      </span>
                      {r.preview && <span className="a-report-preview">{r.preview}</span>}
                    </a>
                    <ConfirmButton
                      className="a-btn a-btn-ghost a-btn-sm"
                      label="Apagar"
                      question="Apagar?"
                      confirmLabel="Sim"
                      onConfirm={async () => {
                        try {
                          await api.deleteCoachReport(r.id);
                          reports.reload();
                          if (r.id === currentId) navigate(routes.coach(), true);
                        } catch (e) {
                          addNotice('error', (e as Error).message, 6000);
                        }
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
