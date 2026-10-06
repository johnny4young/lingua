import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { MAX_EXCEPTION_DAYS, evaluateWebsiteAudit } from '../../scripts/lib/websiteAudit.mjs';

const GHSA = 'GHSA-ch52-4w7c-c8xp';
const exception = {
  id: GHSA,
  package: 'http-cache-semantics',
  reviewed: '2026-10-02',
  expires: '2026-12-01',
  reason: 'Build-time only; no shared HTTP cache serves visitors.',
};
const now = new Date('2026-10-02T12:00:00Z');

/** Shape of `npm audit --json`: a direct dependency inheriting a transitive advisory. */
function auditPayload(extra: Record<string, unknown> = {}) {
  return {
    auditReportVersion: 2,
    vulnerabilities: {
      astro: { name: 'astro', severity: 'high', isDirect: true, via: ['http-cache-semantics'] },
      'http-cache-semantics': {
        name: 'http-cache-semantics',
        severity: 'high',
        isDirect: false,
        via: [
          {
            source: 1240991,
            name: 'http-cache-semantics',
            severity: 'high',
            url: `https://github.com/advisories/${GHSA}`,
          },
        ],
      },
      ...extra,
    },
  };
}

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('evaluateWebsiteAudit', () => {
  it('excuses a reviewed advisory and the packages that only inherit it', () => {
    const result = evaluateWebsiteAudit(auditPayload(), { exceptions: [exception], now });
    expect(result.ok).toBe(true);
    expect(result.excused.map(item => item.name).sort()).toEqual(['astro', 'http-cache-semantics']);
  });

  it('fails without the exception', () => {
    const result = evaluateWebsiteAudit(auditPayload(), { now });
    expect(result.ok).toBe(false);
    expect(result.offending.map(item => item.name).sort()).toEqual([
      'astro',
      'http-cache-semantics',
    ]);
  });

  it('stops excusing once the exception expires', () => {
    const result = evaluateWebsiteAudit(auditPayload(), {
      exceptions: [exception],
      now: new Date('2026-12-02T00:00:00Z'),
    });
    expect(result.ok).toBe(false);
    expect(result.expired).toEqual([GHSA]);
  });

  it('only excuses the advisory on the package it was reviewed for', () => {
    const result = evaluateWebsiteAudit(auditPayload(), {
      exceptions: [{ ...exception, package: 'other-package' }],
      now,
    });
    expect(result.ok).toBe(false);
  });

  it('still fails a package that also carries an unreviewed advisory', () => {
    const payload = auditPayload({
      astro: {
        name: 'astro',
        severity: 'critical',
        via: [
          'http-cache-semantics',
          {
            name: 'astro',
            severity: 'critical',
            url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
          },
        ],
      },
    });
    const result = evaluateWebsiteAudit(payload, { exceptions: [exception], now });
    expect(result.ok).toBe(false);
    expect(result.offending).toEqual([
      expect.objectContaining({
        name: 'astro',
        advisories: ['https://github.com/advisories/GHSA-aaaa-bbbb-cccc'],
      }),
    ]);
  });

  it('ignores advisories below the threshold', () => {
    const payload = {
      vulnerabilities: {
        lodash: {
          name: 'lodash',
          severity: 'moderate',
          via: [{ name: 'lodash', severity: 'moderate', url: 'x' }],
        },
      },
    };
    expect(evaluateWebsiteAudit(payload, { now }).ok).toBe(true);
  });

  it.each([null, [], 'broken', { severity: 'high' }, { severity: 'toString', via: [] }])(
    'fails closed on a malformed vulnerability entry: %j',
    entry => {
      expect(
        evaluateWebsiteAudit(auditPayload({ broken: entry }), {
          exceptions: [exception],
          now,
        })
      ).toMatchObject({ ok: false, error: expect.any(String) });
    }
  );

  it.each([null, 42, {}, { name: 'astro', severity: 'unknown', url: 'x' }])(
    'does not discard a malformed advisory beside an excused advisory: %j',
    via => {
      const payload = auditPayload({
        astro: { severity: 'high', via: ['http-cache-semantics', via] },
      });
      expect(evaluateWebsiteAudit(payload, { exceptions: [exception], now })).toMatchObject({
        ok: false,
        error: expect.any(String),
      });
    }
  );

  it.each(['missing-package', 'toString', '__proto__'])(
    'rejects a missing or inherited package reference: %s',
    reference => {
      const payload = auditPayload({
        astro: { severity: 'high', via: ['http-cache-semantics', reference] },
      });
      expect(evaluateWebsiteAudit(payload, { exceptions: [exception], now })).toMatchObject({
        ok: false,
        error: expect.stringContaining('missing'),
      });
    }
  );

  it('does not accept an npm error carrying an empty vulnerability map', () => {
    expect(
      evaluateWebsiteAudit({ error: { code: 'EAUDITNOLOCK' }, vulnerabilities: {} }, { now })
    ).toMatchObject({ ok: false });
  });

  it('requires the canonical GitHub advisory URL before applying an exception', () => {
    const payload = auditPayload();
    payload.vulnerabilities['http-cache-semantics'].via[0].url = `https://example.com/${GHSA}`;
    expect(evaluateWebsiteAudit(payload, { exceptions: [exception], now }).ok).toBe(false);
  });

  it.each(['unknown', 'toString', '__proto__'])(
    'rejects an unknown or inherited threshold: %s',
    level => {
      expect(evaluateWebsiteAudit(auditPayload(), { level, now })).toMatchObject({ ok: false });
    }
  );

  it.each(['2026-02-30', '2026-13-01', 'invalid', '2026-2-1'])(
    'rejects an invalid expiry calendar date: %s',
    expires => {
      expect(
        evaluateWebsiteAudit(auditPayload(), { exceptions: [{ ...exception, expires }], now })
      ).toMatchObject({ ok: false, error: expect.stringContaining('exceptions') });
    }
  );

  it('rejects an exception that could stay active forever', () => {
    const critical = {
      vulnerabilities: {
        x: {
          severity: 'critical',
          via: [
            {
              name: 'x',
              severity: 'critical',
              url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc',
            },
          ],
        },
      },
    };
    const forever = { ...exception, id: 'GHSA-aaaa-bbbb-cccc', package: 'x', expires: '9999-12-31' };
    expect(evaluateWebsiteAudit(critical, { exceptions: [forever], now })).toMatchObject({
      ok: false,
      error: expect.stringContaining(`more than ${MAX_EXCEPTION_DAYS} days`),
    });
  });

  it('accepts a review window of exactly the maximum and rejects one day more', () => {
    // 2026-10-02 through 2026-12-30 inclusive is 90 calendar days.
    const atLimit = { ...exception, expires: '2026-12-30' };
    expect(evaluateWebsiteAudit(auditPayload(), { exceptions: [atLimit], now }).ok).toBe(true);
    const overLimit = { ...exception, expires: '2026-12-31' };
    expect(evaluateWebsiteAudit(auditPayload(), { exceptions: [overLimit], now })).toMatchObject({
      ok: false,
      error: expect.stringContaining('days after its review'),
    });
  });

  it.each([
    ['missing reviewed', { reviewed: undefined }, 'reviewed'],
    ['invalid reviewed', { reviewed: '2026-02-30' }, 'reviewed'],
    ['future reviewed', { reviewed: '2026-10-03' }, 'in the future'],
    ['expiry before review', { reviewed: '2026-10-02', expires: '2026-10-01' }, 'before it was reviewed'],
    ['missing reason', { reason: undefined }, 'reason'],
    ['blank reason', { reason: '   ' }, 'reason'],
    ['missing package', { package: '' }, 'package'],
  ])('rejects an exception with %s', (_label, patch, message) => {
    const item = { ...exception, ...patch };
    expect(evaluateWebsiteAudit(auditPayload(), { exceptions: [item], now })).toMatchObject({
      ok: false,
      error: expect.stringContaining(message),
    });
  });

  it('accepts a review dated today', () => {
    const today = { ...exception, reviewed: '2026-10-02' };
    expect(
      evaluateWebsiteAudit(auditPayload(), {
        exceptions: [today],
        now: new Date('2026-10-02T00:00:00Z'),
      }).ok
    ).toBe(true);
  });

  it('reports active exceptions that no longer match an advisory without failing', () => {
    expect(evaluateWebsiteAudit({ vulnerabilities: {} }, { exceptions: [exception], now })).toMatchObject({
      ok: true,
      unused: [GHSA],
    });
    expect(
      evaluateWebsiteAudit(auditPayload(), { exceptions: [exception], now }).unused
    ).toEqual([]);
  });

  it('accepts an exception through the final millisecond of its expiry day', () => {
    expect(
      evaluateWebsiteAudit(auditPayload(), {
        exceptions: [exception],
        now: new Date('2026-12-01T23:59:59.999Z'),
      }).ok
    ).toBe(true);
  });

  it('requires expired exceptions to be removed even after an advisory disappears', () => {
    expect(
      evaluateWebsiteAudit(
        { vulnerabilities: {} },
        {
          exceptions: [exception],
          now: new Date('2026-12-02T00:00:00Z'),
        }
      )
    ).toMatchObject({ ok: false, expired: [GHSA] });
  });

  it('rejects an invalid audit clock', () => {
    expect(
      evaluateWebsiteAudit({ vulnerabilities: {} }, { now: new Date('invalid') })
    ).toMatchObject({ ok: false, error: expect.stringContaining('date') });
  });

  it('handles shared and cyclic references without dropping a reachable advisory', () => {
    const payload = auditPayload({
      astro: { severity: 'high', via: ['cycle', 'http-cache-semantics'] },
      cycle: { severity: 'high', via: ['astro'] },
    });
    expect(evaluateWebsiteAudit(payload, { exceptions: [exception], now }).ok).toBe(true);
    expect(evaluateWebsiteAudit(payload, { now }).ok).toBe(false);
  });

  it('fails a cycle with no readable root advisory', () => {
    const payload = { vulnerabilities: { a: { severity: 'high', via: ['a'] } } };
    expect(evaluateWebsiteAudit(payload, { exceptions: [exception], now }).ok).toBe(false);
  });

  it('fails closed on a malformed payload', () => {
    expect(evaluateWebsiteAudit({ error: 'ENOLOCK' }, { now })).toMatchObject({ ok: false });
  });
});

