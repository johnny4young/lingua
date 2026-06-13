import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_AUDIT_LEVEL,
  SEVERITY_RANK,
  evaluateProdAudit,
  formatProdAuditFailure,
} from '../../scripts/lib/prodAudit.mjs';

/**
 * RL-145 — locks the production-dependency audit gate. The "synthetic high
 * advisory fails CI" acceptance criterion is proven here with fixture audit
 * JSON (a live registry advisory cannot be injected), exercising both the
 * pure evaluator and the real CLI through `--fixture`.
 */

/** Minimal `pnpm audit --json` shape: one advisory at the given severity. */
function auditFixture(advisories: Array<{ id: string; severity: string; module: string }>) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  const advisoryMap: Record<string, unknown> = {};
  for (const a of advisories) {
    if (a.severity in counts) counts[a.severity as keyof typeof counts] += 1;
    advisoryMap[a.id] = {
      id: Number(a.id),
      title: `synthetic ${a.severity} in ${a.module}`,
      module_name: a.module,
      severity: a.severity,
      url: `https://example.test/advisory/${a.id}`,
      findings: [{ version: '1.0.0', paths: [`.>${a.module}`, `.>wrapper>${a.module}`] }],
    };
  }
  return { advisories: advisoryMap, metadata: { vulnerabilities: counts } };
}

const CLEAN_AUDIT = { advisories: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 } } };

