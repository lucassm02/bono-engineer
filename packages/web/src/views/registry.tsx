import type { ViewId } from '@gt7/shared';
import type { ComponentType } from 'react';
import { VIEW_DESCRIPTIONS, VIEW_LABELS } from '../lib/labels.ts';
import { CorridaView } from './CorridaView.tsx';
import { DeltaGrandeView } from './DeltaGrandeView.tsx';
import { InputsView } from './InputsView.tsx';
import { MotorView } from './MotorView.tsx';
import { PneusView } from './PneusView.tsx';

/** Placeholder for views planned for a later wave. */
function EmBreveView({ view }: { view: ViewId }) {
  return (
    <div className="view em-breve">
      <div className="em-breve-title">{VIEW_LABELS[view]}</div>
      <div className="em-breve-tag">Em breve</div>
      <p>{VIEW_DESCRIPTIONS[view]}</p>
    </div>
  );
}

const VIEW_COMPONENTS: Partial<Record<ViewId, ComponentType>> = {
  corrida: CorridaView,
  deltaGrande: DeltaGrandeView,
  pneus: PneusView,
  inputs: InputsView,
  motor: MotorView,
};

/** Renders the component of a view (or the "Em breve" placeholder). */
export function ViewContent({ view }: { view: ViewId }) {
  const Comp = VIEW_COMPONENTS[view];
  return Comp ? <Comp /> : <EmBreveView view={view} />;
}
