import { DELTA_REFERENCE_KINDS, type ViewId } from '@gt7/shared';
import { useEffect, useRef } from 'react';
import {
  DELTA_REFERENCE_LABELS,
  IMPLEMENTED_VIEWS,
  VIEW_DESCRIPTIONS,
  VIEW_LABELS,
} from '../lib/labels.ts';
import { disabledViews } from '../lib/profile.ts';
import { send } from '../net/transport.ts';
import {
  closePicker,
  dispatchProfile,
  goToView,
  openLayoutEditor,
  setLocked,
} from '../state/actions.ts';
import { type KeepAwakeMode, useUi } from '../state/uiStore.ts';
import { ViewIcon } from './ViewIcon.tsx';

const KEEP_AWAKE_TEXT: Record<KeepAwakeMode, string> = {
  pending: 'Toque na tela para manter o celular acordado',
  wakeLock: 'Tela sempre ligada (Wake Lock)',
  video: 'Tela ligada pelo vídeo invisível; se apagar, desative o bloqueio automático',
  none: 'Não foi possível manter a tela ligada: desative o bloqueio automático',
};

function Switch({
  on,
  label,
  onChange,
  disabled,
}: {
  on: boolean;
  label: string;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="switch"
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

export function ViewPicker() {
  const open = useUi((s) => s.pickerOpen);
  const profile = useUi((s) => s.profile);
  const current = useUi((s) => s.currentView);
  const source = useUi((s) => s.source);
  const keepAwake = useUi((s) => s.keepAwake);
  const serverVersion = useUi((s) => s.serverVersion);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;
  const enabled = profile.views;
  const disabled = disabledViews(profile);

  const jump = (v: ViewId) => {
    goToView(v, 'picker');
    closePicker();
  };

  return (
    <div
      className="picker-backdrop"
      data-no-gesture
      onPointerDown={(e) => e.target === e.currentTarget && closePicker()}
    >
      <div className="picker" role="dialog" aria-modal="true" aria-label="Telas e ajustes">
        <header className="picker-head">
          <h2>Telas deste dispositivo</h2>
          <button
            type="button"
            className="btn picker-analysis"
            onClick={() => {
              closePicker();
              location.hash = '#/analise';
            }}
          >
            Abrir análise
          </button>
          <button type="button" className="btn btn-ghost" ref={closeRef} onClick={closePicker}>
            Fechar
          </button>
        </header>
        <div className="picker-body">
          <section className="picker-list" aria-label="Telas ligadas">
            <p className="picker-hint">
              Toque no nome para ir à tela. As setas mudam a ordem do carrossel; a estrela marca a
              tela inicial.
            </p>
            <ol className="view-rows">
              {enabled.map((v, i) => (
                <li key={v} className="view-row" data-current={v === current ? '1' : '0'}>
                  <button type="button" className="view-row-main" onClick={() => jump(v)}>
                    <ViewIcon view={v} />
                    <span className="view-row-text">
                      <span className="view-row-name">
                        {VIEW_LABELS[v]}
                        {!IMPLEMENTED_VIEWS.has(v) && <span className="tag">Em breve</span>}
                      </span>
                      <span className="view-row-desc">{VIEW_DESCRIPTIONS[v]}</span>
                    </span>
                  </button>
                  <div className="view-row-actions">
                    <button
                      type="button"
                      className="icon-btn star"
                      aria-pressed={profile.startView === v}
                      aria-label={`Usar ${VIEW_LABELS[v]} como tela inicial`}
                      onClick={() => dispatchProfile({ type: 'setStartView', view: v })}
                    >
                      ★
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Mover ${VIEW_LABELS[v]} para cima`}
                      disabled={i === 0}
                      onClick={() => dispatchProfile({ type: 'moveView', view: v, by: -1 })}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={`Mover ${VIEW_LABELS[v]} para baixo`}
                      disabled={i === enabled.length - 1}
                      onClick={() => dispatchProfile({ type: 'moveView', view: v, by: 1 })}
                    >
                      ↓
                    </button>
                    <Switch
                      on
                      label={`Desligar ${VIEW_LABELS[v]}`}
                      disabled={enabled.length <= 1}
                      onChange={() => dispatchProfile({ type: 'toggleView', view: v })}
                    />
                  </div>
                </li>
              ))}
            </ol>
            {disabled.length > 0 && (
              <>
                <h3 className="picker-sub">Desligadas</h3>
                <ul className="view-rows">
                  {disabled.map((v) => (
                    <li key={v} className="view-row view-row-off">
                      <div className="view-row-main">
                        <ViewIcon view={v} />
                        <span className="view-row-text">
                          <span className="view-row-name">
                            {VIEW_LABELS[v]}
                            {!IMPLEMENTED_VIEWS.has(v) && <span className="tag">Em breve</span>}
                          </span>
                          <span className="view-row-desc">{VIEW_DESCRIPTIONS[v]}</span>
                        </span>
                      </div>
                      <div className="view-row-actions">
                        <Switch
                          on={false}
                          label={`Ligar ${VIEW_LABELS[v]}`}
                          onChange={() => dispatchProfile({ type: 'toggleView', view: v })}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section className="picker-settings" aria-label="Ajustes">
            <div className="setting">
              <span className="setting-label">Delta contra</span>
              <fieldset className="segmented" aria-label="Referência do delta">
                {DELTA_REFERENCE_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={profile.deltaReference === k}
                    onClick={() => {
                      dispatchProfile({ type: 'setDeltaReference', kind: k });
                      send({ type: 'setDeltaReference', kind: k });
                    }}
                  >
                    {DELTA_REFERENCE_LABELS[k]}
                  </button>
                ))}
              </fieldset>
            </div>
            <div className="setting setting-row">
              <span className="setting-label">Cartão ao fechar a volta</span>
              <Switch
                on={profile.popupsEnabled}
                label="Cartão ao fechar a volta"
                onChange={(on) => dispatchProfile({ type: 'setPopups', enabled: on })}
              />
            </div>
            <div className="setting setting-row">
              <span className="setting-label">Travar gestos</span>
              <Switch
                on={profile.locked}
                label="Travar gestos"
                onChange={(on) => {
                  setLocked(on);
                  if (on) closePicker();
                }}
              />
            </div>
            <button type="button" className="btn btn-ghost" onClick={openLayoutEditor}>
              Editar a tela Personalizada
            </button>
            <dl className="picker-info">
              <dt>Dispositivo</dt>
              <dd>
                {profile.name} <span className="dim">({profile.deviceId})</span>
              </dd>
              <dt>Dados</dt>
              <dd>
                {source === 'mock'
                  ? 'Demonstração (sem console)'
                  : serverVersion
                    ? `Servidor ${serverVersion}`
                    : 'Servidor'}
              </dd>
              <dt>Tela</dt>
              <dd>{KEEP_AWAKE_TEXT[keepAwake]}</dd>
            </dl>
            <div className="picker-gestures">
              <p>
                Deslize para trocar de tela. Toque: nome da tela. Toque duplo: troca a referência do
                delta. Segure: abre este painel.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => dispatchProfile({ type: 'reset' })}
            >
              Restaurar telas padrão
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
