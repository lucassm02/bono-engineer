/**
 * #/analise/pista/:trackId?tab=&session= — one track in five tabs: best laps per car, sessions by
 * day, evolution (+ consistency), top-of-the-world references and corners (map, names, sectors).
 */

import type {
  ApiTrackAnalysis,
  ConsistencyReport,
  CornerMetricKey,
  EvolutionCornerPoint,
  EvolutionReport,
  Lap,
  MapCorner,
  MetricStats,
  Session,
} from '@gt7/shared';
import { useEffect, useMemo, useState } from 'react';
import { formatDelta, formatLapTime } from '../../lib/format.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { CarName } from '../components/CarName.tsx';
import { CarFilterChips, CarFilterField } from '../components/CarPicker.tsx';
import { CompareMap } from '../components/CompareMap.tsx';
import { LapQuickActions } from '../components/LapActions.tsx';
import { MiniChart, type MiniSeries } from '../components/MiniChart.tsx';
import { EditableTrackName, NewTrackPrompt } from '../components/TrackNaming.tsx';
import {
  Card,
  ConfirmButton,
  Empty,
  ErrorBox,
  Loading,
  PageHead,
  Tag,
  useTitle,
} from '../components/ui.tsx';
import { carMatchesFilter, isCarFiltering, lapsPerCar } from '../lib/carFilter.ts';
import { cornerLabel, fixed, signed } from '../lib/chartData.ts';
import {
  dayHeading,
  formatClock,
  formatDuration,
  formatKm,
  groupSessionsByDay,
  plural,
} from '../lib/history.ts';
import { CORNER_KIND_LABELS, carLabel, formatDateTime, formatDay } from '../lib/labels.ts';
import { useCarFilter } from '../lib/useCarFilter.ts';
import { useFetch } from '../useFetch.ts';

const NO_MAP: never[] = [];

// ---------------------------------------------------------------------------------------------
// Corner editor
// ---------------------------------------------------------------------------------------------

