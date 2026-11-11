/**
 * "Ficha da pista": what the official catalogue knows about the layout (country, official length vs
 * the length the app measured, official corner count vs detected, elevation, longest straight,
 * layout, real or fictional) plus links to the official track list and DG EDGE. Only shown when the
 * track is recognised in the catalogue; the links are links, no content is copied.
 */

import { findTrackLayout, type Track, trackLinks } from '@gt7/shared';
import { t as uiText } from '../../lib/i18n.ts';
import { formatKm } from '../lib/history.ts';
import { Card } from './ui.tsx';

const nf = new Intl.NumberFormat('pt-BR');
const pct = (rel: number) =>
  `${rel > 0 ? '+' : rel < 0 ? '−' : ''}${(Math.abs(rel) * 100).toFixed(1).replace('.', ',')} %`;

export function TrackFicha({
  track,
}: {
  track: Pick<Track, 'name' | 'layout' | 'lengthM' | 'corners' | 'source'>;
}) {
  if (track.source === 'auto' && track.name.startsWith('Pista desconhecida')) return null;
  const entry = findTrackLayout(track.name, track.layout, track.lengthM);
  if (!entry) return null;

  const err = (track.lengthM - entry.lengthM) / entry.lengthM;
  const detected = track.corners.length;
  const cornersNote =
    detected === 0
      ? 'ainda sem curvas detectadas'
      : detected === entry.turns
        ? 'confere'
        : detected > entry.turns
          ? 'o app separou mais curvas'
          : 'o app agrupou curvas';
  const links = trackLinks(entry);

  return (
    <Card title={uiText('Ficha da pista')} className="a-ficha-card">
      <dl className="a-ficha">
        <div>
          <dt>{uiText('Pista')}</dt>
          <dd>{entry.officialName}</dd>
        </div>
        <div>
          <dt>Layout</dt>
          <dd>
            {entry.layout}
            {entry.reverse ? uiText(' (sentido inverso)') : ''}
            {entry.oval ? uiText(' · oval') : ''}
          </dd>
        </div>
        <div>
          <dt>{uiText('País')}</dt>
          <dd>{entry.countryName}</dd>
        </div>
        <div>
          <dt>{uiText('Tipo')}</dt>
          <dd>
            {entry.fictional ? uiText('Fictícia (criada pela Polyphony)') : uiText('Circuito real')}
          </dd>
        </div>
        <div>
          <dt>{uiText('Comprimento')}</dt>
          <dd className="num">
            {formatKm(entry.lengthM, 3)}
            {` ${uiText('oficial')}`}
            <span
              className="dim a-small"
              title={uiText(
                'O app mede a linha que o carro percorreu, em geral cerca de 1 % menor que a medida oficial (feita pelo eixo da pista).',
              )}
            >
              {' '}
              · {formatKm(track.lengthM, 3)}
              {` ${uiText('medido (')}`}
              {pct(err)})
            </span>
          </dd>
        </div>
        <div>
          <dt>{uiText('Curvas')}</dt>
          <dd className="num">
            {entry.turns}
            {` ${uiText('oficiais')}`}
            <span className="dim a-small">
              {' '}
              · {detected}
              {` ${uiText('detectadas (')}`}
              {cornersNote})
            </span>
          </dd>
        </div>
        <div>
          <dt>{uiText('Desnível')}</dt>
          <dd className="num">{nf.format(Math.round(entry.elevationM))} m</dd>
        </div>
        <div>
          <dt>{uiText('Maior reta')}</dt>
          <dd className="num">
            {entry.longestStraightM ? `${nf.format(entry.longestStraightM)} m` : '–'}
          </dd>
        </div>
      </dl>
      <p className="a-ficha-links a-small">
        {links.map((l, i) => (
          <span key={l.url}>
            {i > 0 && ' · '}
            <a href={l.url} target="_blank" rel="noreferrer noopener">
              {l.label}
            </a>
          </span>
        ))}
        <span className="dim">
          {' '}
          {uiText('— dados: gt7info, gt7-datalogger-track-data e gt-telemetry (licenças livres).')}
        </span>
      </p>
    </Card>
  );
}
