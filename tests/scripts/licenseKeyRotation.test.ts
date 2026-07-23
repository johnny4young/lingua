import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Release-tooling twin (JS) — what the CI gate actually runs.
import {
  DEFAULT_ROTATION_SLA_DAYS,
  DEFAULT_WARN_WINDOW_DAYS,
  LICENSE_KEY_ENV_NAME,
  computeJwkThumbprint,
  evaluateLicenseKeyRotation,
  extractEnvValue,
} from '../../scripts/lib/licenseKeyRotation.mjs';
// Renderer twin (TS) — what Settings → License renders.
import { computeLicenseJwkThumbprint } from '../../src/shared/license';

/**
 * internal — locks the rotation guard. The thumbprint twins (scripts lib ↔
 * src/shared) must stay byte-equal, mirroring the darwinAsset.mjs ↔
 * update-server twin pin: if they drift, the fingerprint the operator reads
 * in Settings stops matching the registry the release gate enforces.
 */

/** Production key committed in .env / .env.production since implementation */
const PROD_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: '2RLtTcT4AfskWAFBqKI9t_AgFLNvS1hIoGNIK_wr1Kg',
};
/** Independently computed RFC 7638 vector for PROD_JWK (sha256 → base64url). */
const PROD_THUMBPRINT = 'U0WxZzfZ6Ql5ztLrXohowxMxnik8NMUOsaRixXYdfOs';

const OTHER_JWK = {
  kty: 'OKP',
  crv: 'Ed25519',
  x: 'AAAAC3NzaC1lZDI1NTE5AAAAIBase64UrlOnlyFixture00',
};
const OTHER_THUMBPRINT = computeJwkThumbprint(OTHER_JWK) as string;

const WRONG_CURVE_JWK = {
  kty: 'OKP',
  crv: 'X25519',
  x: 'AAAAC3NzaC1lZDI1NTE5AAAAIWrongCurveFixture00',
};

function envText(jwk: object): string {
  return `# fixture\n${LICENSE_KEY_ENV_NAME}='${JSON.stringify(jwk)}'\n`;
}

function registryWith(overrides: Partial<Record<string, unknown>> = {}, entry: Partial<Record<string, unknown>> = {}) {
  return {
    rotationSlaDays: 90,
    warnWindowDays: 14,
    keys: [
      {
        thumbprint: PROD_THUMBPRINT,
        issuedAt: '2026-01-01',
        status: 'active',
        ...entry,
      },
    ],
    ...overrides,
  };
}

const FRESH_NOW = Date.parse('2026-02-01');

describe('computeJwkThumbprint (scripts twin)', () => {
  it('matches the independently computed RFC 7638 vector for the prod key', () => {
    expect(computeJwkThumbprint(PROD_JWK)).toBe(PROD_THUMBPRINT);
    expect(PROD_THUMBPRINT).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  });

  it('returns null for non-OKP or incomplete JWK shapes', () => {
    expect(computeJwkThumbprint(null)).toBeNull();
    expect(computeJwkThumbprint({ kty: 'EC', crv: 'P-256', x: 'abc' })).toBeNull();
    expect(computeJwkThumbprint(WRONG_CURVE_JWK)).toBeNull();
    expect(computeJwkThumbprint({ kty: 'OKP', crv: 'Ed25519' })).toBeNull();
  });

  it('stays byte-equal with the src/shared/license.ts twin', async () => {
    for (const jwk of [PROD_JWK, OTHER_JWK, { kty: 'OKP', crv: 'Ed25519', x: 'short' }]) {
      expect(await computeLicenseJwkThumbprint(jwk as JsonWebKey)).toBe(computeJwkThumbprint(jwk));
    }
    // Both twins reject the same non-OKP shapes.
    expect(await computeLicenseJwkThumbprint({ kty: 'EC', crv: 'P-256', x: 'abc' })).toBeNull();
    expect(await computeLicenseJwkThumbprint(WRONG_CURVE_JWK)).toBeNull();
  });
});

describe('extractEnvValue', () => {
  it('reads single-quoted, double-quoted, and bare assignments', () => {
    expect(extractEnvValue("FOO='bar'\n", 'FOO')).toBe('bar');
    expect(extractEnvValue('FOO="bar"\n', 'FOO')).toBe('bar');
    expect(extractEnvValue('FOO=bar\n', 'FOO')).toBe('bar');
  });

  it('ignores comments and returns null when absent', () => {
    expect(extractEnvValue("# FOO='bar'\n", 'FOO')).toBeNull();
    expect(extractEnvValue("OTHER='x'\n", 'FOO')).toBeNull();
    expect(extractEnvValue(null, 'FOO')).toBeNull();
  });
});

