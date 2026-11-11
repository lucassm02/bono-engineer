/**
 * Seletor de telas do painel ao vivo (abre com Enter ou segurando a tela): ordem, liga/desliga,
 * tela inicial, referência do delta e ajustes deste aparelho. Foco, Esc e fundo vêm do Modal.
 */

import { DELTA_REFERENCE_KINDS, type ViewId } from '@gt7/shared';
import { t as uiText } from '../lib/i18n.ts';
import {
  DELTA_REFERENCE_LABELS,
  IMPLEMENTED_VIEWS,
  VIEW_DESCRIPTIONS,
  VIEW_LABELS,
} from '../lib/labels.ts';
import { disabledViews } from '../lib/profile.ts';
import { routes } from '../lib/route.ts';
import { send } from '../net/transport.ts';
import {
  closePicker,
  dispatchProfile,
  goToView,
  openLayoutEditor,
  setLocked,
} from '../state/actions.ts';
import { type KeepAwakeMode, useUi } from '../state/uiStore.ts';
import { SwitchButton, ToggleRow } from './ToggleRow.tsx';
import { Icon } from './ui/Icon.tsx';
import { Modal } from './ui/Modal.tsx';
import { ViewIcon } from './ViewIcon.tsx';

const KEEP_AWAKE_TEXT: Record<KeepAwakeMode, string> = {
  get pending() {
    return uiText('Toque na tela para impedir que ela apague');
  },
  get wakeLock() {
    return uiText('Tela sempre ligada (Wake Lock)');
  },
  get video() {
    return uiText('Tela ligada pelo vídeo invisível; se apagar, desative o bloqueio automático');
  },
  get none() {
    return uiText('Não foi possível manter a tela ligada: desative o bloqueio automático');
  },
};

function ViewText({ view }: { view: ViewId }) {
  return (
    <>
      <ViewIcon view={view} />
      <span className="bn-view-text">
        <span className="bn-view-name">
          {VIEW_LABELS[view]}
          {!IMPLEMENTED_VIEWS.has(view) && <span className="ui-badge">{uiText('Em breve')}</span>}
        </span>
        <span className="bn-view-desc">{VIEW_DESCRIPTIONS[view]}</span>
      </span>
    </>
  );
}

