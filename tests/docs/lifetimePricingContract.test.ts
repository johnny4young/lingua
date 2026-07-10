import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const WEBSITE_SOURCES = [
  'website/src/i18n/en.ts',
  'website/src/i18n/es.ts',
  'website/src/pages/licensing.astro',
  'website/src/pages/es/licensing.astro',
];

function websiteSource(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('Pro Lifetime public contract', () => {
  it('states perpetual Pro access and a 12-month update window in English and Spanish', () => {
    const english = websiteSource('website/src/i18n/en.ts');
    const spanish = websiteSource('website/src/i18n/es.ts');
    const licensingEnglish = websiteSource('website/src/pages/licensing.astro');
    const licensingSpanish = websiteSource('website/src/pages/es/licensing.astro');

    expect(english).toContain('12 months of updates');
    expect(spanish).toContain('12 meses de actualizaciones');
    expect(licensingEnglish).toMatch(/your Pro\s+entitlement never expires/u);
    expect(licensingSpanish).toMatch(/tus funciones Pro nunca caducan/u);
  });

  it('does not revive the unsupported updates-forever promise on public website surfaces', () => {
    const publicCopy = WEBSITE_SOURCES.map(websiteSource).join('\n');

    for (const unsupportedClaim of [
      'every future update included',
      'every future stable release',
      'stay supported forever',
      'todas las actualizaciones futuras incluidas',
      'cada actualización futura incluida',
      'cada release estable futura',
    ]) {
      expect(publicCopy).not.toContain(unsupportedClaim);
    }
  });
});
