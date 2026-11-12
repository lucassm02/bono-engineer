/**
 * Corner drill of the live panel (spec 18): the drill in the latest frame, the corners of the track
 * to choose from, and the summary shown after stopping. Frames at 30 Hz only touch the store when
 * something the screen shows changed.
 */

import type { DrillSummary, LiveDrill, LiveFrame, MapCorner } from '@gt7/shared';
import { create } from 'zustand';
import { ApiError, api } from '../analysis/api.ts';
import { t as uiText } from '../lib/i18n.ts';
import { addNotice } from './uiStore.ts';

export interface DrillState {
  drill: LiveDrill | null;
  /** The summary of the drill that was just stopped, until dismissed. */
  summary: { cornerId: string; data: DrillSummary; targetMs: number | null } | null;
  /** Corners of the track in the frame (loaded when the picker opens). */
  corners: { trackId: string; list: MapCorner[] } | null;
  busy: boolean;
  error: string | null;
}

export const useDrill = create<DrillState>()(() => ({
  drill: null,
  summary: null,
  corners: null,
  busy: false,
  error: null,
}));

/** What the screen shows of a drill: changes only when a pass ends or the phase/distance moves. */
export function drillKey(d: LiveDrill | null): string {
  if (!d) return '-';
  return `${d.cornerId}|${d.startedAt}|${d.count}|${d.phase}|${d.distanceToEntryM === null ? '' : Math.round(d.distanceToEntryM / 20)}`;
}

let lastKey = '-';

/** Called with every frame (cheap): stores the drill when its visible state changed. */
export function feedDrill(f: LiveFrame): void {
  const key = drillKey(f.drill ?? null);
  if (key === lastKey) return;
  lastKey = key;
  useDrill.setState({ drill: f.drill ?? null });
}

export function dismissDrillSummary(): void {
  useDrill.setState({ summary: null });
}

export async function loadDrillCorners(trackId: string): Promise<void> {
  if (useDrill.getState().corners?.trackId === trackId) return;
  try {
    const t = await api.trackAnalysis(trackId);
    useDrill.setState({ corners: { trackId, list: t.corners } });
  } catch {
    useDrill.setState({ corners: { trackId, list: [] } });
  }
}

export async function startDrill(cornerId: string, targetMs: number | null): Promise<void> {
  useDrill.setState({ busy: true, error: null, summary: null });
  try {
    const res = await api.startDrill(cornerId, targetMs);
    lastKey = '';
    useDrill.setState({ drill: res.drill });
  } catch (e) {
    const message =
      e instanceof ApiError ? uiText(e.message) : uiText('Não foi possível iniciar o treino.');
    useDrill.setState({ error: message });
    addNotice('error', message);
  } finally {
    useDrill.setState({ busy: false });
  }
}

export async function stopDrill(): Promise<void> {
  useDrill.setState({ busy: true, error: null });
  try {
    const res = await api.stopDrill();
    lastKey = '';
    useDrill.setState({
      drill: null,
      summary:
        res.drill && res.summary
          ? { cornerId: res.drill.cornerId, data: res.summary, targetMs: res.drill.targetMs }
          : null,
    });
  } catch (e) {
    const message =
      e instanceof ApiError ? uiText(e.message) : uiText('Não foi possível parar o treino.');
    useDrill.setState({ error: message });
  } finally {
    useDrill.setState({ busy: false });
  }
}