describe('evaluateLicenseKeyRotation', () => {
  it('passes a fresh, documented, active, non-drifted key with no warnings', () => {
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: registryWith(),
      nowMs: FRESH_NOW,
    });
    expect(result.failures).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.thumbprint).toBe(PROD_THUMBPRINT);
    expect(result.ageDays).toBe(31);
  });

  it('accepts a documented pending key during pre-deploy overlap', () => {
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText([PROD_JWK, OTHER_JWK]),
      devEnvText: envText([PROD_JWK, OTHER_JWK]),
      registry: registryWith({
        keys: [
          { thumbprint: PROD_THUMBPRINT, issuedAt: '2026-01-01', status: 'active' },
          { thumbprint: OTHER_THUMBPRINT, issuedAt: '2026-01-31', status: 'pending' },
        ],
      }),
      nowMs: FRESH_NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.thumbprints).toEqual([PROD_THUMBPRINT, OTHER_THUMBPRINT]);
  });

  it('accepts a retiring key after the new primary has been promoted', () => {
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText([OTHER_JWK, PROD_JWK]),
      devEnvText: envText([OTHER_JWK, PROD_JWK]),
      registry: registryWith({
        keys: [
          { thumbprint: OTHER_THUMBPRINT, issuedAt: '2026-01-31', status: 'active' },
          { thumbprint: PROD_THUMBPRINT, issuedAt: '2026-01-01', status: 'retiring' },
        ],
      }),
      nowMs: FRESH_NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.thumbprint).toBe(OTHER_THUMBPRINT);
    expect(result.ageDays).toBe(1);
  });

  it('fails closed when an overlap key is retired or duplicated', () => {
    const retired = evaluateLicenseKeyRotation({
      productionEnvText: envText([PROD_JWK, OTHER_JWK]),
      devEnvText: envText([PROD_JWK, OTHER_JWK]),
      registry: registryWith({
        keys: [
          { thumbprint: PROD_THUMBPRINT, issuedAt: '2026-01-01', status: 'active' },
          { thumbprint: OTHER_THUMBPRINT, issuedAt: '2026-01-31', status: 'retired' },
        ],
      }),
      nowMs: FRESH_NOW,
    });
    expect(retired.ok).toBe(false);
    expect(retired.failures.join('\n')).toMatch(/overlap keys must be pending or retiring/u);

    const duplicate = evaluateLicenseKeyRotation({
      productionEnvText: envText([PROD_JWK, PROD_JWK]),
      devEnvText: null,
      registry: registryWith(),
      nowMs: FRESH_NOW,
    });
    expect(duplicate.ok).toBe(false);
    expect(duplicate.failures.join('\n')).toMatch(/not a valid Ed25519 public keyring/u);
  });

  it('fails a synthetic stale key past the rotation SLA', () => {
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: registryWith(),
      nowMs: Date.parse('2026-04-15'), // 104 days > 90
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/past the 90-day rotation SLA/u);
  });

  it('passes at exactly 90 days and fails on day 91', () => {
    const atBoundary = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: registryWith(),
      nowMs: Date.parse('2026-04-01'),
    });
    const afterBoundary = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: registryWith(),
      nowMs: Date.parse('2026-04-02'),
    });

    expect(atBoundary.ok).toBe(true);
    expect(atBoundary.ageDays).toBe(90);
    expect(afterBoundary.ok).toBe(false);
    expect(afterBoundary.ageDays).toBe(91);
  });

  it('warns (but passes) inside the pre-breach warning window', () => {
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: registryWith(),
      nowMs: Date.parse('2026-03-25'), // 83 days, within 14 of 90
    });
    expect(result.ok).toBe(true);
    expect(result.warnings.join('\n')).toMatch(/breaches the 90-day rotation SLA in \d+ day/u);
  });

  it('fails an embedded key that is not documented in the registry', () => {
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText(OTHER_JWK),
      devEnvText: envText(OTHER_JWK),
      registry: registryWith(),
      nowMs: FRESH_NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/not documented in docs\/security\/license-key-registry\.json/u);
  });

  it('fails when the embedded key is marked retired', () => {
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: registryWith({}, { status: 'retired', retiredAt: '2026-01-15' }),
      nowMs: FRESH_NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/marked 'retired'/u);
    // The exactly-one-active invariant also trips.
    expect(result.failures.join('\n')).toMatch(/exactly one active entry; found 0/u);
  });

  it('fails a future or unparseable issuedAt as a malformed registry', () => {
    const future = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: registryWith({}, { issuedAt: '2027-01-01' }),
      nowMs: FRESH_NOW,
    });
    expect(future.ok).toBe(false);
    expect(future.failures.join('\n')).toMatch(/issuedAt in the future/u);

    const unparseable = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: registryWith({}, { issuedAt: 'not-a-date' }),
      nowMs: FRESH_NOW,
    });
    expect(unparseable.ok).toBe(false);
    expect(unparseable.failures.join('\n')).toMatch(/unparseable issuedAt/u);
  });

  it('fails when .env and .env.production embed different keys', () => {
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(OTHER_JWK),
      registry: registryWith(),
      nowMs: FRESH_NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/different license public keyrings/u);
  });

  it('passes when .env is absent — it is gitignored, so absent in CI and fresh clones', () => {
    // The shipped key lives only in the committed .env.production; a missing
    // dev .env must not block a release. Regression guard for the v0.7.0
    // release-day failure where CI (no .env) tripped the old hard-fail.
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: null,
      registry: registryWith(),
      nowMs: FRESH_NOW,
    });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('fails on missing or malformed production env value', () => {
    const missing = evaluateLicenseKeyRotation({
      productionEnvText: '# nothing here\n',
      devEnvText: envText(PROD_JWK),
      registry: registryWith(),
      nowMs: FRESH_NOW,
    });
    expect(missing.ok).toBe(false);
    expect(missing.failures.join('\n')).toMatch(/\.env\.production does not define/u);

    const malformed = evaluateLicenseKeyRotation({
      productionEnvText: `${LICENSE_KEY_ENV_NAME}='{nope'\n`,
      devEnvText: envText(PROD_JWK),
      registry: registryWith(),
      nowMs: FRESH_NOW,
    });
    expect(malformed.ok).toBe(false);
    expect(malformed.failures.join('\n')).toMatch(/not a valid Ed25519 public keyring/u);
  });

  it('fails on an OKP key from the wrong curve', () => {
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText(WRONG_CURVE_JWK),
      devEnvText: envText(WRONG_CURVE_JWK),
      registry: registryWith(),
      nowMs: FRESH_NOW,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/not a valid Ed25519 public keyring/u);
  });

  it('fails on a missing/empty registry and on multiple active entries', () => {
    const empty = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: null,
      nowMs: FRESH_NOW,
    });
    expect(empty.ok).toBe(false);
    expect(empty.failures.join('\n')).toMatch(/missing, malformed, or has an empty keys array/u);

    const doubleActive = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: registryWith({
        keys: [
          { thumbprint: PROD_THUMBPRINT, issuedAt: '2026-01-01', status: 'active' },
          { thumbprint: 'other', issuedAt: '2025-01-01', status: 'active' },
        ],
      }),
      nowMs: FRESH_NOW,
    });
    expect(doubleActive.ok).toBe(false);
    expect(doubleActive.failures.join('\n')).toMatch(/exactly one active entry; found 2/u);
  });

  it('applies the documented defaults when the registry omits the knobs', () => {
    const result = evaluateLicenseKeyRotation({
      productionEnvText: envText(PROD_JWK),
      devEnvText: envText(PROD_JWK),
      registry: { keys: registryWith().keys },
      nowMs: FRESH_NOW,
    });
    expect(result.slaDays).toBe(DEFAULT_ROTATION_SLA_DAYS);
    expect(DEFAULT_WARN_WINDOW_DAYS).toBe(14);
    expect(result.ok).toBe(true);
  });
});

