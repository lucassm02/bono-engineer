import type { ViewId } from '@gt7/shared';
import type { ComponentType } from 'react';
import { t as uiText } from '../lib/i18n.ts';
import { VIEW_DESCRIPTIONS, VIEW_LABELS } from '../lib/labels.ts';
import { BigDeltaView } from './BigDeltaView.tsx';
import { CornerDrillView } from './CornerDrillView.tsx';
import { CustomView } from './CustomView.tsx';
import { EngineView } from './EngineView.tsx';
import { FuelView } from './FuelView.tsx';
import { GForcesView } from './GForcesView.tsx';
import { InputsView } from './InputsView.tsx';
import { MapView } from './MapView.tsx';
import { RaceView } from './RaceView.tsx';
import { TimesView } from './TimesView.tsx';
import { TyresView } from './TyresView.tsx';

/** Placeholder for views planned for a later wave. */
function EmBreveView({ view }: { view: ViewId }) {
  return (
    <div className="view em-breve">
      <div className="em-breve-title">{VIEW_LABELS[view]}</div>
      <div className="em-breve-tag">{uiText('Em breve')}</div>
      <p>{VIEW_DESCRIPTIONS[view]}</p>
    </div>
  );
}

const VIEW_COMPONENTS: Partial<Record<ViewId, ComponentType>> = {
  race: RaceView,
  bigDelta: BigDeltaView,
  tyres: TyresView,
  inputs: InputsView,
  engine: EngineView,
  map: MapView,
  times: TimesView,
  fuel: FuelView,
  gForces: GForcesView,
  cornerDrill: CornerDrillView,
  custom: CustomView,
};

/** Renders the component of a view (or the "Em breve" placeholder). */
export function ViewContent({ view }: { view: ViewId }) {
  const Comp = VIEW_COMPONENTS[view];
  return Comp ? <Comp /> : <EmBreveView view={view} />;
}
