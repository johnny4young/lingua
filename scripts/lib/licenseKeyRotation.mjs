/**
 * License-signing-key rotation policy, pure logic.
 *
 * The app embeds exactly one Ed25519 public key — committed in `.env.production`
 * as `LINGUA_LICENSE_PUBLIC_KEY_JWK` (the dev `.env` is gitignored, so it is the
 * authoritative committed copy; when a dev `.env` is present it must match it);
 * the private half
 * lives only as a Cloudflare Workers secret. Because the JWK is stripped to
 * RFC 8037 §2 fields (`kty`/`crv`/`x` — CF Workers rejects anything extra,
 * see `scripts/dev-license-shared.mjs`), the key itself carries no `kid` or
 * issuance timestamp. Rotation metadata therefore lives OUTSIDE the key, in
 * `docs/security/license-key-registry.json`, keyed by the RFC 7638 JWK
 * thumbprint — a stable key id that never mutates the key material.
 *
 * `computeJwkThumbprint` here must stay byte-equal with
 * `computeLicenseJwkThumbprint` in `src/shared/license.ts` (the renderer
 * twin behind the Settings → License fingerprint row). The equivalence is
 * pinned by `tests/scripts/licenseKeyRotation.test.ts`.
 */

import { createHash } from 'node:crypto';

/** Operational maximum age for the currently embedded production key. */
export const DEFAULT_ROTATION_SLA_DAYS = 90;
/** Days before the SLA breach during which the guard warns but passes. */
export const DEFAULT_WARN_WINDOW_DAYS = 14;

export const LICENSE_KEY_ENV_NAME = 'LINGUA_LICENSE_PUBLIC_KEY_JWK';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * RFC 7638 §3 thumbprint of an OKP public JWK: SHA-256 over the canonical
 * JSON containing only the required members in lexicographic order
 * (`crv`, `kty`, `x`), base64url-encoded without padding (43 chars).
 * Returns null for anything that is not the Ed25519 OKP public JWK shape so
 * callers land on a named failure instead of hashing garbage or another OKP
 * curve that WebCrypto would reject at runtime.
 *
 * @param {{ kty?: string, crv?: string, x?: string } | null | undefined} jwk
 * @returns {string | null}
 */
export function computeJwkThumbprint(jwk) {
  if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') {
    return null;
  }
  const canonical = `{"crv":${JSON.stringify(jwk.crv)},"kty":${JSON.stringify(jwk.kty)},"x":${JSON.stringify(jwk.x)}}`;
  return createHash('sha256').update(canonical, 'utf8').digest('base64url');
}

/**
 * Extract a single `NAME=value` assignment from dotenv-style text without
 * pulling a dotenv dependency into a release gate. Handles the quoting
 * styles the committed env files actually use (single quotes today; double
 * quotes and bare values tolerated). Returns null when the variable is
 * absent or commented out.
 *
 * @param {string | null | undefined} envText
 * @param {string} name
 * @returns {string | null}
 */
