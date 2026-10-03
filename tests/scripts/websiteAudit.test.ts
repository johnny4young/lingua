import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { evaluateWebsiteAudit } from '../../scripts/lib/websiteAudit.mjs';

const GHSA = 'GHSA-ch52-4w7c-c8xp';
const exception = { id: GHSA, package: 'http-cache-semantics', expires: '2026-12-01' };
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
    expect(result.offending.map(item => item.name).sort()).toEqual(['astro', 'http-cache-semantics']);
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
          { name: 'astro', severity: 'critical', url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' },
        ],
      },
    });
    const result = evaluateWebsiteAudit(payload, { exceptions: [exception], now });
    expect(result.ok).toBe(false);
    expect(result.offending).toEqual([
      expect.objectContaining({ name: 'astro', advisories: ['https://github.com/advisories/GHSA-aaaa-bbbb-cccc'] }),
    ]);
  });

  it('ignores advisories below the threshold', () => {
    const payload = {
      vulnerabilities: {
        lodash: { name: 'lodash', severity: 'moderate', via: [{ name: 'lodash', severity: 'moderate', url: 'x' }] },
      },
    };
    expect(evaluateWebsiteAudit(payload, { now }).ok).toBe(true);
  });

  it('fails closed on a malformed payload', () => {
    expect(evaluateWebsiteAudit({ error: 'ENOLOCK' }, { now })).toMatchObject({ ok: false });
  });
});

describe('assert-website-audit CLI', () => {
  async function run(payload: unknown, nowIso: string) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-website-audit-'));
    roots.push(root);
    const fixture = path.join(root, 'audit.json');
    await writeFile(fixture, JSON.stringify(payload), 'utf8');
    return spawnSync(
      process.execPath,
      ['scripts/assert-website-audit.mjs', '--fixture', fixture, '--now', nowIso],
      { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' }
    );
  }

  it('passes the shipped exception list against the reviewed advisory', async () => {
    const result = await run(auditPayload(), '2026-10-02T12:00:00Z');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`excused http-cache-semantics (${GHSA})`);
  });

  it('exits non-zero for an unreviewed high advisory', async () => {
    const result = await run(
      {
        vulnerabilities: {
          vite: { name: 'vite', severity: 'high', via: [{ name: 'vite', severity: 'high', url: 'https://github.com/advisories/GHSA-zzzz-zzzz-zzzz' }] },
        },
      },
      '2026-10-02T12:00:00Z'
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('high vite https://github.com/advisories/GHSA-zzzz-zzzz-zzzz');
  });
});
