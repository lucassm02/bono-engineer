/**
 * Tarefas do engenheiro (spec 20): the instructions the radio engineer says at a place on the lap.
 * An agent (MCP) or the AI coach only PROPOSES; here the driver approves, edits, pauses and removes.
 * The same list rows are used by the track tab and by the Home card of proposals.
 */

import {
  type ApiTaskCreate,
  type EngineerTask,
  type Language,
  type TaskEditorOptions,
  type TaskSay,
  type TaskWhere,
  type Track,
  taskCornerNumber,
  taskEditorOptions,
} from '@gt7/shared';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/ui/Modal.tsx';
import { getLanguage, t as uiText, useLanguage } from '../../lib/i18n.ts';
import { listenTask, syncTaskVoice, taskKeys } from '../../state/tasks.ts';
import { addNotice } from '../../state/uiStore.ts';
import '../../styles/tasks.css';
import { ApiError, api } from '../api.ts';
import { carLabel } from '../lib/labels.ts';
import { useFetch } from '../useFetch.ts';
import { TaskVoiceApproval } from './TaskVoiceApproval.tsx';
import { ConfirmButton, Empty, ErrorBox, Loading, Tag } from './ui.tsx';

const ANY_CAR = '';

const errorText = (e: unknown, fallback: string) =>
  e instanceof ApiError ? uiText(e.message) : fallback;

// ---- where / say drafts -----------------------------------------------------------------------

type WhereKind = 'corner' | 'between' | 'before' | 'after' | 'sector' | 'straight' | 'global';
type SayKind = 'verb' | 'gear' | 'closed';

interface Draft {
  whereKind: WhereKind;
  corner: number;
  to: number;
  phase: '' | 'entry' | 'apex' | 'exit';
  sector: number;
  straight: 'start' | 'finish';
  global: string;
  sayKind: SayKind;
  stem: string;
  comparator: string;
  amount: string;
  gearAction: string;
  gear: number;
  closed: string;
  purpose: string;
  focus: string;
  carCode: string;
  note: string;
}

const EMPTY_DRAFT: Draft = {
  whereKind: 'corner',
  corner: 1,
  to: 2,
  phase: 'entry',
  sector: 1,
  straight: 'start',
  global: 'slowCorners',
  sayKind: 'verb',
  stem: 'brake',
  comparator: 'later',
  amount: '',
  gearAction: 'gearDown',
  gear: 3,
  closed: '',
  purpose: '',
  focus: 'focus',
  carCode: ANY_CAR,
  note: '',
};

const SECTOR_NUMBERS = [1, 2, 3, 4, 5, 6];
const GLOBALS = [
  'slowCorners',
  'fastCorners',
  'hardBraking',
  'allCorners',
  'allStraights',
] as const;

function globalLabel(id: string): string {
  switch (id) {
    case 'slowCorners':
      return uiText('Curvas lentas');
    case 'fastCorners':
      return uiText('Curvas rápidas');
    case 'hardBraking':
      return uiText('Frenagens fortes');
    case 'allCorners':
      return uiText('Todas as curvas');
    default:
      return uiText('Todas as retas');
  }
}

function groupLabel(group: string): string {
  switch (group) {
    case 'gear':
      return uiText('Marchas');
    case 'brake':
      return uiText('Freio');
    case 'throttle':
      return uiText('Acelerador');
    case 'steering':
      return uiText('Volante');
    case 'line':
      return uiText('Traçado');
    case 'pace':
      return uiText('Ritmo');
    case 'stability':
      return uiText('Estabilidade');
    case 'resource':
      return uiText('Pneus e combustível');
    case 'reference':
      return uiText('Referência');
    default:
      return uiText('Corrida');
  }
}

