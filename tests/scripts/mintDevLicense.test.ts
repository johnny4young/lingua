import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { verifyLicenseToken } from '../../src/shared/license';

/**
 * End-to-end test for `scripts/mint-dev-license.mjs`. Runs the script as a
 * subprocess and verifies the emitted token against the emitted public key,
 * proving that the dev workflow documented in AGENTS.md actually works. If
 * this test breaks, the "paste a dev license" instructions in AGENTS.md are
 * also broken and must be fixed in the same commit.
 */
describe('scripts/mint-dev-license.mjs', () => {
  it('produces a token that verifies against the emitted Ed25519 public key', async () => {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/mint-dev-license.mjs', '--tier', 'pro', '--days', '7', '--issued-to', 'ci@local'],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(stdout) as {
      publicKeyJwk: string;
      token: string;
      payload: { tier: string; issuedTo: string };
    };

    expect(parsed.payload.tier).toBe('pro');
    expect(parsed.payload.issuedTo).toBe('ci@local');

    const publicKey = JSON.parse(parsed.publicKeyJwk) as JsonWebKey;
    const result = await verifyLicenseToken(parsed.token, publicKey);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.tier).toBe('pro');
      expect(result.state).toBe('active');
    }
  });

  it('rejects an unsupported --tier without writing output', () => {
    let threw = false;
    try {
      execFileSync(
        process.execPath,
        ['scripts/mint-dev-license.mjs', '--tier', 'admin'],
        { stdio: 'pipe' }
      );
    } catch (error) {
      threw = true;
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
      expect(stderr).toMatch(/Unknown --tier/);
    }
    expect(threw).toBe(true);
  });

  it('accepts --days 0 and still emits a valid signed token payload', async () => {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/mint-dev-license.mjs', '--tier', 'pro', '--days', '0'],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(stdout) as {
      publicKeyJwk: string;
      token: string;
      payload: { supportWindowEndsAt: string };
    };

    expect(parsed.payload.supportWindowEndsAt).toMatch(/T/);

    const publicKey = JSON.parse(parsed.publicKeyJwk) as JsonWebKey;
    const result = await verifyLicenseToken(parsed.token, publicKey);
    expect(result.ok).toBe(true);
  });
});
