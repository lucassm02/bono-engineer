/** The kind of a session (spec 21): a label to read and a select to change it. */

import type { Session, SessionKind } from '@gt7/shared';
import { SESSION_KINDS } from '@gt7/shared';
import { useId, useState } from 'react';
import { t as uiText } from '../../lib/i18n.ts';
import { addNotice } from '../../state/uiStore.ts';
import { api } from '../api.ts';
import { SESSION_KIND_LABELS, SESSION_KIND_TONES } from '../lib/labels.ts';
import { Tag } from './ui.tsx';

/** The badge of a session's kind; nothing for a session without one. */
export function KindTag({ kind }: { kind: SessionKind | null | undefined }) {
  if (!kind) return null;
  return <Tag tone={SESSION_KIND_TONES[kind]}>{SESSION_KIND_LABELS[kind]}</Tag>;
}

/**
 * A select that changes the kind through the API. The driver's choice sticks: the engine never
 * overrides it (see `kindSource`). `onChanged` gets the saved session.
 */
export function SessionKindSelect({
  session,
  onChanged,
  label = true,
}: {
  session: Pick<Session, 'id' | 'kind'>;
  onChanged: (s: Session) => void;
  label?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const id = useId();
  const change = async (value: string) => {
    const kind = value === '' ? null : (value as SessionKind);
    setBusy(true);
    try {
      onChanged(await api.setSessionKind(session.id, kind));
    } catch (e) {
      addNotice('error', (e as Error).message, 6000);
    } finally {
      setBusy(false);
    }
  };
  const select = (
    <select
      id={id}
      value={session.kind ?? ''}
      disabled={busy}
      aria-label={uiText('Tipo da sessão')}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => void change(e.target.value)}
    >
      <option value="">{uiText('Sem etiqueta')}</option>
      {SESSION_KINDS.map((k) => (
        <option key={k} value={k}>
          {SESSION_KIND_LABELS[k]}
        </option>
      ))}
    </select>
  );
  return label ? (
    <div className="kind-select">
      <label htmlFor={id}>{uiText('Tipo')}</label>
      {select}
    </div>
  ) : (
    select
  );
}
