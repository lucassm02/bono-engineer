/**
 * Cartão de seção das telas de análise (Comparar, Captura, Configurações, Coach, Guia): título,
 * descrição curta e ações no topo, conteúdo embaixo. É só apresentação, em cima de `ui-card`.
 */

import type { ReactNode } from 'react';

export function Panel({
  title,
  description,
  actions,
  tone,
  id,
  className = '',
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  tone?: 'accent' | 'warn' | 'loss' | 'gain';
  id?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={`ui-card pn ${className}`} id={id} data-tone={tone}>
      {(title || actions) && (
        <header className="ui-card-head pn-head">
          <div className="pn-titles">
            {title && <h2 className="ui-card-title">{title}</h2>}
            {description && <p className="pn-desc">{description}</p>}
          </div>
          {actions && <div className="pn-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
