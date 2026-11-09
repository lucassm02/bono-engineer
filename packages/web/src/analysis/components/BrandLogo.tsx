/**
 * Maker logo: the real (single colour) logo when it exists, otherwise a monogram badge.
 * Logos are trademarks of their owners and are used only to identify the maker.
 */

import type { CSSProperties } from 'react';
import { logoFor } from '../../brands/brandLogos.ts';

export function BrandLogo({
  maker,
  size = 28,
  className = '',
}: {
  maker: { slug: string; name: string } | null | undefined;
  /** Width/height of the tile in px. */
  size?: number;
  className?: string;
}) {
  const logo = logoFor(maker);
  const style = { '--bl': `${size}px` } as CSSProperties;
  if (logo.kind === 'icon') {
    return (
      <span className={`brand-logo ${className}`} data-kind="icon" style={style} aria-hidden="true">
        <svg viewBox="0 0 24 24" focusable="false">
          <title>{logo.title}</title>
          <path d={logo.d} fill="currentColor" />
        </svg>
      </span>
    );
  }
  const mono = { ...style, '--h': logo.hue } as CSSProperties;
  return (
    <span
      className={`brand-logo ${className}`}
      data-kind="monogram"
      data-len={logo.initials.length}
      style={mono}
      aria-hidden="true"
    >
      {logo.initials}
    </span>
  );
}