describe('scripts/assert-license-key-rotation.mjs (CLI)', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  async function writeFixtures(registry: object): Promise<{ prod: string; dev: string; registry: string }> {
    const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-key-rotation-'));
    tempDirs.push(root);
    const prod = path.join(root, '.env.production');
    const dev = path.join(root, '.env');
    const registryPath = path.join(root, 'registry.json');
    await writeFile(prod, envText(PROD_JWK));
    await writeFile(dev, envText(PROD_JWK));
    await writeFile(registryPath, JSON.stringify(registry, null, 2));
    return { prod, dev, registry: registryPath };
  }

  function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
    // spawnSync (not execFileSync) so stderr is observable on BOTH exit
    // paths — the warn-window case exits 0 while still writing the
    // ::warning:: annotation to stdout.
    const result = spawnSync(
      process.execPath,
      ['scripts/assert-license-key-rotation.mjs', ...args],
      { encoding: 'utf8' }
    );
    return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
  }

  it('AC: the guard fires on a synthetic stale-key payload', async () => {
    const paths = await writeFixtures(registryWith());
    const result = runCli([
      '--env-production', paths.prod,
      '--env', paths.dev,
      '--registry', paths.registry,
      '--now', '2026-04-15',
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/past the 90-day rotation SLA/u);
  });

  it('passes a fresh key and prints the thumbprint evidence', async () => {
    const paths = await writeFixtures(registryWith());
    const result = runCli([
      '--env-production', paths.prod,
      '--env', paths.dev,
      '--registry', paths.registry,
      '--now', '2026-02-01',
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`license-key-rotation: ok (thumbprint ${PROD_THUMBPRINT}`);
  });

  it('emits a GitHub warning annotation inside the warn window and still exits 0', async () => {
    const paths = await writeFixtures(registryWith());
    const result = runCli([
      '--env-production', paths.prod,
      '--env', paths.dev,
      '--registry', paths.registry,
      '--now', '2026-03-25',
    ]);
    expect(result.status).toBe(0);
    // On STDOUT, not stderr — the Actions runner only scans stdout for
    // workflow commands, so a stderr ::warning:: would not annotate.
    expect(result.stdout).toMatch(/^::warning::license-key-rotation:/mu);
  });

  it('checks the real committed env files + registry against the current clock', () => {
    // No flags: the defaults point at the repo's .env, .env.production, and
    // docs/security/license-key-registry.json. This is exactly what CI runs;
    // it going red here means a rotation (or a registry update) is overdue.
    const result = runCli([]);
    expect(result.stderr).not.toMatch(/license-key-rotation:.*(not documented|different license|not parseable)/u);
    expect(result.status).toBe(0);
  });
});
