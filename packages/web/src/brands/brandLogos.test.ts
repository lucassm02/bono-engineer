import { listMakers } from '@gt7/shared';
import { describe, expect, it } from 'vitest';
import { hasRealLogo, logoFor, logoSlugs, monogramHue, monogramInitials } from './brandLogos.ts';

describe('maker → logo', () => {
  const makers = listMakers();

  it('every maker of the catalogue has a logo or a monogram', () => {
    for (const m of makers) {
      const l = logoFor(m);
      if (l.kind === 'icon') {
        expect(l.d.length, m.name).toBeGreaterThan(20);
      } else {
        expect(l.initials.length, m.name).toBeGreaterThanOrEqual(1);
        expect(l.initials.length, m.name).toBeLessThanOrEqual(3);
        expect(l.hue).toBeGreaterThanOrEqual(0);
        expect(l.hue).toBeLessThan(360);
      }
    }
  });

  it('has no orphan logo (every logo belongs to a catalogue maker)', () => {
    const slugs = new Set(makers.map((m) => m.slug));
    for (const s of logoSlugs()) expect(slugs.has(s), s).toBe(true);
  });

  it('covers the main makers with real logos', () => {
    for (const slug of [
      'toyota',
      'nissan',
      'honda',
      'mazda',
      'subaru',
      'bmw',
      'porsche',
      'ferrari',
    ]) {
      expect(hasRealLogo(slug), slug).toBe(true);
    }
    const real = makers.filter((m) => hasRealLogo(m.slug)).length;
    expect(real).toBeGreaterThanOrEqual(30);
  });

  it('falls back to a monogram for makers without icon and for unknown cars', () => {
    expect(logoFor({ slug: 'daihatsu', name: 'Daihatsu' }).kind).toBe('monogram');
    expect(logoFor(null)).toMatchObject({ kind: 'monogram', initials: '?' });
  });
});

describe('monogram', () => {
  it('builds sensible initials', () => {
    expect(monogramInitials('Alfa Romeo')).toBe('AR');
    expect(monogramInitials('Mercedes-Benz')).toBe('MB');
    expect(monogramInitials('Daihatsu')).toBe('DA');
    expect(monogramInitials('TVR')).toBe('TVR');
    expect(monogramInitials('De Tomaso')).toBe('DT');
    expect(monogramInitials('Super Formula (Dallara)')).toBe('SF');
    expect(monogramInitials("Eckert's Rod & Custom")).toBe('ER');
    expect(monogramInitials('')).toBe('?');
  });

  it('hue is stable and spreads between makers', () => {
    expect(monogramHue('Daihatsu')).toBe(monogramHue('Daihatsu'));
    const hues = new Set(listMakers().map((m) => Math.floor(monogramHue(m.name) / 30)));
    expect(hues.size).toBeGreaterThan(6);
  });
});
