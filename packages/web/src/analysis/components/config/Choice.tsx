/** Opção de uma escolha única (importar, trocar de pasta): cartão clicável sobre um `input radio`. */

import type { ReactNode } from 'react';

export function Choice({
  name,
  checked,
  onChange,
  title,
  description,
  danger,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: ReactNode;
  description: ReactNode;
  danger?: boolean;
}) {
  return (
    <label
      className="dm-choice"
      data-checked={checked ? '1' : '0'}
      data-danger={danger ? '1' : undefined}
    >
      <input type="radio" name={name} className="dm-radio" checked={checked} onChange={onChange} />
      <strong>{title}</strong>
      <span>{description}</span>
    </label>
  );
}
