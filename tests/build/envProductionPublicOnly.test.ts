/**
 * implementation — public-only contract gate for the git-tracked `.env.production`.
 *
 * `.env.production` ships in the repo and is loaded by `vite build` to point
 * the web bundle at the production license server + embed the PUBLIC license
 * verification key. The private half of that keypair lives only as a
 * Cloudflare Workers secret and must never land in this file. This test turns
 * that contract into a CI failure: it parses each assignment (comments are
 * ignored, so the file may still *name* the Cloudflare secret in prose) and
 * rejects any value that carries private-key material, or any variable whose
 * name reads like a secret.
 *
 * Prove the lock by temporarily adding `LINGUA_LICENSE_PRIVATE_KEY_JWK=...`
 * with a `d` member to `.env.production` and confirming this test goes red.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(__dirname, '../..');
const envPath = resolve(repoRoot, '.env.production');

interface Assignment {
  line: number;
  name: string;
  rawValue: string;
}

/**
 * Parse `KEY=value` / `KEY='value'` / `KEY="value"` assignments, skipping
 * blank lines and `#` comments. Quotes are stripped from the value so the JWK
 * checks see the inner JSON.
 */
function parseAssignments(text: string): Assignment[] {
  const assignments: Assignment[] = [];
  const lines = text.split(/\r?\n/u);
  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) return;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) return;
    const name = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }
    assignments.push({ line: index + 1, name, rawValue: value });
  });
  return assignments;
}

describe('.env.production stays public-only', () => {
  const text = readFileSync(envPath, 'utf-8');
  const assignments = parseAssignments(text);

  it('has at least the two license assignments we expect', () => {
    // Guard the parser itself: if the format ever changes so nothing
    // parses, the private-material checks below would vacuously pass.
    const names = assignments.map((a) => a.name);
    expect(names).toContain('LINGUA_LICENSE_PUBLIC_KEY_JWK');
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it('has no variable name that reads like a secret', () => {
    const offenders = assignments.filter((a) =>
      /(PRIVATE|SECRET|TOKEN|PASSWORD|PASSPHRASE)/iu.test(a.name)
    );
    expect(
      offenders.map((a) => `${a.name} (line ${a.line})`)
    ).toEqual([]);
  });

  it('has no assignment carrying a private-key JWK (a `d` member)', () => {
    const offenders = assignments.filter((a) => {
      if (!a.rawValue.includes('"kty"')) return false;
      try {
        const parsed = JSON.parse(a.rawValue) as Record<string, unknown>;
        return typeof parsed.d === 'string' && parsed.d.length > 0;
      } catch {
        // Not parseable JSON (e.g. the `$VAR` interpolation alias) — fall
        // back to a substring probe for a `d` member.
        return /"d"\s*:/u.test(a.rawValue);
      }
    });
    expect(
      offenders.map((a) => `${a.name} (line ${a.line})`)
    ).toEqual([]);
  });

  it('has no PEM private-key block anywhere in the file', () => {
    expect(text).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/u);
  });
});