describe('evaluateProdAudit', () => {
  it('passes a clean audit with no advisories', () => {
    const result = evaluateProdAudit(CLEAN_AUDIT);
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.offending).toEqual([]);
    expect(result.level).toBe(DEFAULT_AUDIT_LEVEL);
  });

  it('fails on a synthetic high advisory (AC #2)', () => {
    const result = evaluateProdAudit(auditFixture([{ id: '101', severity: 'high', module: 'evil-dep' }]));
    expect(result.ok).toBe(false);
    expect(result.offending).toHaveLength(1);
    expect(result.offending[0]).toMatchObject({ id: '101', module: 'evil-dep', severity: 'high' });
    expect(result.offending[0].shortestPath).toBe('.>evil-dep');
  });

  it('fails on a synthetic critical advisory', () => {
    const result = evaluateProdAudit(auditFixture([{ id: '102', severity: 'critical', module: 'worse-dep' }]));
    expect(result.ok).toBe(false);
    expect(result.offending[0].severity).toBe('critical');
  });

  it('passes when only moderate/low advisories exist at the default high threshold', () => {
    const result = evaluateProdAudit(
      auditFixture([
        { id: '103', severity: 'moderate', module: 'meh-dep' },
        { id: '104', severity: 'low', module: 'minor-dep' },
      ])
    );
    expect(result.ok).toBe(true);
    expect(result.offending).toEqual([]);
    // Counts still reflect what was scanned.
    expect(result.counts.moderate).toBe(1);
    expect(result.counts.low).toBe(1);
  });

  it('honours a stricter --level critical (high passes, critical fails)', () => {
    const highOnly = auditFixture([{ id: '105', severity: 'high', module: 'h-dep' }]);
    expect(evaluateProdAudit(highOnly, { level: 'critical' }).ok).toBe(true);

    const withCritical = auditFixture([
      { id: '105', severity: 'high', module: 'h-dep' },
      { id: '106', severity: 'critical', module: 'c-dep' },
    ]);
    const result = evaluateProdAudit(withCritical, { level: 'critical' });
    expect(result.ok).toBe(false);
    expect(result.offending).toHaveLength(1);
    expect(result.offending[0].severity).toBe('critical');
  });

  it('sorts offending advisories worst-first', () => {
    const result = evaluateProdAudit(
      auditFixture([
        { id: '107', severity: 'high', module: 'h-dep' },
        { id: '108', severity: 'critical', module: 'c-dep' },
      ])
    );
    expect(result.offending.map((o) => o.severity)).toEqual(['critical', 'high']);
  });

  it('fails closed on a malformed payload (no advisories object)', () => {
    for (const bad of [null, undefined, {}, { advisories: null }, { advisories: 'nope' }, { advisories: [] }, 42]) {
      const result = evaluateProdAudit(bad);
      expect(result.ok, `payload ${JSON.stringify(bad)}`).toBe(false);
      expect(result.error).toBe('malformed');
    }
  });

  it('fails closed on malformed advisory entries or unknown severities', () => {
    for (const bad of [
      { advisories: { '110': null } },
      { advisories: { '111': 'not-an-object' } },
      { advisories: { '112': { module_name: 'mystery-dep' } } },
      { advisories: { '113': { module_name: 'mystery-dep', severity: 'HIGH' } } },
    ]) {
      const result = evaluateProdAudit(bad);
      expect(result.ok, `payload ${JSON.stringify(bad)}`).toBe(false);
      expect(result.error).toBe('malformed');
      expect(result.message).toMatch(/cannot verify the production graph|unknown severity/u);
    }
  });

  it('fails closed on an unknown --level', () => {
    const result = evaluateProdAudit(CLEAN_AUDIT, { level: 'bogus' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('malformed');
  });

  it('derives counts from advisories when metadata is absent', () => {
    const result = evaluateProdAudit({
      advisories: {
        '109': { module_name: 'x', severity: 'high', findings: [{ paths: ['.>x'] }] },
      },
    });
    expect(result.counts.high).toBe(1);
    expect(result.ok).toBe(false);
  });

  it('ranks severities so high >= high but moderate < high', () => {
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeGreaterThan(SEVERITY_RANK.moderate);
  });
});

describe('formatProdAuditFailure', () => {
  it('renders a remediation hint with url, path, and pnpm why (fold C)', () => {
    const result = evaluateProdAudit(auditFixture([{ id: '110', severity: 'high', module: 'evil-dep' }]));
    const report = formatProdAuditFailure(result);
    expect(report).toContain('[high] evil-dep');
    expect(report).toContain('https://example.test/advisory/110');
    expect(report).toContain('path: .>evil-dep');
    expect(report).toContain('pnpm why evil-dep');
    expect(report).toContain('docs/RELEASE_SECURITY.md');
  });

  it('returns empty string when nothing offends', () => {
    expect(formatProdAuditFailure(evaluateProdAudit(CLEAN_AUDIT))).toBe('');
  });
});

describe('scripts/assert-prod-audit.mjs (CLI)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function writeFixture(audit: unknown): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-prod-audit-'));
    tempDirs.push(root);
    const fixturePath = path.join(root, 'audit.json');
    await writeFile(fixturePath, JSON.stringify(audit));
    return fixturePath;
  }

  function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, ['scripts/assert-prod-audit.mjs', ...args], {
      encoding: 'utf8',
    });
    return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  }

  it('AC: a synthetic high advisory fixture fails the gate (exit 1) with a hint', async () => {
    const fixture = await writeFixture(auditFixture([{ id: '201', severity: 'high', module: 'evil-dep' }]));
    const result = runCli(['--fixture', fixture]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('pnpm why evil-dep');
  });

  it('passes a clean fixture (exit 0)', async () => {
    const fixture = await writeFixture(CLEAN_AUDIT);
    const result = runCli(['--fixture', fixture]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('prod-audit: ok');
  });

  it('passes a moderate-only fixture at the default high threshold', async () => {
    const fixture = await writeFixture(auditFixture([{ id: '202', severity: 'moderate', module: 'meh' }]));
    expect(runCli(['--fixture', fixture]).status).toBe(0);
  });

  it('fails closed on a malformed fixture (exit 1)', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-prod-audit-bad-'));
    tempDirs.push(root);
    const fixturePath = path.join(root, 'bad.json');
    await writeFile(fixturePath, 'not-json{');
    const result = runCli(['--fixture', fixturePath]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/could not parse audit JSON/u);
  });

  it('runs end-to-end through the real pnpm audit spawn (wiring, network-tolerant)', () => {
    // No --fixture: spawns `pnpm audit --prod --json`. This asserts the WIRING
    // — our CLI spawns pnpm, captures stdout, parses, and reports through one
    // of our own code paths — without coupling to live registry state or
    // duplicating the dedicated `check:prod-audit` CI gate (which is the thing
    // that legitimately goes red when a real prod advisory lands). So we
    // accept either the clean pass or any of our named fail-closed messages,
    // but never a crash, hang, or spawn-not-found.
    const result = runCli([]);
    const output = result.stdout + result.stderr;
    const ranThroughOurCode =
      output.includes('prod-audit: ok') || // clean prod graph
      output.includes('Production dependency audit found') || // a real advisory
      output.includes('could not parse audit JSON') || // unparseable payload
      output.includes('pnpm audit produced no JSON') || // registry/network failure
      output.includes('cannot verify the production graph'); // malformed payload
    expect(ranThroughOurCode, `unexpected CLI output: ${output}`).toBe(true);
    // Exit is binary and deterministic: 0 (clean) or 1 (fail-closed). Never a
    // crash signal (null) or anything else.
    expect([0, 1]).toContain(result.status);
  });
});
