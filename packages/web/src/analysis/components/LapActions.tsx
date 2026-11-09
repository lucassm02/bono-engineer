/** Quick actions of a lap: compare with my best, set as reference, delete (with confirmation). */

import type { Lap } from '@gt7/shared';
import type { ReactNode } from 'react';
import { routes } from '../../lib/route.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { ConfirmButton } from './ui.tsx';

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
  /** Extra items placed before the buttons (e.g. a "Mais" menu). */
  extra?: ReactNode;
}) {
  const isPb = pbLapId === lap.id;
  const compareHref = isPb
    ? routes.compare({ lap: lap.id, ref: hasTopReference ? 'bestReference' : 'auto' })
    : routes.compare({ lap: lap.id, ref: pbLapId ?? 'personalBest' });
  const compareLabel = isPb
    ? hasTopReference
      ? 'Comparar com o top'
      : 'Analisar volta'
    : 'Comparar com minha melhor';

  return (
    <div className="a-row-actions">
      <a className="a-btn a-btn-sm" href={compareHref}>
        {compareLabel}
      </a>
      {lap.isReference ? (
        <ConfirmButton
          className="a-btn a-btn-ghost a-btn-sm"
          label="Tirar de referência"
          question="Deixar de ser referência?"
          confirmLabel="Sim"
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
          className="a-btn a-btn-ghost a-btn-sm"
          disabled={!lap.valid}
          title={
            lap.valid
              ? 'Usa esta volta como alvo do delta ao vivo e das comparações'
              : 'Só voltas válidas podem ser referência'
          }
          onClick={async () => {
            try {
              onChanged(await api.setReference(lap.id, { driverName: 'Você' }));
              addNotice('info', 'Volta definida como referência.');
            } catch (e) {
              addNotice('error', (e as Error).message, 6000);
            }
          }}
        >
          Definir como referência
        </button>
      )}
      {extra}
      <ConfirmButton
        className="a-btn a-btn-ghost a-btn-sm a-btn-quiet-danger"
        label="Excluir"
        question="Excluir esta volta?"
        confirmLabel="Excluir"
        onConfirm={async () => {
          try {
            await api.deleteLap(lap.id);
            addNotice('info', 'Volta excluída.');
            onDeleted();
          } catch (e) {
            addNotice('error', (e as Error).message, 6000);
          }
        }}
      />
    </div>
  );
}
