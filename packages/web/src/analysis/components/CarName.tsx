/** A car as the user knows it: small maker logo + the catalogue name ("Carro #1234" if unknown). */

import { getCar, makerOfCar } from '@gt7/shared';
import { t as uiText } from '../../lib/i18n.ts';
import { BrandLogo } from './BrandLogo.tsx';

export function CarName({
  carCode,
  name,
  logo = true,
  logoSize = 20,
  className = '',
}: {
  carCode: number | null | undefined;
  /** Name to use when the catalogue does not know the car (e.g. from reference metadata). */
  name?: string | null;
  logo?: boolean;
  logoSize?: number;
  className?: string;
}) {
  const car = getCar(carCode);
  const maker = makerOfCar(carCode);
  const text =
    car?.name ??
    name ??
    (carCode === null || carCode === undefined ? '—' : uiText('Carro #{0}', carCode));
  return (
    <span className={`carname ${className}`} title={maker ? `${maker.name} · ${text}` : text}>
      {logo && maker && <BrandLogo maker={maker} size={logoSize} className="carname-logo" />}
      <span className="carname-text">{text}</span>
    </span>
  );
}
