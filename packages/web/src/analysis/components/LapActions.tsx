/**
 * Ações de uma volta, agrupadas: o botão principal compara com a sua melhor volta e o menu "Mais"
 * guarda o resto (definir/tirar referência, itens extras da página, excluir com confirmação).
 */

import type { Lap } from '@gt7/shared';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Icon } from '../../components/ui/Icon.tsx';
import { t as uiText } from '../../lib/i18n.ts';
import { routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { ConfirmButton } from './ui.tsx';

const MENU_W = 240;
const MENU_H = 260;

/** Menu flutuante (position: fixed) para não ser cortado pela rolagem das tabelas. */
export function ActionMenu({
  label = uiText('Mais'),
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!body.current?.contains(t) && !btn.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      btn.current?.focus();
    };
    const onScroll = (e: Event) => {
      if (!body.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setPos(null);
      return;
    }
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
    const below = r.bottom + 4;
    setPos(
      below + MENU_H > window.innerHeight
        ? { left, bottom: window.innerHeight - r.top + 4 }
        : { left, top: below },
    );
  };

  return (
    <div className="a-menu">
      <button
        ref={btn}
        type="button"
        className="a-btn a-btn-quiet a-btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {label}
        <Icon name="chevron-down" size={14} />
      </button>
      {open && (
        <div
          ref={body}
          className="a-menu-body"
          role="menu"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export function LapQuickActions({
  lap,
  pbLapId,
  hasTopReference,
  onChanged,
  onDeleted,
  extra,
}: {
  lap: Lap;
  /** Personal best lap of the same track and car (null when unknown). */
  pbLapId: string | null;
  hasTopReference: boolean;
  /** Called with the updated lap after (un)setting the reference. */
  onChanged: (lap: Lap) => void;
  onDeleted: () => void;
  /** Extra menu items (links / buttons) placed between "referência" and "Excluir". */
  extra?: ReactNode;
}) {
  const isPb = pbLapId === lap.id;
  const compareHref = isPb
    ? routes.compare({ lap: lap.id, ref: hasTopReference ? 'bestReference' : 'auto' })
    : routes.compare({ lap: lap.id, ref: pbLapId ?? 'personalBest' });
  // Replay with the same reference the comparison uses (none when this lap is the only one).
  const replayRef = isPb
    ? hasTopReference
      ? 'bestReference'
      : undefined
    : (pbLapId ?? 'personalBest');
  const replayHref = routes.replay(lap.id, { ref: replayRef });
  const compareLabel = isPb
    ? hasTopReference
      ? [uiText('Comparar'), ' com o top']
      : [uiText('Analisar volta'), '']
    : [uiText('Comparar'), ' com minha melhor'];

  return (
    <div className="a-row-actions">
      <a className="a-btn a-btn-ghost a-btn-sm" href={compareHref}>
        {compareLabel[0]}
        <span className="a-btn-more">{compareLabel[1]}</span>
      </a>
      <a className="a-btn a-btn-ghost a-btn-sm" href={replayHref}>
        <Icon name="play" size={14} />
        {uiText('Replay')}
      </a>
      <ActionMenu>
        {lap.isReference ? (
          <ConfirmButton
            className="a-menu-item"
            label={uiText('Tirar de referência')}
            question={uiText('Deixar de ser referência?')}
            confirmLabel={uiText('Sim')}
            onConfirm={async () => {
              try {
                onChanged(await api.unsetReference(lap.id));
              } catch (e) {
                addNotice('error', (e as Error).message, 6000);
              }
            }}
          />
        ) : (
          <button
            type="button"
            role="menuitem"
            className="a-menu-item"
            disabled={!lap.valid}
            title={
              lap.valid
                ? uiText('Usa esta volta como alvo do delta ao vivo e das comparações')
                : uiText('Só voltas válidas podem ser referência')
            }
            onClick={async () => {
              try {
                onChanged(await api.setReference(lap.id, { driverName: uiText('Você') }));
                addNotice('info', uiText('Volta definida como referência.'));
              } catch (e) {
                addNotice('error', (e as Error).message, 6000);
              }
            }}
          >
            {uiText('Definir como referência')}
          </button>
        )}
        {extra}
        <hr className="a-menu-sep" />
        <ConfirmButton
          className="a-menu-item a-menu-danger"
          label={uiText('Excluir volta')}
          question={uiText('Excluir esta volta?')}
          confirmLabel={uiText('Excluir')}
          onConfirm={async () => {
            try {
              await api.deleteLap(lap.id);
              addNotice('info', uiText('Volta excluída.'));
              onDeleted();
            } catch (e) {
              addNotice('error', (e as Error).message, 6000);
            }
          }}
        />
      </ActionMenu>
    </div>
  );
}
