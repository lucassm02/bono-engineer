/**
 * #/analysis/track/:trackId?tab=&session= — one track in five tabs: best laps per car, sessions by
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
import { Icon } from '../../components/ui/Icon.tsx';
import { formatDelta, formatLapTime } from '../../lib/format.ts';
import { t as uiText } from '../../lib/i18n.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { SERIES_COLORS } from '../../lib/theme.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { CarName } from '../components/CarName.tsx';
import { CarFilterChips, CarFilterField } from '../components/CarPicker.tsx';
import { CompareMap } from '../components/CompareMap.tsx';
import { GoalCard } from '../components/GoalCard.tsx';
import { LapQuickActions } from '../components/LapActions.tsx';
import { MiniChart, type MiniSeries } from '../components/MiniChart.tsx';
import { SectorsTab } from '../components/SectorsTab.tsx';
import { TasksTab } from '../components/TasksTab.tsx';
import { TrackFicha } from '../components/TrackFicha.tsx';
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
import { carMatchesFilter, isCarFiltering, lapsPerCar, NO_CAR_FILTER } from '../lib/carFilter.ts';
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
          {corner.direction === 'left' ? uiText('↰ esq.') : uiText('↱ dir.')}
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
          placeholder={uiText('Nome (ex.: Eau Rouge)')}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          aria-label={uiText('Nome da curva {0}', corner.id)}
        />
      </td>
      <td>
        <input
          className="a-input"
          value={note}
          placeholder={uiText('Marco de frenagem (ex.: placa de 100 m)')}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
          aria-label={uiText('Marco de frenagem da curva {0}', corner.id)}
        />
      </td>
      <td>
        <button type="button" className="a-btn a-btn-sm" disabled={!dirty || busy} onClick={save}>
          {uiText('Salvar')}
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
    {
      key: 'brakePointM',
      get label() {
        return uiText('Frenagem');
      },
      unit: 'm',
      digits: 1,
    },
    {
      key: 'minSpeedKmh',
      get label() {
        return uiText('V-mín');
      },
      unit: 'km/h',
      digits: 1,
    },
    {
      key: 'throttlePickupM',
      get label() {
        return uiText('Retomada');
      },
      unit: 'm',
      digits: 1,
    },
    {
      key: 'exitSpeedKmh',
      get label() {
        return uiText('Saída');
      },
      unit: 'km/h',
      digits: 1,
    },
    {
      key: 'timeInCornerS',
      get label() {
        return uiText('Tempo na curva');
      },
      unit: 's',
      digits: 3,
    },
  ];

function StatCell({ s, digits }: { s: MetricStats | undefined; digits: number }) {
  if (!s || s.n < 2) return <td className="num num-col dim">–</td>;
  return (
    <td
      className="num num-col"
      title={uiText(
        'média {0} · mín {1} · máx {2}',
        fixed(s.mean, digits),
        fixed(s.min, digits),
        fixed(s.max, digits),
      )}
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
        <div className="a-stat">
          <span className="a-stat-k">{uiText('Voltas analisadas')}</span>
          <span className="a-stat-v num">{report.lapIds.length}</span>
        </div>
        <div className="a-stat">
          <span className="a-stat-k">{uiText('Melhor')}</span>
          <span className="a-stat-v num">{formatLapTime(lt.min)}</span>
        </div>
        <div className="a-stat">
          <span className="a-stat-k">{uiText('Média')}</span>
          <span className="a-stat-v num">{formatLapTime(lt.mean)}</span>
        </div>
        <div className="a-stat">
          <span className="a-stat-k">{uiText('Desvio-padrão')}</span>
          <span className="a-stat-v num">±{fixed(lt.stdDev / 1000, 3)} s</span>
        </div>
      </div>
      {report.highlights.length > 0 && (
        <ol className="a-highlights">
          {report.highlights.slice(0, 6).map((h) => (
            <li key={`${h.cornerId}-${h.metric}`}>
              {h.message ??
                uiText('{0}: {1} varia ±{2}', name(h.cornerId), h.metric, fixed(h.stdDev, 1))}
            </li>
          ))}
        </ol>
      )}
      <div className="a-table-wrap">
        <table className="a-table">
          <thead>
            <tr>
              <th>{uiText('Curva')}</th>
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
      <p className="a-section-note">
        {uiText('± = desvio-padrão entre as voltas (passe o mouse para média, mínimo e máximo).')}
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
  {
    key: 'timeLostMs',
    get label() {
      return uiText('Tempo perdido vs base');
    },
    unit: 'ms',
    digits: 0,
  },
  {
    key: 'brakePointDiffM',
    get label() {
      return uiText('Frenagem vs base (+ = mais tarde)');
    },
    unit: 'm',
    digits: 0,
  },
  {
    key: 'minSpeedDiffKmh',
    get label() {
      return uiText('V-mín vs base');
    },
    unit: 'km/h',
    digits: 1,
  },
  {
    key: 'exitSpeedDiffKmh',
    get label() {
      return uiText('Saída vs base');
    },
    unit: 'km/h',
    digits: 1,
  },
  {
    key: 'throttlePickupDiffM',
    get label() {
      return uiText('Retomada vs base (− = antes)');
    },
    unit: 'm',
    digits: 0,
  },
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
      {
        label: uiText('Melhor volta'),
        color: SERIES_COLORS[0]!,
        values: evo.days.map((d) => d.bestLapMs),
      },
      {
        label: uiText('Média das 3 melhores'),
        color: SERIES_COLORS[3]!,
        values: evo.days.map((d) => d.top3MeanMs),
        dash: [5, 4],
      },
      ...(evo.baseline
        ? [
            {
              label:
                evo.baseline.kind === 'reference'
                  ? uiText('Referência top')
                  : uiText('Melhor pessoal'),
              color: SERIES_COLORS[1]!,
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
        color: SERIES_COLORS[2]!,
        values: evo.days.map((d) => {
          const v = d.corners.find((c) => c.cornerId === cid)?.[metric];
          return typeof v === 'number' ? v : null;
        }),
      },
    ],
    [evo, cid, metric, def.label],
  );

  if (evo.days.length === 0)
    return <p className="dim">{uiText('Ainda não há voltas suas suficientes nesta pista.')}</p>;

  // Reading aid for the key-corner chart: where the latest day stands, how it moved and the best day.
  const cornerVals = (cornerSeries[0]?.values ?? []).filter((v): v is number => v !== null);
  const cornerLast = cornerVals.at(-1) ?? null;
  const cornerPrev = cornerVals.length > 1 ? cornerVals.at(-2)! : null;
  const cornerBest = cornerVals.length > 0 ? Math.min(...cornerVals) : null;
  const lowerIsBetter = metric === 'timeLostMs';
  const cornerMove = cornerLast !== null && cornerPrev !== null ? cornerLast - cornerPrev : null;
  const fmtCorner = (v: number) => `${signed(v, def.digits)} ${def.unit}`;
  const baseIsRef = evo.baseline?.kind === 'reference';

  return (
    <>
      <p className="dim a-small">
        <CarName carCode={evo.carCode} logoSize={18} />
        {` ${uiText('· base:')}`}{' '}
        {evo.baseline
          ? `${evo.baseline.kind === 'reference' ? uiText('referência top') : uiText('melhor pessoal')} ${formatLapTime(evo.baseline.timeMs)}`
          : uiText('sem base')}{' '}
        · {evo.days.length}
        {` ${uiText('dia(s)')}`}
      </p>
      <div className="a-evo-grid">
        <div>
          <h3 className="a-h3">{uiText('Melhor volta por dia')}</h3>
          <MiniChart
            xs={xs}
            series={lapSeries}
            xLabel={dayLabel}
            yLabel={(v) => formatLapTime(v)}
          />
          <div className="a-table-wrap a-evo-values">
            <table className="a-table">
              <thead>
                <tr>
                  <th>{uiText('Dia')}</th>
                  <th className="num-col">{uiText('Melhor volta')}</th>
                  <th className="num-col">{uiText('Média das 3 melhores')}</th>
                  {evo.baseline && (
                    <th
                      className="num-col"
                      title={
                        evo.baseline.kind === 'reference'
                          ? uiText('Contra a referência top')
                          : uiText('Contra o melhor pessoal')
                      }
                    >
                      {uiText('Diferença')}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {evo.days.map((d) => (
                  <tr key={d.date}>
                    <td>{formatDay(d.date)}</td>
                    <td className="num-col num">
                      {d.bestLapMs === null ? '–' : formatLapTime(d.bestLapMs)}
                    </td>
                    <td className="num-col num">
                      {d.top3MeanMs === null ? '–' : formatLapTime(d.top3MeanMs)}
                    </td>
                    {evo.baseline && (
                      <td className="num-col num">
                        {d.gapToBaselineMs === null ? '–' : formatDelta(d.gapToBaselineMs)}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <h3 className="a-h3">{uiText('Curva-chave')}</h3>
          <div className="a-controls a-controls-tight">
            <select
              value={cid}
              onChange={(e) => setCornerId(e.target.value)}
              aria-label={uiText('Curva')}
            >
              {corners.map((c) => (
                <option key={c.id} value={c.id}>
                  {cornerLabel(c)}
                </option>
              ))}
            </select>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as keyof EvolutionCornerPoint)}
              aria-label={uiText('Métrica')}
            >
              {EVO_METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <p className="dim a-small a-evo-note">
            {lowerIsBetter
              ? baseIsRef
                ? uiText(
                    'Tempo perdido nesta curva na melhor volta de cada dia, contra a referência top. Zero é igual à referência; quanto mais baixo, melhor.',
                  )
                : uiText(
                    'Tempo perdido nesta curva na melhor volta de cada dia, contra o seu melhor pessoal. Zero é igual ao seu melhor; quanto mais baixo, melhor.',
                  )
              : uiText(
                  'Diferença nesta curva na melhor volta de cada dia, contra a base. Zero é igual à base.',
                )}
          </p>
          {cornerLast !== null && (
            <div className="a-stats a-evo-stats">
              <div className="a-stat" data-emph="1">
                <span className="a-stat-k">{uiText('Último dia')}</span>
                <span className="a-stat-v num">{fmtCorner(cornerLast)}</span>
              </div>
              {cornerMove !== null && (
                <div className="a-stat">
                  <span className="a-stat-k">{uiText('Contra o dia anterior')}</span>
                  <span
                    className="a-stat-v num"
                    data-tone={
                      !lowerIsBetter || cornerMove === 0
                        ? undefined
                        : cornerMove < 0
                          ? 'gain'
                          : 'loss'
                    }
                  >
                    {fmtCorner(cornerMove)}
                  </span>
                </div>
              )}
              {lowerIsBetter && cornerBest !== null && (
                <div className="a-stat">
                  <span className="a-stat-k">{uiText('Melhor dia')}</span>
                  <span className="a-stat-v num">{fmtCorner(cornerBest)}</span>
                </div>
              )}
            </div>
          )}
          <MiniChart
            xs={xs}
            series={cornerSeries}
            xLabel={dayLabel}
            yLabel={fmtCorner}
            zeroLine={0}
            includeZero
            valueLabels
          />
        </div>
      </div>
      {evo.trends.length > 0 && (
        <>
          <h3 className="a-h3">{uiText('Tendências (primeiro × último dia)')}</h3>
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
  {
    id: 'best',
    get label() {
      return uiText('Melhores voltas');
    },
  },
  {
    id: 'sessions',
    get label() {
      return uiText('Sessões');
    },
  },
  {
    id: 'evolution',
    get label() {
      return uiText('Evolução');
    },
  },
  {
    id: 'sectors',
    get label() {
      return uiText('Setores');
    },
  },
  {
    id: 'references',
    get label() {
      return uiText('Referências do top');
    },
  },
  {
    id: 'corners',
    get label() {
      return uiText('Curvas');
    },
  },
  {
    id: 'tasks',
    get label() {
      return uiText('Tarefas');
    },
  },
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
      <Empty action={{ label: uiText('Abrir a tela ao vivo'), href: routes.live() }}>
        <p>{uiText('Ainda não há voltas válidas nesta pista.')}</p>
        <p className="dim">
          {uiText('Complete uma volta limpa (sem sair da pista) e ela aparece aqui.')}
        </p>
      </Empty>
    );
  }
  return (
    <>
      {(usage.length > 1 || filtering) && (
        <>
          <div className="a-toolbar">
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
        <Empty
          action={{
            label: uiText('Mostrar todos os carros'),
            onClick: () => setCarFilter(NO_CAR_FILTER),
          }}
        >
          <p>{uiText('Nenhuma volta válida com esse carro nesta pista.')}</p>
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
                <span className="a-small dim">
                  {`${uiText('Melhor')} `}
                  <strong className="num a-pbtime">{formatLapTime(pb.timeMs)}</strong>
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
                      <a className="a-toplap-when" href={routes.session(l.sessionId)}>
                        {formatDateTime(l.startedAt)}
                        {` ${uiText('· volta')} `}
                        {l.number}
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
                  + {g.laps.length - TOP_PER_CAR}
                  {` ${uiText('voltas válidas com este carro.')}`}
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
      <Empty action={{ label: uiText('Abrir a tela ao vivo'), href: routes.live() }}>
        <p>{uiText('Nenhuma sessão nesta pista ainda.')}</p>
      </Empty>
    );
  }
  return (
    <>
      {(usage.length > 1 || isCarFiltering(carFilter)) && (
        <>
          <div className="a-toolbar">
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
        <Empty
          action={{
            label: uiText('Mostrar todos os carros'),
            onClick: () => setCarFilter(NO_CAR_FILTER),
          }}
        >
          <p>{uiText('Nenhuma sessão com esse carro nesta pista.')}</p>
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
                        {plural(s.lapCount, uiText('volta'), uiText('voltas'))}
                        {dur ? ` · ${dur}` : ''}
                        {s.endedAt === null && <Tag tone="info">{uiText('em andamento')}</Tag>}
                        {s.mode === 'replayCapture' && (
                          <Tag tone="ref">{uiText('captura de replay')}</Tag>
                        )}
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
      <p className="dim a-small">
        {uiText('Para apagar uma sessão inteira, abra-a e use “Apagar sessão”.')}
      </p>
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
  const tab: TabId = isTab(route.query.tab) ? route.query.tab : 'best';

  const data: ApiTrackAnalysis | null = ta.data;
  const track = data?.track ?? trackOnly.data ?? null;
  useTitle(track?.name ?? uiText('Pista'));
  const sessionList = sessions.data ?? [];
  const sessionId = pickSession(sessionList, route.query.session);

  const consistency = useFetch(tab === 'evolution' && sessionId ? `cons:${sessionId}` : null, () =>
    api.consistency(sessionId),
  );
  const theo = useFetch(tab === 'evolution' && sessionId ? `theo:${sessionId}` : null, async () => {
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
  const evo = useFetch(tab === 'evolution' ? `evo:${id}:${car ?? ''}` : null, () =>
    api.evolution(id, car ?? undefined),
  );

  useEffect(() => {
    if (track) setSectors(String(track.sectorGates.length || 3));
  }, [track]);

  const corners: MapCorner[] = data?.corners ?? NO_MAP;
  const fromDailies = route.query.from === 'dailies';
  const back = fromDailies
    ? { href: routes.dailies(), label: uiText('Voltar às corridas diárias') }
    : { href: routes.home(), label: uiText('Suas pistas') };

  if (ta.error && !track) {
    if (trackOnly.error || !trackOnly.loading) {
      return (
        <>
          <PageHead title={uiText('Pista')} back={back} />
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
    routes.track(id, {
      tab: t === 'best' ? undefined : t,
      session: route.query.session,
      from: fromDailies ? 'dailies' : undefined,
    });

  return (
    <>
      <PageHead
        back={back}
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
            {formatKm(track.lengthM, 3)} · {track.corners.length}
            {` ${uiText('curvas ·')}`} {track.sectorGates.length}
            {` ${uiText('setores')}`}
          </>
        }
        actions={
          <>
            <a className="a-btn a-btn-ghost" href={routes.sessions({ track: id })}>
              {uiText('Lista de sessões')}
            </a>
            <a className="a-btn" href={routes.coach()}>
              {uiText('Debrief com IA')}
            </a>
          </>
        }
      />

      {needsName && (
        <NewTrackPrompt trackId={id} lengthM={track.lengthM} onSaved={reload} variant="inline" />
      )}

      {data && (
        <div className="a-stats a-track-stats">
          <div className="a-stat" data-emph="1">
            <span className="a-stat-k">{uiText('Sua melhor volta')}</span>
            <span className="a-stat-v num">{formatLapTime(anyPb?.personalBestMs ?? null)}</span>
          </div>
          <div className="a-stat">
            <span className="a-stat-k">{uiText('Melhor do top')}</span>
            <span className="a-stat-v num">{bestRef ? formatLapTime(bestRef) : '–'}</span>
          </div>
          <div className="a-stat">
            <span className="a-stat-k">{uiText('Sessões')}</span>
            <span className="a-stat-v num">{sessions.data ? ownSessions.length : '–'}</span>
          </div>
          <div className="a-stat">
            <span className="a-stat-k">{uiText('Voltas')}</span>
            <span className="a-stat-v num">{data.lapCount}</span>
          </div>
        </div>
      )}

      <nav className="a-tabs" aria-label={uiText('Seções da pista')}>
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

      {tab === 'best' && (
        <>
          <GoalCard trackId={id} cars={cars} />
          <BestLapsTab trackId={id} hasTopReference={!!data?.references.length} />
          <TrackFicha track={track} />
        </>
      )}

      {tab === 'sessions' &&
        (sessions.error && !sessions.data ? (
          <ErrorBox error={sessions.error} onRetry={sessions.reload} />
        ) : !sessions.data ? (
          <Loading />
        ) : (
          <SessionsTab sessions={sessionList} />
        ))}

      {tab === 'evolution' && (
        <>
          <Card
            title={uiText('Evolução')}
            actions={
              cars.length > 1 && (
                <select
                  value={car ?? ''}
                  onChange={(e) => setCarCode(Number(e.target.value))}
                  aria-label={uiText('Carro')}
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
            title={uiText('Consistência de uma sessão')}
            className="a-mt"
            actions={
              sessionList.length > 0 && (
                <select
                  value={sessionId}
                  onChange={(e) =>
                    navigate(routes.track(id, { tab: 'evolution', session: e.target.value }), true)
                  }
                  aria-label={uiText('Sessão')}
                >
                  {sessionList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatDateTime(s.startedAt)} · {s.lapCount}
                      {` ${uiText('voltas')}`}
                      {s.mode === 'replayCapture' ? uiText(' · replay') : ''}
                    </option>
                  ))}
                </select>
              )
            }
          >
            {!sessionId ? (
              <p className="dim">{uiText('Nenhuma sessão nesta pista.')}</p>
            ) : consistency.error ? (
              <ErrorBox error={consistency.error} compact />
            ) : !consistency.data ? (
              <Loading />
            ) : (
              <ConsistencySection report={consistency.data} corners={corners} />
            )}
            {theo.data && (
              <div className="a-theo">
                <h3 className="a-h3">{uiText('Volta ideal da sessão')}</h3>
                <div className="a-stats">
                  <div className="a-stat">
                    <span className="a-stat-k">{uiText('Sua melhor')}</span>
                    <span className="a-stat-v num">
                      {formatLapTime(theo.data.report.bestLapMs)}
                    </span>
                  </div>
                  <div className="a-stat">
                    <span className="a-stat-k">{uiText('Melhores setores')}</span>
                    <span className="a-stat-v num">
                      {formatLapTime(theo.data.report.theoreticalBestSectorsMs)}
                    </span>
                  </div>
                  <div className="a-stat">
                    <span className="a-stat-k">
                      {`${uiText('Melhores')} `}
                      {theo.data.report.count}
                      {` ${uiText('microssetores')}`}
                    </span>
                    <span className="a-stat-v num">
                      {formatLapTime(theo.data.report.theoreticalBestMs)}
                    </span>
                  </div>
                  <div className="a-stat" data-emph="ideal">
                    <span className="a-stat-k">{uiText('Ganho possível')}</span>
                    <span className="a-stat-v num" data-tone="gain">
                      {formatDelta(theo.data.report.theoreticalBestMs - theo.data.report.bestLapMs)}
                    </span>
                  </div>
                </div>
                <p className="dim a-small">
                  {`${uiText('Soma dos melhores trechos de')} `}
                  {theo.data.report.laps.length}
                  {` ${uiText('voltas válidas: o quanto você já mostrou que consegue andar.')}`}
                </p>
              </div>
            )}
          </Card>
        </>
      )}

      {tab === 'sectors' && <SectorsTab trackId={id} cars={cars} />}

      {tab === 'tasks' && <TasksTab trackId={id} cars={cars} />}

      {tab === 'references' && (
        <Card title={uiText('Referências do top mundial')}>
          {data && data.references.length > 0 ? (
            <div className="a-table-wrap">
              <table className="a-table a-table-cards">
                <thead>
                  <tr>
                    <th>{uiText('Piloto')}</th>
                    <th>{uiText('Carro')}</th>
                    <th className="num-col">{uiText('Tempo')}</th>
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
                          <Tag tone="ref">ref</Tag> {r.driverName ?? uiText('sem nome')}
                        </td>
                        <td data-label="Carro">
                          <CarName carCode={r.carCode} />
                        </td>
                        <td className="num num-col" data-label="Tempo">
                          {formatLapTime(r.timeMs)}
                        </td>
                        <td>
                          {mine && (
                            <a
                              className="a-btn a-btn-ghost a-btn-sm"
                              href={routes.compare({ lap: mine, ref: r.lapId })}
                            >
                              {uiText('Comparar com minha melhor')}
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
            <div className="ui-empty a-empty">
              <strong>{uiText('Nenhuma volta de referência guardada para esta pista')}</strong>
              <p>
                {uiText(
                  'Assista ao replay de um piloto do ranking no Time Trial e o app grava a volta dele como alvo para você comparar.',
                )}
              </p>
              <a className="a-btn" href={routes.capture()}>
                <Icon name="capture" size={18} />
                {uiText('Gravar volta de replay')}
              </a>
            </div>
          )}
        </Card>
      )}

      {tab === 'corners' && (
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
              <Empty action={{ label: uiText('Abrir a tela ao vivo'), href: routes.live() }}>
                {uiText('A pista ainda não tem linha de referência (complete uma volta limpa).')}
              </Empty>
            )}
          </div>
          <Card
            title={uiText('Curvas')}
            actions={
              <ConfirmButton
                className="a-btn a-btn-ghost a-btn-sm"
                label={uiText('Redetectar curvas')}
                question={uiText('Detectar as curvas de novo? (nomes próximos são mantidos)')}
                confirmLabel={uiText('Redetectar')}
                onConfirm={async () => {
                  try {
                    const r = await api.redetectCorners(id);
                    addNotice(
                      'info',
                      r.detected
                        ? uiText('{0} curvas detectadas.', r.corners.length)
                        : uiText('Nada mudou.'),
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
              <p className="dim">{uiText('Nenhuma curva detectada ainda.')}</p>
            ) : (
              <div className="a-table-wrap a-corner-edit">
                <table className="a-table">
                  <thead>
                    <tr>
                      <th>{uiText('Curva')}</th>
                      <th>{uiText('Nome')}</th>
                      <th>{uiText('Marco de frenagem')}</th>
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
                  addNotice('warn', uiText('Use de 1 a 20 setores.'));
                  return;
                }
                try {
                  await api.setSectorCount(id, n);
                  addNotice('info', uiText('{0} setores de mesmo comprimento.', n));
                  reload();
                } catch (x) {
                  addNotice('error', (x as Error).message, 6000);
                }
              }}
            >
              <label>
                {uiText('Setores (iguais)')}
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
                {uiText('Aplicar')}
              </button>
              <span className="dim a-small">
                {uiText('Tempos de setor de voltas antigas não são recalculados.')}
              </span>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
