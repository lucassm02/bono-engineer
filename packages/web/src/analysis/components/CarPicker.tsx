/**
 * "Carro" filter in two visual steps: a grid of MAKERS (logo + lap count; the ones in the user's
 * history first, "all makers of the game" to browse the full catalogue) and, after choosing a
 * maker, the list of its CARS (name, year, group, "x voltas"). The search box ignores accents and
 * works in both steps (in the first it finds makers and cars at once).
 */

import {
  type CarEntry,
  type CarMaker,
  type CarUsage,
  carsOfMaker,
  getCar,
  getMaker,
  groupLabel,
  listMakers,
  makerOfCar,
  searchCars,
  searchMakers,
} from '@gt7/shared';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import { Modal } from '../../components/ui/Modal.tsx';
import {
  type CarFilter,
  describeCarFilter,
  isCarFiltering,
  NO_CAR_FILTER,
  pickCar,
  pickMaker,
  UNKNOWN_MAKER_ID,
  usageByMaker,
} from '../lib/carFilter.ts';
import { plural } from '../lib/history.ts';
import { BrandLogo } from './BrandLogo.tsx';
import { CarName } from './CarName.tsx';

/** Maximum number of cars listed for a text search that spans every maker. */
const SEARCH_LIMIT = 60;

// ---------------------------------------------------------------------------------------------
// Chips + trigger (what the pages embed)
// ---------------------------------------------------------------------------------------------

export function FilterChip({
  label,
  icon,
  onRemove,
  title,
}: {
  label: string;
  icon?: ReactNode;
  onRemove: () => void;
  title?: string;
}) {
  return (
    <span className="cf-chip" title={title}>
      {icon}
      <span className="cf-chip-text">{label}</span>
      <button
        type="button"
        className="cf-chip-x"
        onClick={onRemove}
        aria-label={`Remover filtro ${label}`}
      >
        <Icon name="close" size={14} />
      </button>
    </span>
  );
}

/** Removable chips of the active car filter (maker and/or car). Renders nothing when empty. */
export function CarFilterChips({
  value,
  onChange,
}: {
  value: CarFilter;
  onChange: (f: CarFilter) => void;
}) {
  if (!isCarFiltering(value)) return null;
  const maker = value.makerId !== null ? getMaker(value.makerId) : undefined;
  return (
    <>
      {value.makerId !== null && (value.carCode === null || maker) && (
        <FilterChip
          label={value.makerId === UNKNOWN_MAKER_ID ? 'Fora do catálogo' : (maker?.name ?? 'Marca')}
          icon={maker ? <BrandLogo maker={maker} size={22} /> : undefined}
          title="Marca"
          onRemove={() => onChange(NO_CAR_FILTER)}
        />
      )}
      {value.carCode !== null && (
        <FilterChip
          label={getCar(value.carCode)?.name ?? `Carro #${value.carCode}`}
          title="Carro"
          onRemove={() =>
            onChange(value.makerId !== null ? pickMaker(value.makerId) : NO_CAR_FILTER)
          }
        />
      )}
    </>
  );
}

