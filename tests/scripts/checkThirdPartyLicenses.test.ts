import { describe, expect, it } from 'vitest';

import {
  renderMarkdownReport,
  reviewLicenseEntry,
} from '../../scripts/check-third-party-licenses.mjs';

const baseEntry = {
  name: 'fixture',
  version: '1.0.0',
  path: 'node_modules/fixture',
  missingPackageJson: false,
};

describe('check-third-party-licenses', () => {
  it('accepts reviewed permissive runtime licenses', () => {
    expect(reviewLicenseEntry({ ...baseEntry, license: 'MIT' })).toEqual({ ok: true });
    expect(reviewLicenseEntry({ ...baseEntry, license: '(MPL-2.0 OR Apache-2.0)' })).toEqual({
      ok: true,
    });
    expect(reviewLicenseEntry({ ...baseEntry, license: 'MPL-2.0' })).toEqual({ ok: true });
    expect(reviewLicenseEntry({ ...baseEntry, license: 'BlueOak-1.0.0' })).toEqual({
      ok: true,
    });
  });

  it('rejects missing, unreviewed, and blocked license expressions', () => {
    expect(reviewLicenseEntry({ ...baseEntry, license: 'UNKNOWN' })).toMatchObject({
      ok: false,
      reason: 'missing license metadata',
    });
    expect(reviewLicenseEntry({ ...baseEntry, license: 'LicenseRef-Reviewed-Later' })).toMatchObject({
      ok: false,
      reason: 'unreviewed license expression: LicenseRef-Reviewed-Later',
    });
    expect(reviewLicenseEntry({ ...baseEntry, license: 'GPL-3.0-only' })).toMatchObject({
      ok: false,
      reason: 'blocked license expression: GPL-3.0-only',
    });
  });

  it('renders a deterministic Markdown report with policy failures', () => {
    const report = renderMarkdownReport([
      { ...baseEntry, name: 'ok-fixture', license: 'MIT' },
      { ...baseEntry, name: 'bad-fixture', license: 'LicenseRef-Commercial' },
    ]);

    expect(report).toContain('Packages reviewed: 2.');
    expect(report).toContain('Policy result: fail.');
    expect(report).toContain('`bad-fixture@1.0.0`: blocked license expression');
  });
});
