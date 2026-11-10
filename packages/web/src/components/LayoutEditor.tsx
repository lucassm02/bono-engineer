/**
 * Editor da grade "Personalizada": só botões (sem arrastar). Toque numa caixa da pré-visualização
 * para selecioná-la e mova, redimensione ou remova; adicione widgets do catálogo e escolha o número
 * de colunas. Toda alteração é salva no perfil do aparelho. Foco, Esc e fundo vêm do Modal.
 */

import { WIDGET_IDS, type WidgetGridLayout } from '@gt7/shared';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
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
import { Icon, type IconName } from './ui/Icon.tsx';
import { Modal } from './ui/Modal.tsx';

/** Linha "rótulo + − valor +" usada para colunas, largura e altura. */
function Stepper({
  label,
  value,
  onLess,
  onMore,
  lessDisabled,
  moreDisabled,
}: {
  label: string;
  value: ReactNode;
  onLess: () => void;
  onMore: () => void;
  lessDisabled: boolean;
  moreDisabled: boolean;
}) {
  return (
    <div className="bn-stepper-row">
      <span className="bn-stepper-label">{label}</span>
      <div className="stepper">
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={`${label}: diminuir`}
          disabled={lessDisabled}
          onClick={onLess}
        >
          <Icon name="minus" />
        </button>
        <span className="num stepper-value">{value}</span>
        <button
          type="button"
          className="ui-icon-btn"
          aria-label={`${label}: aumentar`}
          disabled={moreDisabled}
          onClick={onMore}
        >
          <Icon name="plus" />
        </button>
      </div>
    </div>
  );
}

function MoveButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: IconName;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="ui-icon-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}

export function LayoutEditor() {
  const open = useUi((s) => s.layoutEditorOpen);
  const raw = useUi((s) => s.profile.customLayout);
  const layout = useMemo(() => sanitizeLayout(raw), [raw]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<HTMLElement>(null);

  // Em telas estreitas os controles ficam abaixo da pré-visualização: traz-os para a vista.
  useEffect(() => {
    if (selected) selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  const sel = layout.items.find((i) => i.key === selected) ?? null;
  const idx = sel ? layout.items.indexOf(sel) : -1;

  const apply = (a: LayoutAction): WidgetGridLayout => {
    const next = reduceLayout(layout, a);
    if (next !== layout) dispatchProfile({ type: 'setCustomLayout', layout: next });
    return next;
  };

  return (
    <Modal
      open={open}
      onClose={closeLayoutEditor}
      size="xl"
      className="bn-editor-modal"
      title="Tela Personalizada"
      subtitle="Monte a sua grade de widgets. As alterações são salvas na hora, neste aparelho."
      footer={
        <>
          <button
            type="button"
            className="ui-btn bn-foot-left"
            data-variant="ghost"
            onClick={() => {
              apply({ type: 'reset' });
              setSelected(null);
            }}
          >
            Restaurar grade padrão
          </button>
          <button type="button" className="ui-btn" onClick={closeLayoutEditor}>
            Concluir
          </button>
        </>
      }
    >
      <div className="bn-editor">
        <section className="bn-editor-preview-wrap" aria-label="Pré-visualização">
          <h3 className="ui-eyebrow">Pré-visualização</h3>
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
                onClick={() => setSelected(it.key === selected ? null : it.key)}
              >
                <span className="editor-cell-n num">{i + 1}</span>
                {WIDGET_META[it.widget].label}
              </button>
            ))}
            {layout.items.length === 0 && (
              <div className="editor-cell-empty">Adicione widgets ao lado</div>
            )}
          </div>
          <p className="ui-help">Cada caixa é um widget; o número é a ordem em que aparece.</p>
        </section>

        <section className="bn-editor-controls">
          <div className="ui-card bn-card">
            <Stepper
              label="Colunas"
              value={layout.columns}
              lessDisabled={layout.columns <= GRID_COLUMNS_MIN}
              moreDisabled={layout.columns >= GRID_COLUMNS_MAX}
              onLess={() => apply({ type: 'setColumns', columns: layout.columns - 1 })}
              onMore={() => apply({ type: 'setColumns', columns: layout.columns + 1 })}
            />
          </div>

          <section
            className="ui-card bn-card editor-selected"
            data-empty={sel ? '0' : '1'}
            data-tone={sel ? 'accent' : undefined}
            ref={selectedRef}
            aria-label="Widget selecionado"
          >
            {sel ? (
              <>
                <div className="ui-card-head">
                  <h3 className="ui-card-title">
                    {idx + 1}. {WIDGET_META[sel.widget].label}
                  </h3>
                  <span className="ui-badge num">
                    {sel.w}×{sel.h}
                  </span>
                </div>
                <div className="bn-fields">
                  <div className="bn-stepper-row">
                    <span className="bn-stepper-label">Ordem</span>
                    <div className="stepper">
                      <MoveButton
                        icon="back"
                        label="Mover para antes"
                        disabled={idx <= 0}
                        onClick={() => apply({ type: 'move', key: sel.key, by: -1 })}
                      />
                      <span className="num stepper-value">{idx + 1}</span>
                      <MoveButton
                        icon="chevron-right"
                        label="Mover para depois"
                        disabled={idx >= layout.items.length - 1}
                        onClick={() => apply({ type: 'move', key: sel.key, by: 1 })}
                      />
                    </div>
                  </div>
                  <Stepper
                    label="Largura"
                    value={sel.w}
                    lessDisabled={sel.w <= 1}
                    moreDisabled={sel.w >= layout.columns}
                    onLess={() => apply({ type: 'resize', key: sel.key, dw: -1, dh: 0 })}
                    onMore={() => apply({ type: 'resize', key: sel.key, dw: 1, dh: 0 })}
                  />
                  <Stepper
                    label="Altura"
                    value={sel.h}
                    lessDisabled={sel.h <= 1}
                    moreDisabled={sel.h >= WIDGET_H_MAX}
                    onLess={() => apply({ type: 'resize', key: sel.key, dw: 0, dh: -1 })}
                    onMore={() => apply({ type: 'resize', key: sel.key, dw: 0, dh: 1 })}
                  />
                  <button
                    type="button"
                    className="ui-btn"
                    data-variant="danger"
                    data-size="sm"
                    onClick={() => {
                      apply({ type: 'remove', key: sel.key });
                      setSelected(null);
                    }}
                  >
                    <Icon name="trash" size={16} />
                    Remover da grade
                  </button>
                </div>
              </>
            ) : (
              <p className="ui-help">
                Toque num widget da grade para mover, redimensionar ou remover.
              </p>
            )}
          </section>

          <div className="ui-card bn-card">
            <div className="ui-card-head">
              <h3 className="ui-card-title">Adicionar widget</h3>
              <span className="ui-badge num">
                {layout.items.length}/{LAYOUT_MAX_ITEMS}
              </span>
            </div>
            <div className="editor-add">
              {WIDGET_IDS.map((w) => (
                <button
                  key={w}
                  type="button"
                  className="ui-chip"
                  disabled={layout.items.length >= LAYOUT_MAX_ITEMS}
                  onClick={() => {
                    const next = apply({ type: 'add', widget: w });
                    setSelected(next.items.at(-1)?.key ?? null);
                  }}
                >
                  <Icon name="plus" size={14} />
                  {WIDGET_META[w].label}
                </button>
              ))}
            </div>
          </div>
        </section>
      </div>
    </Modal>
  );
}