/** The "Carro" field of a filter bar: a button that opens the picker. */
export function CarFilterField({
  usage,
  value,
  onChange,
  label = 'Carro',
}: {
  /** Cars (with lap counts) that exist in the screen's data; drives the "history" tab. */
  usage: readonly CarUsage[];
  value: CarFilter;
  onChange: (f: CarFilter) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const maker = value.makerId !== null ? getMaker(value.makerId) : undefined;
  return (
    <div className="cf-field">
      <span className="cf-label">{label}</span>
      <button
        type="button"
        className="cf-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        {value.carCode !== null ? (
          <CarName carCode={value.carCode} />
        ) : maker ? (
          <>
            <BrandLogo maker={maker} size={22} />
            <span className="carname-text">{maker.name}</span>
          </>
        ) : (
          <span className="carname-text">{describeCarFilter(value)}</span>
        )}
        <Icon name="chevron-down" size={16} className="cf-caret" />
      </button>
      {open && (
        <CarPicker
          usage={usage}
          value={value}
          onClose={() => setOpen(false)}
          onPick={(f) => {
            onChange(f);
            setOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------------------------

interface MakerTile {
  /** Null = cars missing from the catalogue. */
  maker: CarMaker | null;
  laps: number;
  carsUsed: number;
}

function CarPicker({
  usage,
  value,
  onClose,
  onPick,
}: {
  usage: readonly CarUsage[];
  value: CarFilter;
  onClose: () => void;
  onPick: (f: CarFilter) => void;
}) {
  const groups = useMemo(() => usageByMaker(usage), [usage]);
  const lapsByCar = useMemo(
    () => new Map(groups.flatMap((g) => g.cars.map((c) => [c.carCode, c.laps]))),
    [groups],
  );
  const lapsByMaker = useMemo(
    () => new Map(groups.map((g) => [g.maker?.id ?? UNKNOWN_MAKER_ID, g])),
    [groups],
  );
  const hasHistory = groups.length > 0;

  const [tab, setTab] = useState<'history' | 'all'>(hasHistory ? 'history' : 'all');
  const [makerId, setMakerId] = useState<number | null>(value.makerId);
  const [query, setQuery] = useState('');
  const [onlyUsed, setOnlyUsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);

  // Ao trocar de passo (marca <-> carros) o botão clicado some: devolve o foco para a busca.
  // biome-ignore lint/correctness/useExhaustiveDependencies: roda só quando o passo muda
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    searchRef.current?.focus();
  }, [makerId]);

  const tiles = useMemo<MakerTile[]>(() => {
    const used = (m: CarMaker | null): MakerTile => {
      const g = lapsByMaker.get(m?.id ?? UNKNOWN_MAKER_ID);
      return { maker: m, laps: g?.laps ?? 0, carsUsed: g?.cars.length ?? 0 };
    };
    const hist = groups.map((g) => used(g.maker));
    if (tab === 'history') return hist;
    const usedIds = new Set(hist.map((t) => t.maker?.id));
    const rest = listMakers()
      .filter((m) => !usedIds.has(m.id))
      .map((m) => used(m));
    return [...hist, ...rest];
  }, [groups, lapsByMaker, tab]);

  const q = query.trim();
  const maker = makerId !== null && makerId !== UNKNOWN_MAKER_ID ? getMaker(makerId) : undefined;
  const inMaker = makerId !== null;

  const title = inMaker
    ? makerId === UNKNOWN_MAKER_ID
      ? 'Fora do catálogo'
      : (maker?.name ?? 'Marca')
    : 'Escolher carro';

  const subtitle = maker
    ? `${maker.countryName} · ${plural(maker.carCount, 'carro', 'carros')} no jogo`
    : makerId === UNKNOWN_MAKER_ID
      ? 'Carros que ainda não estão na lista do jogo (DLC novo?)'
      : 'Escolha a marca e depois o carro';

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      className="cp-modal"
      title={
        <span className="cp-title">
          {maker && <BrandLogo maker={maker} size={32} />}
          <span>{title}</span>
        </span>
      }
      subtitle={subtitle}
    >
      <div className="cp-toolbar">
        <div className="cp-search">
          <Icon name="search" size={18} />
          <input
            ref={searchRef}
            className="ui-input"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              inMaker
                ? `Buscar carro da ${title}…`
                : 'Buscar marca ou carro (ex.: supra, gt-r, civic)'
            }
            aria-label="Buscar"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {inMaker && (
          <button
            type="button"
            className="ui-btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => {
              setMakerId(null);
              setQuery('');
              setOnlyUsed(false);
            }}
          >
            <Icon name="back" size={16} />
            Todas as marcas
          </button>
        )}
      </div>

      {!inMaker ? (
        q !== '' ? (
          <SearchResults
            query={q}
            lapsByCar={lapsByCar}
            lapsByMaker={lapsByMaker}
            onMaker={(id) => {
              setMakerId(id);
              setQuery('');
            }}
            onCar={(code) => onPick(pickCar(code))}
            onClear={() => setQuery('')}
          />
        ) : (
          <>
            {hasHistory && (
              <div className="ui-segmented cp-tabs">
                <button
                  type="button"
                  aria-pressed={tab === 'history'}
                  onClick={() => setTab('history')}
                >
                  No meu histórico
                </button>
                <button type="button" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
                  Todas as marcas do jogo
                </button>
              </div>
            )}
            {!hasHistory && (
              <p className="cp-hint">
                Você ainda não tem voltas gravadas: aqui estão todas as marcas do Gran Turismo 7.
              </p>
            )}
            {isCarFiltering(value) && (
              <button type="button" className="cp-all" onClick={() => onPick(NO_CAR_FILTER)}>
                Mostrar todos os carros (limpar filtro)
              </button>
            )}
            <ul className="cp-grid">
              {tiles.map((t) => {
                const id = t.maker?.id ?? UNKNOWN_MAKER_ID;
                return (
                  <li key={id}>
                    <BrandTile
                      maker={t.maker}
                      laps={t.laps}
                      active={value.makerId === id}
                      onClick={() => setMakerId(id)}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )
      ) : (
        <MakerCars
          makerId={makerId}
          query={q}
          onlyUsed={onlyUsed}
          setOnlyUsed={setOnlyUsed}
          lapsByCar={lapsByCar}
          usedCars={lapsByMaker.get(makerId)?.cars ?? []}
          activeCar={value.carCode}
          onAllOfMaker={() => onPick(pickMaker(makerId))}
          onCar={(code) => onPick(pickCar(code))}
          onClear={() => setQuery('')}
        />
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 2: cars of one maker
// ---------------------------------------------------------------------------------------------

function MakerCars({
  makerId,
  query,
  onlyUsed,
  setOnlyUsed,
  lapsByCar,
  usedCars,
  activeCar,
  onAllOfMaker,
  onCar,
  onClear,
}: {
  makerId: number;
  query: string;
  onlyUsed: boolean;
  setOnlyUsed: (v: boolean) => void;
  lapsByCar: ReadonlyMap<number, number>;
  usedCars: readonly CarUsage[];
  activeCar: number | null;
  onAllOfMaker: () => void;
  onCar: (carCode: number) => void;
  onClear: () => void;
}) {
  const unknown = makerId === UNKNOWN_MAKER_ID;
  const maker = unknown ? undefined : getMaker(makerId);
  const rows = useMemo(() => {
    if (unknown) {
      return usedCars.map((c) => ({
        id: c.carCode,
        label: `Carro #${c.carCode}`,
        sub: '',
        group: '',
      }));
    }
    let list: readonly CarEntry[] = query ? searchCars(query, { makerId }) : carsOfMaker(makerId);
    if (onlyUsed) list = list.filter((c) => (lapsByCar.get(c.id) ?? 0) > 0);
    return list.map((c) => ({
      id: c.id,
      label: c.baseName,
      sub: c.year ? String(c.year) : '',
      group: groupLabel(c.group),
    }));
  }, [unknown, usedCars, query, makerId, onlyUsed, lapsByCar]);

  const anyUsed = usedCars.length > 0;
  const name = maker?.name ?? 'Fora do catálogo';

  return (
    <>
      <button type="button" className="cp-all" onClick={onAllOfMaker}>
        {unknown ? 'Todos os carros fora do catálogo' : `Todos os carros da ${name}`}
        {anyUsed && (
          <span className="cp-all-sub">
            {' '}
            ·{' '}
            {plural(
              usedCars.reduce((n, c) => n + c.laps, 0),
              'volta',
              'voltas',
            )}
          </span>
        )}
      </button>
      {!unknown && anyUsed && (
        <label className="cp-check">
          <input
            type="checkbox"
            checked={onlyUsed}
            onChange={(e) => setOnlyUsed(e.target.checked)}
          />
          Só os que eu já usei
        </label>
      )}
      {rows.length === 0 ? (
        <Nothing
          text={
            query
              ? `Nenhum carro da ${name} combina com “${query}”.`
              : 'Nenhum carro para mostrar com esse filtro.'
          }
          onClear={query ? onClear : onlyUsed ? () => setOnlyUsed(false) : undefined}
          clearLabel={query ? 'Limpar a busca' : 'Mostrar todos'}
        />
      ) : (
        <ul className="cp-cars">
          {rows.map((r) => {
            const laps = lapsByCar.get(r.id) ?? 0;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className="cp-car"
                  data-active={activeCar === r.id ? '1' : undefined}
                  onClick={() => onCar(r.id)}
                >
                  <span className="cp-car-main">
                    <span className="cp-car-name">{r.label}</span>
                    <span className="cp-car-meta">
                      {[r.sub, r.group].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {laps > 0 && (
                    <span className="ui-badge" data-tone="accent">
                      {plural(laps, 'volta', 'voltas')}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Step 1 with text: makers and cars at once
// ---------------------------------------------------------------------------------------------

function SearchResults({
  query,
  lapsByCar,
  lapsByMaker,
  onMaker,
  onCar,
  onClear,
}: {
  query: string;
  lapsByCar: ReadonlyMap<number, number>;
  lapsByMaker: ReadonlyMap<number, { laps: number }>;
  onMaker: (id: number) => void;
  onCar: (carCode: number) => void;
  onClear: () => void;
}) {
  const makers = useMemo(() => searchMakers(query), [query]);
  const cars = useMemo(() => searchCars(query, { limit: SEARCH_LIMIT + 1 }), [query]);
  const more = cars.length > SEARCH_LIMIT;
  const shown = more ? cars.slice(0, SEARCH_LIMIT) : cars;

  if (makers.length === 0 && shown.length === 0) {
    return (
      <Nothing
        text={`Nada encontrado para “${query}”. Tente só parte do nome (ex.: “skyl” ou “civic”).`}
        onClear={onClear}
        clearLabel="Limpar a busca"
      />
    );
  }
  return (
    <>
      {makers.length > 0 && (
        <>
          <h3 className="cp-sec">Marcas</h3>
          <ul className="cp-grid">
            {makers.slice(0, 12).map((m) => (
              <li key={m.id}>
                <BrandTile
                  maker={m}
                  laps={lapsByMaker.get(m.id)?.laps ?? 0}
                  onClick={() => onMaker(m.id)}
                />
              </li>
            ))}
          </ul>
        </>
      )}
      {shown.length > 0 && (
        <>
          <h3 className="cp-sec">Carros</h3>
          <ul className="cp-cars">
            {shown.map((c) => {
              const laps = lapsByCar.get(c.id) ?? 0;
              const m = makerOfCar(c.id);
              return (
                <li key={c.id}>
                  <button type="button" className="cp-car" onClick={() => onCar(c.id)}>
                    <BrandLogo maker={m} size={32} />
                    <span className="cp-car-main">
                      <span className="cp-car-name">{c.name}</span>
                      <span className="cp-car-meta">
                        {[m?.name, groupLabel(c.group)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {laps > 0 && (
                      <span className="ui-badge" data-tone="accent">
                        {plural(laps, 'volta', 'voltas')}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {more && (
            <p className="cp-hint">
              Mostrando os {SEARCH_LIMIT} primeiros. Escreva mais do nome para refinar.
            </p>
          )}
        </>
      )}
    </>
  );
}

function Nothing({
  text,
  onClear,
  clearLabel,
}: {
  text: string;
  onClear?: () => void;
  clearLabel: string;
}) {
  return (
    <div className="cp-empty">
      <Icon name="search" size={28} className="cp-empty-icon" />
      <p>{text}</p>
      {onClear && (
        <button type="button" className="ui-btn" data-variant="secondary" onClick={onClear}>
          {clearLabel}
        </button>
      )}
    </div>
  );
}

function BrandTile({
  maker,
  laps,
  active,
  onClick,
}: {
  maker: CarMaker | null;
  laps: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="cp-brand"
      data-used={laps > 0 ? '1' : undefined}
      data-active={active ? '1' : undefined}
      onClick={onClick}
    >
      <BrandLogo maker={maker} size={44} />
      <span className="cp-brand-name">{maker?.name ?? 'Fora do catálogo'}</span>
      <span className="cp-brand-sub">
        {laps > 0
          ? plural(laps, 'volta', 'voltas')
          : plural(maker?.carCount ?? 0, 'carro', 'carros')}
      </span>
    </button>
  );
}
