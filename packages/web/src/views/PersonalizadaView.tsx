import { useMemo } from 'react';
import { Icon } from '../components/ui/Icon.tsx';
import { sanitizeLayout } from '../lib/widgetLayout.ts';
import { openLayoutEditor } from '../state/actions.ts';
import { useUi } from '../state/uiStore.ts';
import { GridWidget } from '../widgets/gridWidgets.tsx';

export function PersonalizadaView() {
  const raw = useUi((s) => s.profile.customLayout);
  const locked = useUi((s) => s.profile.locked);
  const layout = useMemo(() => sanitizeLayout(raw), [raw]);

  return (
    <div className="view personalizada">
      {layout.items.length === 0 ? (
        <div className="grid-empty">
          <strong>Grade vazia</strong>
          <span className="dim">Toque em Editar para escolher os widgets desta tela.</span>
        </div>
      ) : (
        <div
          className="widget-grid"
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${layout.rows}, minmax(0, 1fr))`,
          }}
        >
          {layout.items.map((it) => {
            return (
              <div
                key={it.key}
                className="widget-cell"
                data-widget={it.widget}
                style={{
                  gridColumn: `${it.x + 1} / span ${it.w}`,
                  gridRow: `${it.y + 1} / span ${it.h}`,
                }}
              >
                <GridWidget widget={it.widget} />
              </div>
            );
          })}
        </div>
      )}
      {!locked && (
        <button
          type="button"
          className="ui-btn grid-edit-btn"
          data-variant="secondary"
          data-size="sm"
          data-no-gesture
          aria-label="Editar a grade"
          onClick={openLayoutEditor}
        >
          <Icon name="layout" size={16} />
          Editar
        </button>
      )}
    </div>
  );
}
