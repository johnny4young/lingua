import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyzeI18nUsage } from '../../scripts/report-i18n-usage.mjs';

describe('advisory i18n usage report', () => {
  it('remains a non-blocking CI inventory rather than a deletion gate', () => {
    const workflow = readFileSync(resolve(__dirname, '../../.github/workflows/ci.yml'), 'utf8');
    expect(workflow).toMatch(
      /name: i18n usage inventory \(advisory\)\s+run: pnpm run report:i18n-usage\s+continue-on-error: true/u
    );
  });

  it('distinguishes literal references, dynamic key families and unproven candidates', () => {
    const report = analyzeI18nUsage({
      keys: [
        'exact.key',
        'mapped.key',
        'dynamic.alpha.label',
        'dynamic.beta.label',
        'concat.alpha',
        'translated.alpha.label',
        'items_one',
        'items_other',
        'comment.only',
        'unused.key',
      ],
      sources: [
        {
          path: 'fixture.tsx',
          source: `
          // t('comment.only') is not a reference.
          const labels = { title: 'mapped.key' };
          const exact = t('exact.key');
          const family = t(\`dynamic.\${variant}.label\`);
          const concatenated = t('concat.' + variant);
          const viaAlias = translate(\`translated.\${variant}.label\`);
          const plural = t('items', { count: 2 });
          const unknown = t(runtimeKey);
          export const View = () => <p>{exact}{family}{concatenated}{viaAlias}{plural}{unknown}{labels.title}</p>;
        `,
        },
      ],
    });

    expect(report.directlyReferenced).toEqual(['exact.key', 'mapped.key']);
    expect(report.dynamicFamilyCovered).toEqual([
      'concat.alpha',
      'dynamic.alpha.label',
      'dynamic.beta.label',
      'translated.alpha.label',
    ]);
    expect(report.pluralFamilyCovered).toEqual(['items_one', 'items_other']);
    expect(report.possiblyUnused).toEqual(['comment.only', 'unused.key']);
    expect(report.unresolvedCalls).toEqual([
      expect.objectContaining({ path: 'fixture.tsx', expression: 'runtimeKey' }),
    ]);
  });

  it('accepts a static template but does not mistake malformed source for no usage', () => {
    expect(
      analyzeI18nUsage({
        keys: ['static.key'],
        sources: [{ path: 'static.ts', source: 't(`static.key`);' }],
      }).possiblyUnused
    ).toEqual([]);

    expect(() =>
      analyzeI18nUsage({
        keys: ['static.key'],
        sources: [{ path: 'broken.ts', source: 't(`static.key`' }],
      })
    ).toThrow(/broken\.ts failed to parse/u);
  });
});
