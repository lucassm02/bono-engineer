/**
 * Peças de linha das Configurações. Padrão único: título (15 px) + descrição de uma linha (13 px)
 * à esquerda, controle à direita. O `id` liga a linha à busca (`cfg-row-<id>`).
 */

import { type ReactNode, useEffect, useId, useState } from 'react';
import { addNotice } from '../../../state/uiStore.ts';

/** Executa uma gravação com aviso de sucesso/erro e um `busy` para travar o controle. */
export function useSave() {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | null> => {
    setBusy(true);
    try {
      const r = await fn();
      if (ok) addNotice('info', ok);
      return r;
    } catch (e) {
      addNotice('error', (e as Error).message, 7000);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export const rowDomId = (id: string) => `cfg-row-${id}`;

/** Linha com um controle livre à direita (segmentado, select, botão...). */
export function CfgRow({
  id,
  title,
  description,
  children,
  wide,
}: {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  /** O controle é largo (select/entrada): ocupa a linha inteira no celular e mais espaço no PC. */
  wide?: boolean;
}) {
  return (
    <div className="cfg-row" id={id ? rowDomId(id) : undefined} data-wide={wide ? '1' : undefined}>
      <div className="ui-toggle-text">
        <span className="ui-toggle-title">{title}</span>
        {description && <span className="ui-toggle-desc">{description}</span>}
      </div>
      <div className="cfg-row-control">{children}</div>
    </div>
  );
}

/** Linha com interruptor. */
export function CfgToggle({
  id,
  title,
  description,
  checked,
  disabled,
  hint,
  onChange,
}: {
  id?: string;
  title: string;
  description: ReactNode;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: () => void;
}) {
  const labelId = useId();
  return (
    <div className="ui-toggle" id={id ? rowDomId(id) : undefined}>
      <div className="ui-toggle-text">
        <span className="ui-toggle-title" id={labelId}>
          {title}
        </span>
        <span className="ui-toggle-desc">{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        className="ui-switch"
        disabled={disabled}
        title={hint}
        onClick={onChange}
      />
    </div>
  );
}

/**
 * Bloco recolhido ("Avançado"). Abre sozinho quando o link aponta para algo dentro dele
 * (`forceOpen`), mas o piloto continua podendo fechar.
 */
export function Advanced({
  id,
  summary,
  forceOpen,
  children,
}: {
  id?: string;
  summary: string;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!!forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);
  return (
    <details
      className="cfg-adv"
      id={id}
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>{summary}</summary>
      <div className="cfg-adv-body">{children}</div>
    </details>
  );
}