describe('assert-website-audit CLI', () => {
  async function run(payload: unknown, nowIso: string, configuration?: unknown) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-website-audit-'));
    roots.push(root);
    const fixture = path.join(root, 'audit.json');
    await writeFile(fixture, JSON.stringify(payload), 'utf8');
    const extraArgs: string[] = [];
    if (configuration !== undefined) {
      const configPath = path.join(root, 'exceptions.json');
      await writeFile(configPath, JSON.stringify(configuration), 'utf8');
      extraArgs.push('--exceptions', configPath);
    }
    return spawnSync(
      process.execPath,
      ['scripts/assert-website-audit.mjs', '--fixture', fixture, '--now', nowIso, ...extraArgs],
      { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }
    );
  }

  it.each([{}, null, { schemaVersion: 2, exceptions: [] }, { schemaVersion: 1, exceptions: null }])(
    'rejects malformed exception configuration: %j',
    async configuration => {
      const result = await run({ vulnerabilities: {} }, '2026-10-02T12:00:00Z', configuration);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('could not read the exception configuration');
    }
  );

  it.skipIf(process.platform === 'win32').each(['exit 2', 'kill -TERM $$'])(
    'rejects abnormal npm completion even with valid JSON on stdout: %s',
    async termination => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-website-audit-process-'));
      roots.push(root);
      const npm = path.join(root, 'npm');
      await writeFile(npm, `#!/bin/sh\nprintf '%s\\n' '{"vulnerabilities":{}}'\n${termination}\n`);
      await chmod(npm, 0o755);
      const result = spawnSync(process.execPath, ['scripts/assert-website-audit.mjs'], {
        cwd: path.resolve(__dirname, '../..'),
        encoding: 'utf8',
        env: { ...process.env, PATH: `${root}${path.delimiter}${process.env.PATH ?? ''}` },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('npm audit did not complete (status');
      expect(result.stdout).not.toContain('website-audit: ok');
    }
  );

  it.skipIf(process.platform === 'win32')('fails when npm cannot be started', async () => {
    const result = spawnSync(process.execPath, ['scripts/assert-website-audit.mjs'], {
      cwd: path.resolve(__dirname, '../..'),
      encoding: 'utf8',
      env: { ...process.env, PATH: '' },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('could not read the npm audit payload');
    expect(result.stdout).not.toContain('website-audit: ok');
  });

  it('passes the shipped exception list against the reviewed advisory', async () => {
    const result = await run(auditPayload(), '2026-10-02T12:00:00Z');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`excused http-cache-semantics (${GHSA})`);
  });

  it('exits non-zero for a partial graph beside the reviewed advisory', async () => {
    const result = await run(auditPayload({ broken: null }), '2026-10-02T12:00:00Z');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('malformed npm audit vulnerability broken');
    expect(result.stdout).not.toContain('website-audit: ok');
  });

  it('warns about an active exception that matches nothing but still passes', async () => {
    const result = await run({ vulnerabilities: {} }, '2026-10-02T12:00:00Z');
    expect(result.status).toBe(0);
    expect(result.stderr).toContain(`exception ${GHSA} no longer matches any advisory`);
    expect(result.stdout).toContain('website-audit: ok');
  });

  it('exits non-zero for an exception without a bounded review window', async () => {
    const result = await run({ vulnerabilities: {} }, '2026-10-02T12:00:00Z', {
      schemaVersion: 1,
      exceptions: [{ ...exception, expires: '2099-12-31' }],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('days after its review');
  });

  it('exits non-zero when an unused exception has expired', async () => {
    const result = await run({ vulnerabilities: {} }, '2026-12-02T00:00:00Z');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`exception ${GHSA} has expired`);
  });

  it('exits non-zero for an unreviewed high advisory', async () => {
    const result = await run(
      {
        vulnerabilities: {
          vite: {
            name: 'vite',
            severity: 'high',
            via: [
              {
                name: 'vite',
                severity: 'high',
                url: 'https://github.com/advisories/GHSA-zzzz-zzzz-zzzz',
              },
            ],
          },
        },
      },
      '2026-10-02T12:00:00Z'
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('high vite https://github.com/advisories/GHSA-zzzz-zzzz-zzzz');
  });
});
