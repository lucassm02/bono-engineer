import {
  isTyreCompound,
  type LivePitTyreChange,
  TYRE_COMPOUNDS,
  type TyreCompound,
} from '@gt7/shared';
import { useEffect, useState } from 'react';
import { ApiError, request } from '../analysis/api.ts';
import { useSafeToPrompt } from '../hooks/useSafeToPrompt.ts';
import { t as uiText } from '../lib/i18n.ts';
import { compoundLabel } from '../lib/tyres.ts';
import { useLiveContext } from '../state/liveContext.ts';
import { useUi } from '../state/uiStore.ts';
import { Modal } from './ui/Modal.tsx';

export function PitTyreChangePrompt() {
  const change = useLiveContext((s) => s.pitTyreChange);
  const liveState = useUi((s) => s.liveState);
  if (!change || (liveState !== 'onTrack' && liveState !== 'paused')) return null;
  return <PitTyreChangeDialog key={change.visitId} change={change} />;
}

function PitTyreChangeDialog({ change }: { change: LivePitTyreChange }) {
  const safe = useSafeToPrompt();
  const trackPicker = useLiveContext((s) => s.picker);
  const otherDialog = useUi(
    (s) =>
      s.menuOpen ||
      s.pickerOpen ||
      s.layoutEditorOpen ||
      s.connectionPanelOpen ||
      s.onboarding === 'active',
  );
  const [opened, setOpened] = useState(false);
  const [open, setOpen] = useState(false);
  const [compound, setCompound] = useState(change.compound);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!safe || otherDialog || trackPicker || opened) return;
    setOpened(true);
    setOpen(true);
  }, [safe, otherDialog, trackPicker, opened]);

  async function answer(next: TyreCompound | null) {
    setSaving(true);
    setFailed(false);
    try {
      await request('PUT', '/api/session/pit-tyres', { visitId: change.visitId, compound: next });
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'pitTyresExpired') setSaved(true);
      else setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  if (saved) return null;
  return (
    <>
      <button
        type="button"
        className="lc-chip"
        data-no-gesture
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={otherDialog || !!trackPicker}
        onClick={() => {
          setOpened(true);
          setOpen(true);
        }}
      >
        {uiText('Confirmar pneus do box')}
      </button>
      <Modal
        open={open}
        onClose={() => {
          if (!saving) setOpen(false);
        }}
        title={uiText('Você trocou os pneus no box?')}
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="ui-btn"
              data-variant="secondary"
              disabled={saving}
              onClick={() => void answer(null)}
            >
              {uiText('Mantive os pneus')}
            </button>
            <button
              type="button"
              className="ui-btn"
              disabled={saving || !compound}
              onClick={() => {
                if (compound) void answer(compound);
              }}
            >
              {uiText('Confirmar troca')}
            </button>
          </>
        }
      >
        <label className="ui-field">
          <span className="ui-label">{uiText('Composto dos pneus novos')}</span>
          <select
            className="ui-select"
            disabled={saving}
            value={compound ?? ''}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setCompound(isTyreCompound(value) ? value : null);
            }}
          >
            <option value="">{uiText('Selecione o composto')}</option>
            {TYRE_COMPOUNDS.map((option) => (
              <option key={option} value={option}>
                {compoundLabel(option)}
              </option>
            ))}
          </select>
        </label>
        {failed && (
          <p className="ui-error" role="alert">
            {uiText('Falha ao salvar a decisão. Tente novamente.')}
          </p>
        )}
      </Modal>
    </>
  );
}