function toRequest(d: Draft): { where: TaskWhere; say: TaskSay } {
  const where: TaskWhere =
    d.whereKind === 'corner'
      ? d.phase
        ? { corner: d.corner, phase: d.phase }
        : { corner: d.corner }
      : d.whereKind === 'between'
        ? { between: [d.corner, d.to] }
        : d.whereKind === 'before'
          ? { before: d.corner }
          : d.whereKind === 'after'
            ? { after: d.corner }
            : d.whereKind === 'sector'
              ? { sector: d.sector }
              : d.whereKind === 'straight'
                ? { straight: d.straight }
                : { global: d.global as (typeof GLOBALS)[number] };
  const focus = d.focus as TaskSay['focus'];
  const say: TaskSay =
    d.sayKind === 'verb'
      ? {
          action: d.stem,
          ...(d.comparator ? { comparator: d.comparator } : {}),
          ...(d.amount ? { amount: d.amount } : {}),
        }
      : d.sayKind === 'gear'
        ? { action: d.gearAction, gear: d.gear }
        : { action: d.closed };
  if (d.purpose) say.purpose = d.purpose;
  if (focus) say.focus = focus;
  return { where, say };
}

function fromTask(task: EngineerTask, options: TaskEditorOptions): Draft {
  const d: Draft = {
    ...EMPTY_DRAFT,
    carCode: task.carCode === null ? ANY_CAR : String(task.carCode),
  };
  d.note = task.note ?? '';
  const w = task.where;
  if ('corner' in w) {
    d.whereKind = 'corner';
    d.corner = w.corner;
    d.phase = w.phase ?? '';
  } else if ('between' in w) {
    d.whereKind = 'between';
    d.corner = w.between[0];
    d.to = w.between[1];
  } else if ('before' in w) {
    d.whereKind = 'before';
    d.corner = w.before;
  } else if ('after' in w) {
    d.whereKind = 'after';
    d.corner = w.after;
  } else if ('sector' in w) {
    d.whereKind = 'sector';
    d.sector = w.sector;
  } else if ('straight' in w) {
    d.whereKind = 'straight';
    d.straight = w.straight;
  } else if ('global' in w) {
    d.whereKind = 'global';
    d.global = w.global;
  }
  const s = task.say;
  d.purpose = s.purpose ?? '';
  d.focus = s.focus ?? 'focus';
  if (options.stems.some((x) => x.id === s.action)) {
    d.sayKind = 'verb';
    d.stem = s.action;
    d.comparator = s.comparator ?? '';
    d.amount = s.amount ?? '';
  } else if (options.gear.some((x) => x.id === s.action)) {
    d.sayKind = 'gear';
    d.gearAction = s.action;
    d.gear = s.gear ?? 3;
  } else {
    d.sayKind = 'closed';
    d.closed = s.action;
  }
  return d;
}

// ---- the editor -------------------------------------------------------------------------------

function Select({
  label,
  value,
  onChange,
  children,
  id,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
  id: string;
}) {
  return (
    <div className="ui-field">
      <label className="ui-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="ui-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {children}
      </select>
    </div>
  );
}

