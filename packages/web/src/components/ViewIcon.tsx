import type { ViewId } from '@gt7/shared';
import type { ReactNode } from 'react';

/** Small schematic thumbnails of each view for the picker (viewBox 48×32). */
const GLYPHS: Record<ViewId, ReactNode> = {
  corrida: (
    <>
      <rect x="3" y="3" width="42" height="3" rx="1.5" className="ic-hot" />
      <rect x="3" y="10" width="20" height="11" rx="2" className="ic-fill" />
      <rect x="26" y="10" width="8" height="11" rx="2" className="ic-line" />
      <rect x="37" y="10" width="8" height="11" rx="2" className="ic-line" />
      <rect x="3" y="25" width="12" height="4" rx="1" className="ic-pb" />
      <rect x="18" y="25" width="12" height="4" rx="1" className="ic-ob" />
      <rect x="33" y="25" width="12" height="4" rx="1" className="ic-line" />
    </>
  ),
  deltaGrande: (
    <>
      <rect x="2" y="2" width="44" height="28" rx="4" className="ic-gain-bg" />
      <path d="M24 7 L35 24 H13 Z" className="ic-stroke" />
    </>
  ),
  pneus: (
    <>
      <rect x="17" y="4" width="14" height="24" rx="6" className="ic-line" />
      <rect x="10" y="7" width="5" height="8" rx="1.5" className="ic-fill" />
      <rect x="33" y="7" width="5" height="8" rx="1.5" className="ic-hot" />
      <rect x="10" y="18" width="5" height="8" rx="1.5" className="ic-cold" />
      <rect x="33" y="18" width="5" height="8" rx="1.5" className="ic-fill" />
    </>
  ),
  inputs: (
    <>
      <rect x="4" y="6" width="30" height="5" rx="1.5" className="ic-fill" />
      <rect x="4" y="14" width="16" height="5" rx="1.5" className="ic-hot" />
      <rect x="4" y="22" width="8" height="5" rx="1.5" className="ic-line" />
      <circle cx="40" cy="16" r="6" className="ic-stroke" />
    </>
  ),
  motor: (
    <>
      <path d="M8 26 A16 16 0 0 1 40 26" className="ic-stroke" />
      <path d="M32 13 A16 16 0 0 1 40 26" className="ic-hot-stroke" />
      <path d="M24 26 L33 15" className="ic-stroke" />
    </>
  ),
  mapa: (
    <path
      d="M8 22 C4 12 14 4 22 8 C28 11 30 6 38 7 C46 9 44 20 36 24 C28 28 14 30 8 22 Z"
      className="ic-stroke"
    />
  ),
  tempos: (
    <>
      <rect x="6" y="6" width="36" height="3" rx="1" className="ic-line" />
      <rect x="6" y="12" width="36" height="3" rx="1" className="ic-pb" />
      <rect x="6" y="18" width="36" height="3" rx="1" className="ic-line" />
      <rect x="6" y="24" width="36" height="3" rx="1" className="ic-ob" />
    </>
  ),
  combustivel: (
    <>
      <rect x="12" y="6" width="16" height="22" rx="2" className="ic-stroke" />
      <rect x="15" y="16" width="10" height="9" rx="1" className="ic-fill" />
      <path d="M28 10 L34 14 V24 A2 2 0 0 0 38 24 V12" className="ic-stroke" />
    </>
  ),
  forcasG: (
    <>
      <circle cx="24" cy="16" r="12" className="ic-stroke" />
      <path d="M12 16 H36 M24 4 V28" className="ic-thin" />
      <circle cx="30" cy="12" r="3" className="ic-hot" />
    </>
  ),
  treinoCurva: (
    <>
      <path d="M8 28 V18 C8 10 14 6 22 6 H40" className="ic-stroke" />
      <path d="M36 2 L42 6 L36 10" className="ic-stroke" />
      <circle cx="12" cy="12" r="2.5" className="ic-hot" />
    </>
  ),
  personalizada: (
    <>
      <rect x="5" y="4" width="18" height="11" rx="2" className="ic-fill" />
      <rect x="26" y="4" width="17" height="11" rx="2" className="ic-line" />
      <rect x="5" y="18" width="38" height="10" rx="2" className="ic-line" />
    </>
  ),
};

export function ViewIcon({ view }: { view: ViewId }) {
  return (
    <svg className="view-icon" viewBox="0 0 48 32" aria-hidden="true">
      {GLYPHS[view]}
    </svg>
  );
}