export function extractEnvValue(envText, name) {
  if (typeof envText !== 'string') return null;
  for (const line of envText.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed.startsWith(`${name}=`)) continue;
    let value = trimmed.slice(name.length + 1).trim();
    if (
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2) ||
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

/**
 * @typedef {Object} LicenseKeyRegistryEntry
 * @property {string} thumbprint RFC 7638 thumbprint of the public JWK (43-char base64url).
 * @property {string} issuedAt ISO date the keypair was minted and embedded.
 * @property {'active'|'retired'} status Exactly one entry may be `active` at a time.
 * @property {string} [retiredAt] ISO date the key was rotated out.
 * @property {string} [note] Operator-facing provenance for the key material.
 */

/**
 * @typedef {Object} LicenseKeyRegistry
 * @property {number} [rotationSlaDays] Hard ceiling on embedded-key age; defaults to {@link DEFAULT_ROTATION_SLA_DAYS}.
 * @property {number} [warnWindowDays] Pre-breach warning window; defaults to {@link DEFAULT_WARN_WINDOW_DAYS}.
 * @property {LicenseKeyRegistryEntry[]} keys
 */

/**
 * @typedef {Object} LicenseKeyRotationResult
 * @property {boolean} ok True when there are no failures (warnings allowed).
 * @property {string[]} failures Release-blocking findings; each is self-explanatory prose.
 * @property {string[]} warnings Non-blocking findings (approaching-SLA window).
 * @property {string | null} thumbprint Thumbprint of the embedded production key when computable.
 * @property {number | null} ageDays Whole days since the registry `issuedAt` when resolvable.
 * @property {number} slaDays Effective rotation SLA applied.
 */

/**
 * Evaluate the rotation policy against the two committed env files and the
 * key registry. Pure — callers supply file contents and `nowMs` so tests
 * are deterministic. Failure modes (each release-blocking):
 *
 * - `.env.production` missing/unparseable JWK (a build embedding nothing
 *   or garbage would reject every token with `no-public-key`).
 * - `.env` ↔ `.env.production` thumbprint drift (dev builds verifying
 *   against a different key than packaged builds).
 * - Embedded key not in the registry (undocumented key id — AC #3).
 * - Registry entry not `active` (a retired key still shipping).
 * - Registry `issuedAt` unparseable or in the future (malformed registry).
 * - Key age past `rotationSlaDays` (AC #1).
 * - Zero or multiple `active` registry entries (ambiguous registry).
 *
 * @param {{ productionEnvText: string | null, devEnvText: string | null, registry: LicenseKeyRegistry | null, nowMs: number }} input
 * @returns {LicenseKeyRotationResult}
 */
export function evaluateLicenseKeyRotation({ productionEnvText, devEnvText, registry, nowMs }) {
  const failures = [];
  const warnings = [];

  const slaDays =
    registry && Number.isFinite(registry.rotationSlaDays) && registry.rotationSlaDays > 0
      ? registry.rotationSlaDays
      : DEFAULT_ROTATION_SLA_DAYS;
  const warnWindowDays =
    registry && Number.isFinite(registry.warnWindowDays) && registry.warnWindowDays >= 0
      ? registry.warnWindowDays
      : DEFAULT_WARN_WINDOW_DAYS;

  const prodRaw = extractEnvValue(productionEnvText, LICENSE_KEY_ENV_NAME);
  let thumbprint = null;
  if (prodRaw === null) {
    failures.push(
      `.env.production does not define ${LICENSE_KEY_ENV_NAME}; packaged builds would embed no key and reject every license with no-public-key.`
    );
  } else {
    let prodJwk = null;
    try {
      prodJwk = JSON.parse(prodRaw);
    } catch {
      failures.push(`.env.production ${LICENSE_KEY_ENV_NAME} is not parseable JSON.`);
    }
    if (prodJwk !== null) {
      thumbprint = computeJwkThumbprint(prodJwk);
      if (thumbprint === null) {
        failures.push(
          `.env.production ${LICENSE_KEY_ENV_NAME} is not an Ed25519 OKP public JWK (expected kty/crv/x).`
        );
      }
    }
  }

  // Drift guard: when a dev `.env` is present it must embed the SAME key as
  // the committed `.env.production`. `.env` is gitignored (dev-local), so it is
  // legitimately absent in CI and on fresh clones — the shipped key lives only
  // in the committed `.env.production`, which the registry/SLA checks above
  // already cover. An absent `.env` is therefore NOT a release blocker; we only
  // fail on a present-but-drifted dev key (or a malformed dev JWK).
  const devRaw = extractEnvValue(devEnvText, LICENSE_KEY_ENV_NAME);
  if (devRaw !== null && thumbprint !== null) {
    let devJwk = null;
    try {
      devJwk = JSON.parse(devRaw);
    } catch {
      failures.push(`.env ${LICENSE_KEY_ENV_NAME} is not parseable JSON.`);
    }
    if (devJwk !== null) {
      const devThumbprint = computeJwkThumbprint(devJwk);
      if (devThumbprint !== thumbprint) {
        failures.push(
          `.env and .env.production embed different license public keys (thumbprints ${devThumbprint ?? 'unparseable'} vs ${thumbprint}). Update both in the same commit.`
        );
      }
    }
  }

  const keys = Array.isArray(registry?.keys) ? registry.keys : null;
  if (keys === null || keys.length === 0) {
    failures.push(
      'docs/security/license-key-registry.json is missing, malformed, or has an empty keys array.'
    );
    return { ok: failures.length === 0, failures, warnings, thumbprint, ageDays: null, slaDays };
  }

  const activeCount = keys.filter(entry => entry?.status === 'active').length;
  if (activeCount !== 1) {
    failures.push(`The key registry must have exactly one active entry; found ${activeCount}.`);
  }

  let ageDays = null;
  if (thumbprint !== null) {
    const entry = keys.find(candidate => candidate?.thumbprint === thumbprint);
    if (!entry) {
      failures.push(
        `Embedded license public key (thumbprint ${thumbprint}) is not documented in docs/security/license-key-registry.json. Add a registry entry before shipping it.`
      );
    } else {
      if (entry.status !== 'active') {
        failures.push(
          `Embedded license public key (thumbprint ${thumbprint}) is marked '${entry.status}' in the registry; a non-active key must not ship.`
        );
      }
      const issuedAtMs = Date.parse(entry.issuedAt ?? '');
      if (!Number.isFinite(issuedAtMs)) {
        failures.push(
          `Registry entry for ${thumbprint} has an unparseable issuedAt (${String(entry.issuedAt)}).`
        );
      } else if (issuedAtMs > nowMs) {
        failures.push(
          `Registry entry for ${thumbprint} has issuedAt in the future (${entry.issuedAt}); fix the registry.`
        );
      } else {
        ageDays = Math.floor((nowMs - issuedAtMs) / DAY_MS);
        if (ageDays > slaDays) {
          failures.push(
            `Embedded license public key is ${ageDays} days old, past the ${slaDays}-day rotation SLA. Rotate it per docs/RELEASE_SECURITY.md before releasing.`
          );
        } else if (ageDays > slaDays - warnWindowDays) {
          warnings.push(
            `Embedded license public key is ${ageDays} days old and breaches the ${slaDays}-day rotation SLA in ${slaDays - ageDays} day(s). Schedule a rotation per docs/RELEASE_SECURITY.md.`
          );
        }
      }
    }
  }

  return { ok: failures.length === 0, failures, warnings, thumbprint, ageDays, slaDays };
}
