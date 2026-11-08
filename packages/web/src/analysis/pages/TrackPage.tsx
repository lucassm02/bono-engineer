/**
 * #/analise/pista/:trackId?session= — track map + corner names, sectors, re-detection, records and
 * references, consistency of a session, microsector theoretical best and evolution over days.
 */

import type {
  ApiTrackAnalysis,
  ConsistencyReport,
  CornerMetricKey,
  EvolutionCornerPoint,
  EvolutionReport,
  MapCorner,
  MetricStats,
  Session,
} from '@gt7/shared';
import { useEffect, useMemo, useState } from 'react';
import { formatDelta, formatLapTime } from '../../lib/format.ts';
import { navigate, type Route, routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { CompareMap } from '../components/CompareMap.tsx';
import { MiniChart, type MiniSeries } from '../components/MiniChart.tsx';
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
import { cornerLabel, fixed, signed } from '../lib/chartData.ts';
import { CORNER_KIND_LABELS, carLabel, formatDateTime, formatDay } from '../lib/labels.ts';
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
        {carLabel(evo.carCode)} · base:{' '}
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
  const [renaming, setRenaming] = useState<string | null>(null);

  const data: ApiTrackAnalysis | null = ta.data;
  const track = data?.track ?? trackOnly.data ?? null;
  useTitle(track?.name ?? 'Pista');
  const sessionList = sessions.data ?? [];
  const sessionId = pickSession(sessionList, route.query.session);

  const consistency = useFetch(sessionId ? `cons:${sessionId}` : null, () =>
    api.consistency(sessionId),
  );
  const theo = useFetch(sessionId ? `theo:${sessionId}` : null, async () => {
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
  const evo = useFetch(`evo:${id}:${car ?? ''}`, () => api.evolution(id, car ?? undefined));

  useEffect(() => {
    if (track) setSectors(String(track.sectorGates.length || 3));
  }, [track]);

  const corners: MapCorner[] = data?.corners ?? NO_MAP;

  if (ta.error && !track) {
    if (trackOnly.error || !trackOnly.loading) {
      return (
        <>
          <PageHead title="Pista" back={{ href: routes.sessions(), label: 'Sessões' }} />
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

  return (
    <>
      <PageHead
        back={{ href: routes.sessions({ track: id }), label: 'Sessões desta pista' }}
        title={
          renaming !== null ? (
            <form
              className="a-rename"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.renameTrack(id, renaming.trim());
                  setRenaming(null);
                  reload();
                } catch (x) {
                  addNotice('error', (x as Error).message, 6000);
                }
              }}
            >
              <input
                className="a-input"
                value={renaming}
                maxLength={80}
                // biome-ignore lint/a11y/noAutofocus: inline rename
                autoFocus
                onChange={(e) => setRenaming(e.target.value)}
                aria-label="Nome da pista"
              />
              <button type="submit" className="a-btn a-btn-sm" disabled={!renaming.trim()}>
                Salvar
              </button>
              <button
                type="button"
                className="a-btn a-btn-ghost a-btn-sm"
                onClick={() => setRenaming(null)}
              >
                Cancelar
              </button>
            </form>
          ) : (
            <>
              {track.name}{' '}
              <button
                type="button"
                className="a-link-btn a-small"
                onClick={() => setRenaming(track.name)}
              >
                renomear
              </button>
            </>
          )
        }
        sub={
          <>
            {(track.lengthM / 1000).toFixed(3).replace('.', ',')} km · {track.corners.length} curvas
            · {track.sectorGates.length} setores
            {data && (
              <>
                {' '}
                · {data.sessionCount} sessões · {data.lapCount} voltas
              </>
            )}
          </>
        }
      />

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

      {data && (
        <Card title="Recordes e referências" className="a-mt">
          <div className="a-records">
            <div>
              <span className="a-sum-k">Melhor de todos (inclui referências)</span>
              <span className="a-sum-v num">{formatLapTime(data.records.overallBestMs)}</span>
            </div>
            {cars.map((c) => (
              <div key={c.carCode}>
                <span className="a-sum-k">
                  {carLabel(c.carCode)} · {c.validLaps}/{c.laps} válidas
                </span>
                <span className="a-sum-v num">{formatLapTime(c.personalBestMs)}</span>
                {c.personalBestLapId && (
                  <a
                    className="a-small"
                    href={routes.compare({ lap: c.personalBestLapId, ref: 'bestReference' })}
                  >
                    comparar com o top
                  </a>
                )}
              </div>
            ))}
          </div>
          {data.references.length > 0 ? (
            <div className="a-table-wrap a-mt">
              <table className="a-table">
                <thead>
                  <tr>
                    <th>Referência</th>
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
                        <td>{carLabel(r.carCode)}</td>
                        <td className="num num-col">{formatLapTime(r.timeMs)}</td>
                        <td>
                          {mine && (
                            <a
                              className="a-btn a-btn-sm"
                              href={routes.compare({ lap: mine, ref: r.lapId })}
                            >
                              Comparar meu melhor
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
            <p className="dim a-mt">
              Nenhuma referência do top nesta pista.{' '}
              <a href={routes.capture()}>Capture uma volta de replay</a>.
            </p>
          )}
        </Card>
      )}

      <Card
        title="Consistência"
        className="a-mt"
        actions={
          sessionList.length > 0 && (
            <select
              value={sessionId}
              onChange={(e) => navigate(routes.track(id, { session: e.target.value }), true)}
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
              Soma dos melhores trechos de {theo.data.report.laps.length} voltas válidas: o quanto
              você já mostrou que consegue andar.
            </p>
          </div>
        )}
      </Card>

      <Card
        title="Evolução"
        className="a-mt"
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
    </>
  );
}