function TaskEditor({
  trackId,
  track,
  cars,
  task,
  onClose,
  onSaved,
}: {
  trackId: string;
  track: Track | null;
  cars: { carCode: number }[];
  task: EngineerTask | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const language = useLanguage();
  const options = useMemo(() => taskEditorOptions(language), [language]);
  const corners = useMemo(
    () =>
      (track?.corners ?? [])
        .map((c) => taskCornerNumber(c.id))
        .filter((n): n is number => n !== null),
    [track],
  );
  const sectorCount = Math.max(2, Math.min(6, track?.sectorGates.length || 3));
  const [d, setD] = useState<Draft>(() =>
    task
      ? fromTask(task, options)
      : {
          ...EMPTY_DRAFT,
          whereKind: corners.length ? 'corner' : 'sector',
          corner: corners[0] ?? 1,
          to: corners[1] ?? 2,
        },
  );
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{
    ok: boolean;
    text?: string;
    keys?: string[];
    seconds?: number;
    error?: string;
  } | null>(null);

  const stem = options.stems.find((s) => s.id === d.stem);
  const needsAmount = d.comparator === 'earlier' || d.comparator === 'later';
  const request = useMemo(() => toRequest(d), [d]);

  useEffect(() => {
    const body: ApiTaskCreate = {
      trackId,
      carCode: d.carCode === ANY_CAR ? null : Number(d.carCode),
      ...request,
    };
    const timer = setTimeout(() => {
      api
        .taskPreview(body)
        .then((r) =>
          setPreview(
            r.ok
              ? {
                  ok: true,
                  text: r.text?.[getLanguage()] ?? '',
                  keys: r.keys ?? [],
                  seconds: (r.estimatedMs ?? 0) / 1000,
                }
              : { ok: false, error: r.error?.message ?? '' },
          ),
        )
        .catch((e: unknown) =>
          setPreview({
            ok: false,
            error: errorText(e, uiText('Não foi possível montar a frase.')),
          }),
        );
    }, 250);
    return () => clearTimeout(timer);
  }, [trackId, request, d.carCode]);

  const save = async () => {
    setBusy(true);
    try {
      const carCode = d.carCode === ANY_CAR ? null : Number(d.carCode);
      const note = d.note.trim() || null;
      if (task) await api.patchTask(task.id, { ...request, carCode, note });
      else await api.createTask({ trackId, carCode, note, ...request });
      addNotice('info', task ? uiText('Tarefa atualizada.') : uiText('Tarefa criada.'));
      onSaved();
      onClose();
    } catch (e) {
      addNotice('error', errorText(e, uiText('Não foi possível salvar a tarefa.')), 7000);
    } finally {
      setBusy(false);
    }
  };

  const cornerOptions = corners.map((n) => <option key={n} value={n}>{`T${n}`}</option>);
  const kinds: { id: WhereKind; label: string; needsCorners: boolean }[] = [
    { id: 'corner', label: uiText('Numa curva'), needsCorners: true },
    { id: 'between', label: uiText('Entre duas curvas'), needsCorners: true },
    { id: 'before', label: uiText('Antes de uma curva'), needsCorners: true },
    { id: 'after', label: uiText('Depois de uma curva'), needsCorners: true },
    { id: 'sector', label: uiText('Num setor'), needsCorners: false },
    { id: 'straight', label: uiText('Reta dos boxes ou chegada'), needsCorners: false },
    { id: 'global', label: uiText('Em várias curvas'), needsCorners: true },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={task ? uiText('Editar tarefa') : uiText('Nova tarefa')}
      footer={
        <>
          <button type="button" className="ui-btn" data-variant="ghost" onClick={onClose}>
            {uiText('Cancelar')}
          </button>
          <button
            type="button"
            className="ui-btn"
            disabled={busy || !preview?.ok}
            onClick={() => void save()}
          >
            {task ? uiText('Salvar') : uiText('Criar tarefa')}
          </button>
        </>
      }
    >
      <div className="tk-editor">
        <fieldset className="tk-group">
          <legend>{uiText('Onde')}</legend>
          <Select
            id="tk-where"
            label={uiText('Lugar')}
            value={d.whereKind}
            onChange={(v) => set('whereKind', v as WhereKind)}
          >
            {kinds
              .filter((k) => corners.length > 0 || !k.needsCorners)
              .map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
          </Select>
          {(d.whereKind === 'corner' ||
            d.whereKind === 'before' ||
            d.whereKind === 'after' ||
            d.whereKind === 'between') && (
            <Select
              id="tk-corner"
              label={d.whereKind === 'between' ? uiText('De') : uiText('Curva')}
              value={d.corner}
              onChange={(v) => set('corner', Number(v))}
            >
              {cornerOptions}
            </Select>
          )}
          {d.whereKind === 'between' && (
            <Select
              id="tk-to"
              label={uiText('Até')}
              value={d.to}
              onChange={(v) => set('to', Number(v))}
            >
              {cornerOptions}
            </Select>
          )}
          {d.whereKind === 'corner' && (
            <Select
              id="tk-phase"
              label={uiText('Momento')}
              value={d.phase}
              onChange={(v) => set('phase', v as Draft['phase'])}
            >
              <option value="">{uiText('Na curva')}</option>
              <option value="entry">{uiText('Entrada')}</option>
              <option value="apex">{uiText('Ápice')}</option>
              <option value="exit">{uiText('Saída')}</option>
            </Select>
          )}
          {d.whereKind === 'sector' && (
            <Select
              id="tk-sector"
              label={uiText('Setor')}
              value={d.sector}
              onChange={(v) => set('sector', Number(v))}
            >
              {SECTOR_NUMBERS.slice(0, sectorCount).map((n) => (
                <option key={n} value={n}>
                  {uiText('Setor {0}', n)}
                </option>
              ))}
            </Select>
          )}
          {d.whereKind === 'straight' && (
            <Select
              id="tk-straight"
              label={uiText('Reta')}
              value={d.straight}
              onChange={(v) => set('straight', v as Draft['straight'])}
            >
              <option value="start">{uiText('Reta dos boxes')}</option>
              <option value="finish">{uiText('Linha de chegada')}</option>
            </Select>
          )}
          {d.whereKind === 'global' && (
            <Select
              id="tk-global"
              label={uiText('Quais')}
              value={d.global}
              onChange={(v) => set('global', v)}
            >
              {GLOBALS.map((g) => (
                <option key={g} value={g}>
                  {globalLabel(g)}
                </option>
              ))}
            </Select>
          )}
        </fieldset>

        <fieldset className="tk-group">
          <legend>{uiText('O que o engenheiro diz')}</legend>
          <Select
            id="tk-say"
            label={uiText('Tipo')}
            value={d.sayKind}
            onChange={(v) => {
              const sayKind = v as SayKind;
              setD((x) => ({
                ...x,
                sayKind,
                closed:
                  sayKind === 'closed' && !x.closed
                    ? (options.closed[0]?.items[0]?.id ?? '')
                    : x.closed,
              }));
            }}
          >
            <option value="verb">{uiText('Freio, acelerador ou volante')}</option>
            <option value="gear">{uiText('Marcha')}</option>
            <option value="closed">{uiText('Frase pronta')}</option>
          </Select>
          {d.sayKind === 'verb' && (
            <>
              <Select
                id="tk-stem"
                label={uiText('Ação')}
                value={d.stem}
                onChange={(v) => {
                  const next = options.stems.find((s) => s.id === v);
                  setD((x) => ({
                    ...x,
                    stem: v,
                    comparator: next?.comparators.some((c) => c.id === x.comparator)
                      ? x.comparator
                      : (next?.comparators[0]?.id ?? ''),
                    amount: '',
                  }));
                }}
              >
                {options.stems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </Select>
              <Select
                id="tk-cmp"
                label={uiText('Como')}
                value={d.comparator}
                onChange={(v) => setD((x) => ({ ...x, comparator: v, amount: '' }))}
              >
                {(stem?.comparators ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
              {needsAmount && (
                <Select
                  id="tk-amt"
                  label={uiText('Quanto')}
                  value={d.amount}
                  onChange={(v) => set('amount', v)}
                >
                  <option value="">{uiText('Sem quantidade')}</option>
                  {options.amounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              )}
            </>
          )}
          {d.sayKind === 'gear' && (
            <>
              <Select
                id="tk-gearact"
                label={uiText('Ação')}
                value={d.gearAction}
                onChange={(v) => set('gearAction', v)}
              >
                {options.gear.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
              </Select>
              <Select
                id="tk-gear"
                label={uiText('Marcha')}
                value={d.gear}
                onChange={(v) => set('gear', Number(v))}
              >
                {[1, 2, 3, 4, 5, 6, 7, 8].map((g) => (
                  <option key={g} value={g}>{`${g}ª`}</option>
                ))}
              </Select>
            </>
          )}
          {d.sayKind === 'closed' && (
            <Select
              id="tk-closed"
              label={uiText('Frase')}
              value={d.closed}
              onChange={(v) => set('closed', v)}
            >
              {options.closed.map((g) => (
                <optgroup key={g.group} label={groupLabel(g.group)}>
                  {g.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
          <Select
            id="tk-purpose"
            label={uiText('Por quê (opcional)')}
            value={d.purpose}
            onChange={(v) => set('purpose', v)}
          >
            <option value="">{uiText('Sem motivo')}</option>
            {options.purposes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
          <Select
            id="tk-focus"
            label={uiText('Começa com')}
            value={d.focus}
            onChange={(v) => set('focus', v)}
          >
            {options.focuses.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
            <option value="none">{uiText('Nada')}</option>
          </Select>
        </fieldset>

        <fieldset className="tk-group">
          <legend>{uiText('Detalhes')}</legend>
          {cars.length > 0 && (
            <Select
              id="tk-car"
              label={uiText('Vale para')}
              value={d.carCode}
              onChange={(v) => set('carCode', v)}
            >
              <option value={ANY_CAR}>{uiText('Qualquer carro')}</option>
              {cars.map((c) => (
                <option key={c.carCode} value={String(c.carCode)}>
                  {carLabel(c.carCode)}
                </option>
              ))}
            </Select>
          )}
          <div className="ui-field">
            <label className="ui-label" htmlFor="tk-note">
              {uiText('Nota na tela (não é falada)')}
            </label>
            <input
              id="tk-note"
              className="ui-input"
              value={d.note}
              maxLength={140}
              onChange={(e) => set('note', e.target.value)}
            />
          </div>
        </fieldset>

        <div className="tk-preview" role="status" aria-live="polite">
          {preview === null ? (
            <span className="dim">{uiText('Montando a frase…')}</span>
          ) : preview.ok ? (
            <>
              <strong>{preview.text}</strong>
              <span className="dim a-small">
                {uiText('Cerca de {0} s de fala', (preview.seconds ?? 0).toFixed(1))}
              </span>
              <button
                type="button"
                className="ui-btn"
                data-variant="secondary"
                data-size="sm"
                onClick={() => void listenTask(preview.keys ?? [])}
              >
                {uiText('Ouvir')}
              </button>
            </>
          ) : (
            <span className="ui-error">{preview.error}</span>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---- one task row -----------------------------------------------------------------------------

function sourceLabel(task: EngineerTask): string {
  if (task.source === 'driver') return uiText('Criada por você');
  if (task.source === 'coach') return uiText('Coach IA');
  return task.agent ? uiText('Agente: {0}', task.agent) : uiText('Agente externo');
}

export function TaskRow({
  task,
  trackLabel,
  onChanged,
  onEdit,
}: {
  task: EngineerTask;
  trackLabel?: string;
  onChanged: () => void;
  onEdit?: (task: EngineerTask) => void;
}) {
  const language: Language = useLanguage();
  const [busy, setBusy] = useState(false);
  const [showVoiceApproval, setShowVoiceApproval] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true);
    try {
      await fn();
      if (ok) addNotice('info', ok);
      onChanged();
    } catch (e) {
      addNotice('error', errorText(e, uiText('Não foi possível concluir.')), 7000);
    } finally {
      setBusy(false);
    }
  };
  const status = (s: EngineerTask['status']) => run(() => api.patchTask(task.id, { status: s }));
  const approve = async () => {
    setBusy(true);
    const voice = await syncTaskVoice();
    if (voice?.status === 'ready') {
      await status('active');
      return;
    }
    setBusy(false);
    setShowVoiceApproval(true);
  };
  const proposed = task.status === 'proposed';
  const statusTag =
    task.status === 'active'
      ? { tone: 'pb' as const, text: uiText('Ativa') }
      : task.status === 'paused'
        ? { tone: 'warn' as const, text: uiText('Pausada') }
        : task.status === 'done'
          ? { tone: 'pb' as const, text: uiText('Concluída') }
          : task.status === 'stale'
            ? { tone: 'warn' as const, text: uiText('Precisa de revisão') }
            : task.status === 'dismissed'
              ? { tone: undefined, text: uiText('Descartada') }
              : { tone: 'info' as const, text: uiText('Proposta') };

  return (
    <li className="tk-row" data-status={task.status}>
      <div className="tk-main">
        {trackLabel && <span className="tk-track">{trackLabel}</span>}
        <p className="tk-text">{task.spoken[language]}</p>
        {task.why && <p className="tk-why">{uiText('Motivo: {0}', task.why)}</p>}
        {task.note && <p className="tk-why">{task.note}</p>}
        <div className="tk-meta">
          <Tag tone={statusTag.tone}>{statusTag.text}</Tag>
          <span>{sourceLabel(task)}</span>
          <span>{task.carCode === null ? uiText('Qualquer carro') : carLabel(task.carCode)}</span>
          {task.spokenCount > 0 && <span>{uiText('Falada {0}×', task.spokenCount)}</span>}
        </div>
      </div>
      <div className="tk-actions">
        <button
          type="button"
          className="ui-btn"
          data-variant="secondary"
          data-size="sm"
          onClick={() => void listenTask(taskKeys(task.ids))}
        >
          {uiText('Ouvir')}
        </button>
        {proposed && (
          <button
            type="button"
            className="ui-btn"
            data-size="sm"
            disabled={busy}
            onClick={() => void approve()}
          >
            {uiText('Aprovar')}
          </button>
        )}
        {(task.status === 'active' || task.status === 'paused') && (
          <button
            type="button"
            className="ui-btn"
            data-variant="secondary"
            data-size="sm"
            disabled={busy}
            onClick={() => void status(task.status === 'active' ? 'paused' : 'active')}
          >
            {task.status === 'active' ? uiText('Pausar') : uiText('Retomar')}
          </button>
        )}
        {task.status === 'stale' && (
          <button
            type="button"
            className="ui-btn"
            data-size="sm"
            disabled={busy}
            onClick={() => onEdit?.(task)}
          >
            {uiText('Revisar')}
          </button>
        )}
        {onEdit && task.status !== 'stale' && (
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => onEdit(task)}
          >
            {uiText('Editar')}
          </button>
        )}
        {proposed ? (
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            data-size="sm"
            disabled={busy}
            onClick={() => void run(() => api.deleteTask(task.id))}
          >
            {uiText('Descartar')}
          </button>
        ) : (
          <ConfirmButton
            className="a-btn a-btn-quiet a-btn-sm"
            label={uiText('Apagar')}
            question={uiText('Apagar a tarefa?')}
            onConfirm={() => run(() => api.deleteTask(task.id))}
          />
        )}
      </div>
      {proposed && showVoiceApproval && (
        <TaskVoiceApproval
          onClose={() => setShowVoiceApproval(false)}
          onApprove={() => {
            setShowVoiceApproval(false);
            void status('active');
          }}
        />
      )}
    </li>
  );
}

// ---- the track tab ----------------------------------------------------------------------------

export function TasksTab({ trackId, cars }: { trackId: string; cars: { carCode: number }[] }) {
  const list = useFetch(`tasks:${trackId}`, () => api.tasks({ trackId }), 15000);
  const track = useFetch(`tasks-track:${trackId}`, () => api.track(trackId));
  const [editing, setEditing] = useState<EngineerTask | 'new' | null>(null);
  const tasks = list.data?.tasks ?? [];
  const proposals = tasks.filter((x) => x.status === 'proposed');
  const mine = tasks.filter((x) => x.status !== 'proposed');

  return (
    <div className="tk-tab">
      <section className="a-card">
        <header className="a-card-head">
          <h2>{uiText('Tarefas do engenheiro')}</h2>
          <div className="a-actions">
            <button type="button" className="a-btn" onClick={() => setEditing('new')}>
              {uiText('Nova tarefa')}
            </button>
          </div>
        </header>
        <p className="dim a-small">
          {uiText(
            'Instruções que o engenheiro fala por rádio num ponto da volta. Um agente de IA (ou o Coach IA do app) só propõe: nada é falado até você aprovar.',
          )}
        </p>
      </section>

      {list.error && !list.data ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <Loading />
      ) : (
        <>
          {proposals.length > 0 && (
            <section className="a-card" aria-label={uiText('Propostas')}>
              <header className="a-card-head">
                <h2>{uiText('Propostas esperando você ({0})', proposals.length)}</h2>
              </header>
              <ul className="tk-list">
                {proposals.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onChanged={list.reload}
                    onEdit={(x) => setEditing(x)}
                  />
                ))}
              </ul>
            </section>
          )}
          <section className="a-card" aria-label={uiText('Suas tarefas')}>
            <header className="a-card-head">
              <h2>{uiText('Suas tarefas')}</h2>
            </header>
            {mine.length === 0 ? (
              <Empty>
                <p>
                  {uiText('Nenhuma tarefa ainda. Crie uma ou peça a um agente de IA pelo MCP.')}
                </p>
              </Empty>
            ) : (
              <ul className="tk-list">
                {mine.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    onChanged={list.reload}
                    onEdit={(x) => setEditing(x)}
                  />
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {editing && (
        <TaskEditor
          trackId={trackId}
          track={track.data}
          cars={cars}
          task={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={list.reload}
        />
      )}
    </div>
  );
}
