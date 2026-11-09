/**
 * Native `<select>` with every car of the catalogue grouped by maker (A–Z): choose from a list,
 * never type. Native on purpose: it works with the phone's own picker, keyboard and screen readers.
 */

import { memo } from 'react';
import { carOptionGroups } from '../lib/captureForm.ts';

export interface LeadOption {
  value: string;
  label: string;
}

const CarOptions = memo(function CarOptions() {
  return (
    <>
      {carOptionGroups().map((g) => (
        <optgroup key={g.makerId} label={g.makerName}>
          {g.cars.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {c.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
});

export function CarSelect({
  id,
  value,
  onChange,
  lead,
  disabled,
  describedBy,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Options before the list of makers ("Detectado: …", "Não informar"). */
  lead: readonly LeadOption[];
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <select
      id={id}
      className="a-input cap-select"
      value={value}
      disabled={disabled}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value)}
    >
      {lead.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      <CarOptions />
    </select>
  );
}