export function ViewPicker() {
  const open = useUi((s) => s.pickerOpen);
  const profile = useUi((s) => s.profile);
  const current = useUi((s) => s.currentView);
  const source = useUi((s) => s.source);
  const keepAwake = useUi((s) => s.keepAwake);
  const serverVersion = useUi((s) => s.serverVersion);

  const enabled = profile.views;
  const disabled = disabledViews(profile);

  const jump = (v: ViewId) => {
    goToView(v, 'picker');
    closePicker();
  };

  return (
    <Modal
      open={open}
      onClose={closePicker}
      size="xl"
      className="bn-picker-modal"
      title={uiText('Telas deste dispositivo')}
      subtitle="Toque no nome para ir à tela. As setas mudam a ordem do carrossel; a estrela marca a tela inicial."
      footer={
        <>
          <button
            type="button"
            className="ui-btn bn-foot-left"
            data-variant="ghost"
            onClick={() => dispatchProfile({ type: 'reset' })}
          >
            {uiText('Restaurar telas padrão')}
          </button>
          <a className="ui-btn" data-variant="secondary" href={routes.home()} onClick={closePicker}>
            {uiText('Histórico e ajustes')}
          </a>
          <button type="button" className="ui-btn" onClick={closePicker}>
            {uiText('Concluir')}
          </button>
        </>
      }
    >
      <div className="bn-picker">
        <section className="bn-section" aria-labelledby="bn-views-on">
          <h3 id="bn-views-on" className="ui-eyebrow">
            {uiText('Telas ligadas')}
          </h3>
          <ol className="bn-view-rows">
            {enabled.map((v, i) => (
              <li key={v} className="bn-view-row" data-current={v === current ? '1' : '0'}>
                <button type="button" className="bn-view-main" onClick={() => jump(v)}>
                  <ViewText view={v} />
                </button>
                <div className="bn-view-actions">
                  <button
                    type="button"
                    className="ui-icon-btn"
                    aria-pressed={profile.startView === v}
                    aria-label={uiText('Usar {0} como tela inicial', VIEW_LABELS[v])}
                    title={uiText('Tela inicial')}
                    onClick={() => dispatchProfile({ type: 'setStartView', view: v })}
                  >
                    <Icon name="star" />
                  </button>
                  <button
                    type="button"
                    className="ui-icon-btn"
                    aria-label={uiText('Mover {0} para cima', VIEW_LABELS[v])}
                    disabled={i === 0}
                    onClick={() => dispatchProfile({ type: 'moveView', view: v, by: -1 })}
                  >
                    <Icon name="arrow-up" />
                  </button>
                  <button
                    type="button"
                    className="ui-icon-btn"
                    aria-label={uiText('Mover {0} para baixo', VIEW_LABELS[v])}
                    disabled={i === enabled.length - 1}
                    onClick={() => dispatchProfile({ type: 'moveView', view: v, by: 1 })}
                  >
                    <Icon name="arrow-down" />
                  </button>
                  <SwitchButton
                    on
                    label={uiText('Desligar {0}', VIEW_LABELS[v])}
                    disabled={enabled.length <= 1}
                    onChange={() => dispatchProfile({ type: 'toggleView', view: v })}
                  />
                </div>
              </li>
            ))}
          </ol>
          {disabled.length > 0 && (
            <>
              <h3 className="ui-eyebrow bn-eyebrow-muted">{uiText('Desligadas')}</h3>
              <ul className="bn-view-rows">
                {disabled.map((v) => (
                  <li key={v} className="bn-view-row" data-off="1">
                    <div className="bn-view-main">
                      <ViewText view={v} />
                    </div>
                    <div className="bn-view-actions">
                      <SwitchButton
                        on={false}
                        label={uiText('Ligar {0}', VIEW_LABELS[v])}
                        onChange={() => dispatchProfile({ type: 'toggleView', view: v })}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="bn-section" aria-label={uiText('Ajustes')}>
          <h3 className="ui-eyebrow">{uiText('Ajustes')}</h3>
          <div className="ui-card bn-card">
            <div className="ui-field">
              <span className="ui-label" id="bn-delta-label">
                {uiText('Delta contra')}
              </span>
              <fieldset className="ui-segmented bn-segmented" aria-labelledby="bn-delta-label">
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
            <hr className="ui-divider" />
            <ToggleRow
              title={uiText('Cartão ao fechar a volta')}
              description={uiText('Mostra o tempo e os setores por alguns segundos.')}
              checked={profile.popupsEnabled}
              onChange={(enabledPopups) =>
                dispatchProfile({ type: 'setPopups', enabled: enabledPopups })
              }
            />
            <hr className="ui-divider" />
            <ToggleRow
              title={uiText('Travar gestos')}
              description={uiText(
                'Ignora deslizar, tocar e segurar. Segure o cadeado para destravar.',
              )}
              checked={profile.locked}
              onChange={(on) => {
                setLocked(on);
                if (on) closePicker();
              }}
            />
          </div>

          <button type="button" className="ui-list-item bn-edit-custom" onClick={openLayoutEditor}>
            <Icon name="layout" size={22} />
            <span className="ui-list-text">
              <span className="ui-list-title">{uiText('Editar a tela Personalizada')}</span>
              <span className="ui-list-desc">{uiText('Montar a sua grade de widgets')}</span>
            </span>
            <Icon name="chevron-right" size={18} className="bn-chev" />
          </button>

          <dl className="bn-facts">
            <div>
              <dt>{uiText('Dispositivo')}</dt>
              <dd>
                {profile.name} <span className="dim">({profile.deviceId})</span>
              </dd>
            </div>
            <div>
              <dt>{uiText('Dados')}</dt>
              <dd>
                {source === 'mock'
                  ? uiText('Demonstração (sem console)')
                  : serverVersion
                    ? uiText('Servidor {0}', serverVersion)
                    : uiText('Servidor')}
              </dd>
            </div>
            <div>
              <dt>{uiText('Tela')}</dt>
              <dd>{KEEP_AWAKE_TEXT[keepAwake]}</dd>
            </div>
          </dl>

          <div className="bn-note" data-tone="info">
            <strong>{uiText('Gestos do painel')}</strong>
            <p>
              {uiText(
                'Deslize para trocar de tela. Toque: nome da tela. Toque duplo: troca a referência do delta. Segure: abre este painel.',
              )}
            </p>
          </div>
        </section>
      </div>
    </Modal>
  );
}
