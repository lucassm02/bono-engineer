/**
 * Interruptor do design system: `SwitchButton` é só a chave (`ui-switch`); `ToggleRow` é a linha
 * completa (título + descrição à esquerda, chave à direita) usada nos menus e gavetas.
 */

import { type ReactNode, useId } from 'react';

export function SwitchButton({
  on,
  label,
  labelledBy,
  onChange,
  disabled,
}: {
  on: boolean;
  /** Nome acessível quando não há texto visível ligado à chave. */
  label?: string;
  labelledBy?: string;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className="ui-switch"
      disabled={disabled}
      onClick={() => onChange(!on)}
    />
  );
}

export function ToggleRow({
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="ui-toggle">
      <div className="ui-toggle-text">
        <span id={id} className="ui-toggle-title">
          {title}
        </span>
        {description && <span className="ui-toggle-desc">{description}</span>}
      </div>
      <SwitchButton on={checked} labelledBy={id} onChange={onChange} disabled={disabled} />
    </div>
  );
}