function CornerRow({
  trackId,
  corner,
  focused,
  onSaved,
}: {
  trackId: string;
  corner: MapCorner;
  focused: boolean;
  onSaved: () => void;
}) {
  const [name, setName] = useState(corner.name ?? '');
  const [note, setNote] = useState(corner.brakeMarkerNote ?? '');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setName(corner.name ?? '');
    setNote(corner.brakeMarkerNote ?? '');
  }, [corner.name, corner.brakeMarkerNote]);
  const dirty = name !== (corner.name ?? '') || note !== (corner.brakeMarkerNote ?? '');
  const save = async () => {
    if (!dirty) return;
    setBusy(true);
    try {
      await api.patchCorner(trackId, corner.id, {
        name: name.trim() || null,
        brakeMarkerNote: note.trim() || null,
      });
      onSaved();
    } catch (e) {
      addNotice('error', (e as Error).message, 6000);
    } finally {
      setBusy(false);
    }
  };
  return (
    <tr data-focus={focused ? '1' : '0'} id={`corner-${corner.id}`}>
      <td>
        <strong>{corner.id}</strong>
        <div className="dim a-small">
          {corner.direction === 'left' ? '↰ esq.' : '↱ dir.'}
          {corner.kind ? ` · ${CORNER_KIND_LABELS[corner.kind]}` : ''}
        </div>
        <div className="num a-small dim">
          {Math.round(corner.entryM)}–{Math.round(corner.exitM)} m
        </div>
      </td>
      <td>
        <input
          className="a-input"
          value={name}
          placeholder="Nome (ex.: Eau Rouge)"
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          aria-label={`Nome da curva ${corner.id}`}
        />
      </td>
      <td>
        <input
          className="a-input"
          value={note}
          placeholder="Marco de frenagem (ex.: placa de 100 m)"
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          aria-label={`Marco de frenagem da curva ${corner.id}`}
        />
      </td>
      <td>
        <button type="button" className="a-btn a-btn-sm" disabled={!dirty || busy} onClick={save}>
          Salvar
        </button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------------------------
// Consistency
// ---------------------------------------------------------------------------------------------

const CONSISTENCY_METRICS: { key: CornerMetricKey; label: string; unit: string; digits: number }[] =
  [
    { key: 'brakePointM', label: 'Frenagem', unit: 'm', digits: 1 },
    { key: 'minSpeedKmh', label: 'V-mín', unit: 'km/h', digits: 1 },
    { key: 'throttlePickupM', label: 'Retomada', unit: 'm', digits: 1 },
    { key: 'exitSpeedKmh', label: 'Saída', unit: 'km/h', digits: 1 },
    { key: 'timeInCornerS', label: 'Tempo na curva', unit: 's', digits: 3 },
  ];

function StatCell({ s, digits }: { s: MetricStats | undefined; digits: number }) {
  if (!s || s.n < 2) return <td className="num num-col dim">–</td>;
  return (
    <td
      className="num num-col"
      title={`média ${fixed(s.mean, digits)} · mín ${fixed(s.min, digits)} · máx ${fixed(s.max, digits)}`}
    >
      ±{fixed(s.stdDev, digits)}
    </td>
  );
}

function ConsistencySection({
  report,
  corners,
}: {
  report: ConsistencyReport;
  corners: MapCorner[];
}) {
  const name = (id: string) => {
    const c = corners.find((x) => x.id === id);
    return c ? cornerLabel(c) : id;
  };
  const lt = report.lapTime;
  return (
    <>
      <div className="a-stats">
        <div>
          <span className="a-sum-k">Voltas analisadas</span>
          <span className="a-sum-v num">{report.lapIds.length}</span>
        </div>
        <div>
          <span className="a-sum-k">Melhor</span>
          <span className="a-sum-v num">{formatLapTime(lt.min)}</span>
        </div>
        <div>
          <span className="a-sum-k">Média</span>
          <span className="a-sum-v num">{formatLapTime(lt.mean)}</span>
        </div>
        <div>
          <span className="a-sum-k">Desvio-padrão</span>
          <span className="a-sum-v num">±{fixed(lt.stdDev / 1000, 3)} s</span>
        </div>
      </div>
      {report.highlights.length > 0 && (
        <ol className="a-highlights">
          {report.highlights.slice(0, 6).map((h) => (
            <li key={`${h.cornerId}-${h.metric}`}>
              {h.message ?? `${name(h.cornerId)}: ${h.metric} varia ±${fixed(h.stdDev, 1)}`}
            </li>
          ))}
        </ol>
      )}
      <div className="a-table-wrap">
        <table className="a-table">
          <thead>
            <tr>
              <th>Curva</th>
              {CONSISTENCY_METRICS.map((m) => (
                <th key={m.key} className="num-col">
                  {m.label} <span className="dim">{m.unit}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {report.corners.map((c) => (
              <tr key={c.cornerId}>
                <td>{name(c.cornerId)}</td>
                {CONSISTENCY_METRICS.map((m) => (
                  <StatCell key={m.key} s={c.metrics[m.key]} digits={m.digits} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="dim a-small">
        ± = desvio-padrão entre as voltas (passe o mouse para média, mínimo e máximo).
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Evolution
// ---------------------------------------------------------------------------------------------

const EVO_METRICS: {
  key: keyof EvolutionCornerPoint;
  label: string;
  unit: string;
  digits: number;
}[] = [
  { key: 'timeLostMs', label: 'Tempo perdido vs base', unit: 'ms', digits: 0 },
  { key: 'brakePointDiffM', label: 'Frenagem vs base (+ = mais tarde)', unit: 'm', digits: 0 },
  { key: 'minSpeedDiffKmh', label: 'V-mín vs base', unit: 'km/h', digits: 1 },
  { key: 'exitSpeedDiffKmh', label: 'Saída vs base', unit: 'km/h', digits: 1 },
  { key: 'throttlePickupDiffM', label: 'Retomada vs base (− = antes)', unit: 'm', digits: 0 },
];

function EvolutionSection({ evo, corners }: { evo: EvolutionReport; corners: MapCorner[] }) {
  const [cornerId, setCornerId] = useState<string>('');
  const [metric, setMetric] = useState<keyof EvolutionCornerPoint>('timeLostMs');
  const xs = useMemo(() => evo.days.map((_, i) => i), [evo.days]);
  const dayLabel = (v: number) => {
    const d = evo.days[Math.round(v)];
    return d && Math.abs(v - Math.round(v)) < 0.01 ? formatDay(d.date) : '';
  };
  const lapSeries: MiniSeries[] = useMemo(
    () => [
      { label: 'Melhor volta', color: '#ff7a2f', values: evo.days.map((d) => d.bestLapMs) },
      {
        label: 'Média das 3 melhores',
        color: '#7aa7ff',
        values: evo.days.map((d) => d.top3MeanMs),
        dash: [5, 4],
      },
      ...(evo.baseline
        ? [
            {
              label: evo.baseline.kind === 'reference' ? 'Referência top' : 'Melhor pessoal',
              color: '#2fd3b0',
              values: evo.days.map(() => evo.baseline!.timeMs),
              dash: [2, 4],
            },
          ]
        : []),
    ],
    [evo],
  );
  // Default corner: the one with the biggest time lost on the last day.
  const lastDay = evo.days[evo.days.length - 1];
  const defaultCorner =
    lastDay?.corners.reduce<EvolutionCornerPoint | null>(
      (b, c) => ((c.timeLostMs ?? -1e9) > (b?.timeLostMs ?? -1e9) ? c : b),
      null,
    )?.cornerId ??
    corners[0]?.id ??
    '';
  const cid = cornerId || defaultCorner;
  const def = EVO_METRICS.find((m) => m.key === metric)!;
  const cornerSeries: MiniSeries[] = useMemo(
    () => [
      {
        label: `${cid} · ${def.label}`,
        color: '#ffb21e',
        values: evo.days.map((d) => {
          const v = d.corners.find((c) => c.cornerId === cid)?.[metric];
          return typeof v === 'number' ? v : null;
        }),
      },
    ],
    [evo, cid, metric, def.label],
  );

  if (evo.days.length === 0)
    return <p className="dim">Ainda não há voltas suas suficientes nesta pista.</p>;

  return (
    <>
      <p className="dim a-small">
        <CarName carCode={evo.carCode} logoSize={18} /> · base:{' '}
        {evo.baseline
          ? `${evo.baseline.kind === 'reference' ? 'referência top' : 'melhor pessoal'} ${formatLapTime(evo.baseline.timeMs)}`
          : 'sem base'}{' '}
        · {evo.days.length} dia(s)
      </p>
      <div className="a-evo-grid">
        <div>
          <h3 className="a-h3">Melhor volta por dia</h3>
          <MiniChart
            xs={xs}
            series={lapSeries}
            xLabel={dayLabel}
            yLabel={(v) => formatLapTime(v)}
          />
        </div>
        <div>
          <h3 className="a-h3">Curva-chave</h3>
          <div className="a-controls a-controls-tight">
            <select value={cid} onChange={(e) => setCornerId(e.target.value)} aria-label="Curva">
              {corners.map((c) => (
                <option key={c.id} value={c.id}>
                  {cornerLabel(c)}
                </option>
              ))}
            </select>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as keyof EvolutionCornerPoint)}
              aria-label="Métrica"
            >
              {EVO_METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <MiniChart
            xs={xs}
            series={cornerSeries}
            xLabel={dayLabel}
            yLabel={(v) => `${signed(v, def.digits)} ${def.unit}`}
            zeroLine={0}
          />
        </div>
      </div>
      {evo.trends.length > 0 && (
        <>
          <h3 className="a-h3">Tendências (primeiro × último dia)</h3>
          <ul className="a-trends">
            {evo.trends.slice(0, 8).map((t) => (
              <li key={`${t.cornerId}-${t.metric}`} data-tone={t.improved ? 'gain' : 'loss'}>
                <span aria-hidden="true">{t.improved ? '▲' : '▼'}</span> {t.message}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------------------------

const TABS = [
  { id: 'melhores', label: 'Melhores voltas' },
  { id: 'sessoes', label: 'Sessões' },
  { id: 'evolucao', label: 'Evolução' },
  { id: 'referencias', label: 'Referências do top' },
  { id: 'curvas', label: 'Curvas' },
] as const;
type TabId = (typeof TABS)[number]['id'];

function isTab(v: string | undefined): v is TabId {
  return TABS.some((t) => t.id === v);
}

const TOP_PER_CAR = 5;

function BestLapsTab({ trackId, hasTopReference }: { trackId: string; hasTopReference: boolean }) {
  const laps = useFetch(`bl:${trackId}`, () =>
    api.trackLaps(trackId, {
      validOnly: true,
      references: 'exclude',
      orderBy: 'time',
      limit: 1000,
    }),
  );
  const [carFilter, setCarFilter] = useCarFilter();
  const usage = useMemo(
    () => lapsPerCar((laps.data ?? []).filter((l) => !l.flags.includes('replay'))),
    [laps.data],
  );
  const groups = useMemo(() => {
    const own = (laps.data ?? []).filter(
      (l) => !l.flags.includes('replay') && carMatchesFilter(carFilter, l.carCode),
    );
    const byCar = new Map<number, Lap[]>();
    for (const l of own) {
      const list = byCar.get(l.carCode);
      if (list) list.push(l);
      else byCar.set(l.carCode, [l]);
    }
    const lastAt = (list: Lap[]) => Math.max(...list.map((l) => l.startedAt));
    return [...byCar.entries()]
      .map(([carCode, list]) => ({ carCode, laps: list.sort((a, b) => a.timeMs - b.timeMs) }))
      .sort((a, b) => lastAt(b.laps) - lastAt(a.laps));
  }, [laps.data, carFilter]);

  if (laps.error && !laps.data) return <ErrorBox error={laps.error} onRetry={laps.reload} />;
  if (!laps.data) return <Loading />;
  const filtering = isCarFiltering(carFilter);
  if (groups.length === 0 && !filtering) {
    return (
      <Empty>
        <p>Ainda não há voltas válidas nesta pista.</p>
        <p className="dim">Complete uma volta limpa (sem sair da pista) e ela aparece aqui.</p>
      </Empty>
    );
  }
  return (
    <>
      {(usage.length > 1 || filtering) && (
        <>
          <div className="a-filters">
            <CarFilterField usage={usage} value={carFilter} onChange={setCarFilter} />
          </div>
          {filtering && (
            <div className="cf-chips">
              <CarFilterChips value={carFilter} onChange={setCarFilter} />
            </div>
          )}
        </>
      )}
      {groups.length === 0 && (
        <Empty>
          <p>Nenhuma volta válida com esse carro nesta pista.</p>
        </Empty>
      )}
      <div className="a-bestgrid">
        {groups.map((g) => {
          const pb = g.laps[0]!;
          return (
            <Card
              key={g.carCode}
              title={<CarName carCode={g.carCode} logoSize={24} className="carname-wrap" />}
              actions={
                <span className="dim a-small">
                  Melhor <strong className="num a-pbtime">{formatLapTime(pb.timeMs)}</strong>
                </span>
              }
            >
              <ol className="a-toplaps">
                {g.laps.slice(0, TOP_PER_CAR).map((l, i) => (
                  <li key={l.id}>
                    <div className="a-toplap-main">
                      <span className="a-toplap-pos num">{i + 1}º</span>
                      <span className="a-toplap-time num" data-best={i === 0 ? '1' : '0'}>
                        {formatLapTime(l.timeMs)}
                      </span>
                      <a className="dim a-small" href={routes.session(l.sessionId)}>
                        {formatDateTime(l.startedAt)} · volta {l.number}
                      </a>
                      {l.isReference && <Tag tone="ref">ref</Tag>}
                    </div>
                    <LapQuickActions
                      lap={l}
                      pbLapId={pb.id}
                      hasTopReference={hasTopReference}
                      onChanged={() => laps.reload()}
                      onDeleted={() => laps.reload()}
                    />
                  </li>
                ))}
              </ol>
              {g.laps.length > TOP_PER_CAR && (
                <p className="dim a-small">
                  + {g.laps.length - TOP_PER_CAR} voltas válidas com este carro.
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}

function SessionsTab({ sessions }: { sessions: Session[] }) {
  const [carFilter, setCarFilter] = useCarFilter();
  const usage = useMemo(
    () => lapsPerCar(sessions.map((s) => ({ carCode: s.carCode, laps: s.lapCount }))),
    [sessions],
  );
  const groups = useMemo(
    () => groupSessionsByDay(sessions.filter((s) => carMatchesFilter(carFilter, s.carCode))),
    [sessions, carFilter],
  );
  if (sessions.length === 0) {
    return (
      <Empty>
        <p>Nenhuma sessão nesta pista ainda.</p>
      </Empty>
    );
  }
  return (
    <>
      {(usage.length > 1 || isCarFiltering(carFilter)) && (
        <>
          <div className="a-filters">
            <CarFilterField usage={usage} value={carFilter} onChange={setCarFilter} />
          </div>
          {isCarFiltering(carFilter) && (
            <div className="cf-chips">
              <CarFilterChips value={carFilter} onChange={setCarFilter} />
            </div>
          )}
        </>
      )}
      {groups.length === 0 && (
        <Empty>
          <p>Nenhuma sessão com esse carro nesta pista.</p>
        </Empty>
      )}
      {groups.map((g) => (
        <section key={g.day} className="a-daygroup">
          <h3 className="a-dayhead">{dayHeading(g.day)}</h3>
          <ul className="a-sessionlist">
            {g.items.map((s) => {
              const dur = formatDuration(s.startedAt, s.endedAt);
              return (
                <li key={s.id}>
                  <a className="a-sessionrow" href={routes.session(s.id)}>
                    <span className="a-sessionrow-time num">{formatClock(s.startedAt)}</span>
                    <span className="a-sessionrow-main">
                      <strong>
                        <CarName carCode={s.carCode} logoSize={20} />
                      </strong>
                      <span className="dim a-small">
                        {plural(s.lapCount, 'volta', 'voltas')}
                        {dur ? ` · ${dur}` : ''}
                        {s.endedAt === null && <Tag tone="info">em andamento</Tag>}
                        {s.mode === 'replayCapture' && <Tag tone="ref">captura de replay</Tag>}
                      </span>
                    </span>
                    <span className="a-sessionrow-best num">
                      {s.bestLapMs ? formatLapTime(s.bestLapMs) : '–'}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="dim a-small">Para apagar uma sessão inteira, abra-a e use “Apagar sessão”.</p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

function pickSession(sessions: Session[], wanted: string | undefined): string {
  if (wanted && sessions.some((s) => s.id === wanted)) return wanted;
  return sessions.find((s) => s.mode === 'live' && s.lapCount >= 2)?.id ?? sessions[0]?.id ?? '';
}

export function TrackPage({ id, route }: { id: string; route: Route }) {
  const ta = useFetch(`ta:${id}`, () => api.trackAnalysis(id));
  const trackOnly = useFetch(ta.error ? `t:${id}` : null, () => api.track(id));
  const sessions = useFetch(`ts:${id}`, () => api.sessions({ trackId: id }));
  const [focus, setFocus] = useState<string | null>(null);
  const [sectors, setSectors] = useState<string>('');
  const [carCode, setCarCode] = useState<number | null>(null);
  const tab: TabId = isTab(route.query.tab) ? route.query.tab : 'melhores';

  const data: ApiTrackAnalysis | null = ta.data;
  const track = data?.track ?? trackOnly.data ?? null;
  useTitle(track?.name ?? 'Pista');
  const sessionList = sessions.data ?? [];
  const sessionId = pickSession(sessionList, route.query.session);

  const consistency = useFetch(tab === 'evolucao' && sessionId ? `cons:${sessionId}` : null, () =>
    api.consistency(sessionId),
  );
  const theo = useFetch(tab === 'evolucao' && sessionId ? `theo:${sessionId}` : null, async () => {
    const s = await api.session(sessionId);
    const ids = s.laps
      .filter((l) => l.valid && !l.isReference)
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, 20)
      .map((l) => l.id);
    return ids.length ? api.microsectors(ids) : null;
  });
  const cars = data?.records.cars ?? [];
  const car =
    carCode ?? (cars.length ? [...cars].sort((a, b) => b.laps - a.laps)[0]!.carCode : null);
  const evo = useFetch(tab === 'evolucao' ? `evo:${id}:${car ?? ''}` : null, () =>
    api.evolution(id, car ?? undefined),
  );

  useEffect(() => {
    if (track) setSectors(String(track.sectorGates.length || 3));
  }, [track]);

  const corners: MapCorner[] = data?.corners ?? NO_MAP;

  if (ta.error && !track) {
    if (trackOnly.error || !trackOnly.loading) {
      return (
        <>
          <PageHead title="Pista" back={{ href: routes.home(), label: 'Suas pistas' }} />
          <ErrorBox error={trackOnly.error ?? ta.error} onRetry={ta.reload} />
        </>
      );
    }
  }
  if (!track) return <Loading />;

  const reload = () => {
    ta.reload();
    trackOnly.reload();
  };

  const onCorner = (cid: string) => {
    setFocus(cid);
    document
      .getElementById(`corner-${cid}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const pbByCar = new Map(cars.map((c) => [c.carCode, c]));
  const anyPb = [...cars].sort(
    (a, b) => (a.personalBestMs ?? 1e12) - (b.personalBestMs ?? 1e12),
  )[0];
  const ownSessions = sessionList.filter((s) => s.mode === 'live');
  const needsName = track.source === 'auto' && track.name.startsWith('Pista desconhecida');
  const bestRef =
    data?.references.reduce<number | null>(
      (b, r) => (b === null || r.timeMs < b ? r.timeMs : b),
      null,
    ) ?? null;
  const tabHref = (t: TabId) =>
    routes.track(id, { tab: t === 'melhores' ? undefined : t, session: route.query.session });

  return (
    <>
      <PageHead
        back={{ href: routes.home(), label: 'Suas pistas' }}
        title={
          <EditableTrackName
            trackId={id}
            name={track.name}
            layout={track.layout ?? null}
            lengthM={track.lengthM}
            onSaved={reload}
          />
        }
        sub={
          <>
            {formatKm(track.lengthM, 3)} · {track.corners.length} curvas ·{' '}
            {track.sectorGates.length} setores
          </>
        }
        actions={
          <>
            <a className="a-btn a-btn-ghost" href={routes.sessions({ track: id })}>
              Lista de sessões
            </a>
            <a className="a-btn" href={routes.coach()}>
              Debrief com IA
            </a>
          </>
        }
      />

      {needsName && (
        <NewTrackPrompt trackId={id} lengthM={track.lengthM} onSaved={reload} variant="inline" />
      )}

      {data && (
        <div className="a-stats a-track-stats">
          <div>
            <span className="a-sum-k">Sua melhor volta</span>
            <span className="a-sum-v num">{formatLapTime(anyPb?.personalBestMs ?? null)}</span>
          </div>
          <div>
            <span className="a-sum-k">Melhor do top</span>
            <span className="a-sum-v num">{bestRef ? formatLapTime(bestRef) : '–'}</span>
          </div>
          <div>
            <span className="a-sum-k">Sessões</span>
            <span className="a-sum-v num">{sessions.data ? ownSessions.length : '–'}</span>
          </div>
          <div>
            <span className="a-sum-k">Voltas</span>
            <span className="a-sum-v num">{data.lapCount}</span>
          </div>
        </div>
      )}

      <nav className="a-tabs" aria-label="Seções da pista">
        {TABS.map((t) => (
          <a
            key={t.id}
            aria-current={tab === t.id ? 'page' : undefined}
            href={tabHref(t.id)}
            onClick={(e) => {
              e.preventDefault();
              navigate(tabHref(t.id), true);
            }}
          >
            {t.label}
          </a>
        ))}
      </nav>

      {tab === 'melhores' && (
        <BestLapsTab trackId={id} hasTopReference={!!data?.references.length} />
      )}

      {tab === 'sessoes' &&
        (sessions.error && !sessions.data ? (
          <ErrorBox error={sessions.error} onRetry={sessions.reload} />
        ) : !sessions.data ? (
          <Loading />
        ) : (
          <SessionsTab sessions={sessionList} />
        ))}

      {tab === 'evolucao' && (
        <>
          <Card
            title="Evolução"
            actions={
              cars.length > 1 && (
                <select
                  value={car ?? ''}
                  onChange={(e) => setCarCode(Number(e.target.value))}
                  aria-label="Carro"
                >
                  {cars.map((c) => (
                    <option key={c.carCode} value={c.carCode}>
                      {carLabel(c.carCode)}
                    </option>
                  ))}
                </select>
              )
            }
          >
            {evo.error ? (
              <ErrorBox error={evo.error} compact />
            ) : !evo.data ? (
              <Loading />
            ) : (
              <EvolutionSection evo={evo.data} corners={corners} />
            )}
          </Card>
          <Card
            title="Consistência de uma sessão"
            className="a-mt"
            actions={
              sessionList.length > 0 && (
                <select
                  value={sessionId}
                  onChange={(e) =>
                    navigate(routes.track(id, { tab: 'evolucao', session: e.target.value }), true)
                  }
                  aria-label="Sessão"
                >
                  {sessionList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatDateTime(s.startedAt)} · {s.lapCount} voltas
                      {s.mode === 'replayCapture' ? ' · replay' : ''}
                    </option>
                  ))}
                </select>
              )
            }
          >
            {!sessionId ? (
              <p className="dim">Nenhuma sessão nesta pista.</p>
            ) : consistency.error ? (
              <ErrorBox error={consistency.error} compact />
            ) : !consistency.data ? (
              <Loading />
            ) : (
              <ConsistencySection report={consistency.data} corners={corners} />
            )}
            {theo.data && (
              <div className="a-theo">
                <h3 className="a-h3">Volta ideal da sessão</h3>
                <div className="a-stats">
                  <div>
                    <span className="a-sum-k">Sua melhor</span>
                    <span className="a-sum-v num">{formatLapTime(theo.data.report.bestLapMs)}</span>
                  </div>
                  <div>
                    <span className="a-sum-k">Melhores setores</span>
                    <span className="a-sum-v num">
                      {formatLapTime(theo.data.report.theoreticalBestSectorsMs)}
                    </span>
                  </div>
                  <div>
                    <span className="a-sum-k">Melhores {theo.data.report.count} microssetores</span>
                    <span className="a-sum-v num">
                      {formatLapTime(theo.data.report.theoreticalBestMs)}
                    </span>
                  </div>
                  <div>
                    <span className="a-sum-k">Ganho possível</span>
                    <span className="a-sum-v num" data-tone="gain">
                      {formatDelta(theo.data.report.theoreticalBestMs - theo.data.report.bestLapMs)}
                    </span>
                  </div>
                </div>
                <p className="dim a-small">
                  Soma dos melhores trechos de {theo.data.report.laps.length} voltas válidas: o
                  quanto você já mostrou que consegue andar.
                </p>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'referencias' && (
        <Card title="Referências do top mundial">
          {data && data.references.length > 0 ? (
            <div className="a-table-wrap">
              <table className="a-table">
                <thead>
                  <tr>
                    <th>Piloto</th>
                    <th>Carro</th>
                    <th className="num-col">Tempo</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.references.map((r) => {
                    const mine =
                      pbByCar.get(r.carCode)?.personalBestLapId ?? anyPb?.personalBestLapId ?? null;
                    return (
                      <tr key={r.lapId}>
                        <td>
                          <Tag tone="ref">ref</Tag> {r.driverName ?? 'sem nome'}
                        </td>
                        <td>
                          <CarName carCode={r.carCode} />
                        </td>
                        <td className="num num-col">{formatLapTime(r.timeMs)}</td>
                        <td>
                          {mine && (
                            <a
                              className="a-btn a-btn-sm"
                              href={routes.compare({ lap: mine, ref: r.lapId })}
                            >
                              Comparar com minha melhor
                            </a>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="a-empty">
              <p>Nenhuma volta do top guardada para esta pista.</p>
              <p className="dim">
                Assista ao replay de um piloto do ranking no Time Trial e o app grava a volta dele
                como alvo para você comparar.
              </p>
              <a className="a-btn" href={routes.capture()}>
                Capturar uma referência
              </a>
            </div>
          )}
        </Card>
      )}

      {tab === 'curvas' && (
        <div className="a-track-grid">
          <div className="a-map-box a-map-track">
            {data ? (
              <CompareMap
                outline={{ x: data.polyline.x, z: data.polyline.z }}
                distanceM={[]}
                lines={[]}
                corners={corners}
                brakeMarkers={[]}
                range={null}
                focusCorner={focus}
                bus={null}
                onCorner={onCorner}
              />
            ) : (
              <Empty>A pista ainda não tem linha de referência (complete uma volta limpa).</Empty>
            )}
          </div>
          <Card
            title="Curvas"
            actions={
              <ConfirmButton
                className="a-btn a-btn-ghost a-btn-sm"
                label="Redetectar curvas"
                question="Detectar as curvas de novo? (nomes próximos são mantidos)"
                confirmLabel="Redetectar"
                onConfirm={async () => {
                  try {
                    const r = await api.redetectCorners(id);
                    addNotice(
                      'info',
                      r.detected ? `${r.corners.length} curvas detectadas.` : 'Nada mudou.',
                    );
                    reload();
                  } catch (e) {
                    addNotice('error', (e as Error).message, 6000);
                  }
                }}
              />
            }
          >
            {corners.length === 0 && track.corners.length === 0 ? (
              <p className="dim">Nenhuma curva detectada ainda.</p>
            ) : (
              <div className="a-table-wrap a-corner-edit">
                <table className="a-table">
                  <thead>
                    <tr>
                      <th>Curva</th>
                      <th>Nome</th>
                      <th>Marco de frenagem</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {(corners.length
                      ? corners
                      : track.corners.map((c) => ({ ...c, apexX: 0, apexZ: 0 }))
                    ).map((c) => (
                      <CornerRow
                        key={c.id}
                        trackId={id}
                        corner={c}
                        focused={focus === c.id}
                        onSaved={reload}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <form
              className="a-inline-form a-mt"
              onSubmit={async (e) => {
                e.preventDefault();
                const n = Number(sectors);
                if (!Number.isInteger(n) || n < 1 || n > 20) {
                  addNotice('warn', 'Use de 1 a 20 setores.');
                  return;
                }
                try {
                  await api.setSectorCount(id, n);
                  addNotice('info', `${n} setores de mesmo comprimento.`);
                  reload();
                } catch (x) {
                  addNotice('error', (x as Error).message, 6000);
                }
              }}
            >
              <label>
                Setores (iguais)
                <input
                  className="a-input a-input-num"
                  type="number"
                  min={1}
                  max={20}
                  value={sectors}
                  onChange={(e) => setSectors(e.target.value)}
                />
              </label>
              <button type="submit" className="a-btn a-btn-ghost">
                Aplicar
              </button>
              <span className="dim a-small">
                Tempos de setor de voltas antigas não são recalculados.
              </span>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
