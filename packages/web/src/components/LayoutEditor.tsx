/**
 * Editor of the "Personalizada" grid: touch-friendly buttons only (no drag & drop). Tap a box in
 * the preview to select it, then move it earlier/later, resize it or remove it; add widgets from
 * the catalogue; choose the number of columns. Every change is saved in the device profile.
 */

import { WIDGET_IDS, type WidgetGridLayout } from '@gt7/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  GRID_COLUMNS_MAX,
  GRID_COLUMNS_MIN,
  LAYOUT_MAX_ITEMS,
  type LayoutAction,
  reduceLayout,
  sanitizeLayout,
  WIDGET_H_MAX,
  WIDGET_META,
} from '../lib/widgetLayout.ts';
import { closeLayoutEditor, dispatchProfile } from '../state/actions.ts';
import { useUi } from '../state/uiStore.ts';

export function LayoutEditor() {
  const open = useUi((s) => s.layoutEditorOpen);
  const raw = useUi((s) => s.profile.customLayout);
  const layout = useMemo(() => sanitizeLayout(raw), [raw]);
  const [selected, setSelected] = useState<string | null>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const controlsRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (open) doneRef.current?.focus();
  }, [open]);

  if (!open) return null;
  const sel = layout.items.find((i) => i.key === selected) ?? null;
  const idx = sel ? layout.items.indexOf(sel) : -1;

  const apply = (a: LayoutAction): WidgetGridLayout => {
    const next = reduceLayout(layout, a);
    if (next !== layout) dispatchProfile({ type: 'setCustomLayout', layout: next });
    return next;
  };

  return (
    <div
      className="picker-backdrop"
      data-no-gesture
      onPointerDown={(e) => e.target === e.currentTarget && closeLayoutEditor()}
    >
      <div className="picker editor" role="dialog" aria-modal="true" aria-label="Editar grade">
        <header className="picker-head">
          <h2>Tela Personalizada</h2>
          <button type="button" className="btn" ref={doneRef} onClick={closeLayoutEditor}>
            Concluir
          </button>
        </header>
        <div className="editor-body">
          <section className="editor-preview-wrap" aria-label="Pré-visualização">
            <div
              className="editor-preview"
              style={{
                gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${layout.rows}, minmax(36px, 1fr))`,
              }}
            >
              {layout.items.map((it, i) => (
                <button
                  type="button"
                  key={it.key}
                  className="editor-cell"
                  aria-pressed={it.key === selected}
                  style={{
                    gridColumn: `${it.x + 1} / span ${it.w}`,
                    gridRow: `${it.y + 1} / span ${it.h}`,
                  }}
                  onClick={() => {
                    setSelected(it.key === selected ? null : it.key);
                    controlsRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  <span className="editor-cell-n num">{i + 1}</span>
                  {WIDGET_META[it.widget].label}
                </button>
              ))}
              {layout.items.length === 0 && (
                <div className="editor-cell-empty dim">Adicione widgets ao lado</div>
              )}
            </div>
          </section>
          <section className="editor-controls" ref={controlsRef}>
            <div className="setting setting-row">
              <span className="setting-label">Colunas</span>
              <div className="stepper">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Menos colunas"
                  disabled={layout.columns <= GRID_COLUMNS_MIN}
                  onClick={() => apply({ type: 'setColumns', columns: layout.columns - 1 })}
                >
                  −
                </button>
                <span className="num stepper-value">{layout.columns}</span>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Mais colunas"
                  disabled={layout.columns >= GRID_COLUMNS_MAX}
                  onClick={() => apply({ type: 'setColumns', columns: layout.columns + 1 })}
                >
                  +
                </button>
              </div>
            </div>

            <div className="editor-selected" data-empty={sel ? '0' : '1'}>
              {sel ? (
                <>
                  <div className="editor-selected-name">
                    {idx + 1}. {WIDGET_META[sel.widget].label}
                    <span className="dim num">
                      {' '}
                      {sel.w}×{sel.h}
                    </span>
                  </div>
                  <div className="editor-actions">
                    <button
                      type="button"
                      className="chip"
                      disabled={idx <= 0}
                      onClick={() => apply({ type: 'move', key: sel.key, by: -1 })}
                    >
                      ◀ Antes
                    </button>
                    <button
                      type="button"
                      className="chip"
                      disabled={idx >= layout.items.length - 1}
                      onClick={() => apply({ type: 'move', key: sel.key, by: 1 })}
                    >
                      Depois ▶
                    </button>
                    <button
                      type="button"
                      className="chip"
                      disabled={sel.w <= 1}
                      onClick={() => apply({ type: 'resize', key: sel.key, dw: -1, dh: 0 })}
                    >
                      Largura −
                    </button>
                    <button
                      type="button"
                      className="chip"
                      disabled={sel.w >= layout.columns}
                      onClick={() => apply({ type: 'resize', key: sel.key, dw: 1, dh: 0 })}
                    >
                      Largura +
                    </button>
                    <button
                      type="button"
                      className="chip"
                      disabled={sel.h <= 1}
                      onClick={() => apply({ type: 'resize', key: sel.key, dw: 0, dh: -1 })}
                    >
                      Altura −
                    </button>
                    <button
                      type="button"
                      className="chip"
                      disabled={sel.h >= WIDGET_H_MAX}
                      onClick={() => apply({ type: 'resize', key: sel.key, dw: 0, dh: 1 })}
                    >
                      Altura +
                    </button>
                    <button
                      type="button"
                      className="chip chip-danger"
                      onClick={() => {
                        apply({ type: 'remove', key: sel.key });
                        setSelected(null);
                      }}
                    >
                      Remover
                    </button>
                  </div>
                </>
              ) : (
                <span className="dim">
                  Toque num widget da grade para mover, redimensionar ou remover.
                </span>
              )}
            </div>

            <div className="setting">
              <span className="setting-label">
                Adicionar widget{' '}
                <span className="dim num">
                  ({layout.items.length}/{LAYOUT_MAX_ITEMS})
                </span>
              </span>
              <div className="editor-add">
                {WIDGET_IDS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className="chip"
                    disabled={layout.items.length >= LAYOUT_MAX_ITEMS}
                    onClick={() => {
                      const next = apply({ type: 'add', widget: w });
                      setSelected(next.items.at(-1)?.key ?? null);
                      // Bring the selected-widget controls into view.
                      controlsRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                  >
                    + {WIDGET_META[w].label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                apply({ type: 'reset' });
                setSelected(null);
              }}
            >
              Restaurar grade padrão
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
