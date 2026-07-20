/**
 * implementation — shared redaction primitives.
 *
 * Extracted from `src/shared/telemetry.ts` so that telemetry +
 * `runCapsule.ts` + any future surface that leaves the renderer can
 * share a single source of truth for "what counts as sensitive".
 * No behaviour change vs. the original telemetry-local helpers — the
 * telemetry redactor imports from this module and continues to work
 * identically (a parity test asserts the public contract is stable).
 *
 * Anything that crosses a privacy boundary (telemetry POSTs, exported
 * Run Capsules, future share-links / CLI artifacts) MUST run through
 * `keyLooksSensitive` + `valueLooksSensitive` and add the dropped
 * field names to its respective `privacy.omittedFields` (capsules)
 * or `droppedKeys` (telemetry) report so the consumer can audit
 * what was redacted without re-discovering the rule set.
 */

/**
 * Substring deny pass. A property name containing any of these
 * (case-insensitive) is dropped from the outgoing artifact even when
 * the per-event allowlist would otherwise accept it. The list is
 * deliberately broad — false positives are cheap (we still ship the
 * event), false negatives can leak user data.
 *
 * History: originally lived in `telemetry.ts` for the internal worker;
 * extracted here in implementation so capsules consume the same
 * list.
 */
export const DENY_SUBSTRINGS = [
  'content',
  'code',
  'source',
  'snippet',
  'file',
  'path',
  'apikey',
  'api_key',
  'secret',
  'credential',
  'authorization',
  'privatekey',
  'private_key',
  'accesskey',
  'access_key',
  'licensekey',
  'license_key',
  'token',
  'password',
  'email',
  'name',
  'project',
] as const;

/**
 * Version stamp for the redaction rule set. Bumps when DENY_SUBSTRINGS
 * or the value-shape policy below changes in a way consumers must
 * record on the artifact ("this capsule was redacted by rev N").
 *
 * NOT a SemVer. A simple monotonic ISO date stamp. Downstream
 * consumers SHOULD pin against an exact value when replay
 * determinism matters.
 */
export const REDACTION_VERSION = '2026-05-21.1';

/**
 * `true` when the key contains any DENY_SUBSTRING (case-insensitive).
 * Caller must drop the property and surface the key name in its
 * audit report.
 */
export function keyLooksSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return DENY_SUBSTRINGS.some((deny) => lower.includes(deny));
}

/**
 * `true` when the value is not a primitive (object, array, function,
 * Buffer, etc.). Anything non-primitive can structurally carry user
 * data, so we never transmit those over telemetry or embed them raw
 * in a capsule.
 *
 * Returns `false` for `null` because the telemetry contract explicitly
 * accepts `null` values (e.g. cleared properties). Capsules treat
 * `null` the same way (deliberate omission, not user data).
 */
export function valueLooksSensitive(value: unknown): boolean {
  if (value === null) return false;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return false;
  return true;
}

/**
 * Convenience wrapper applied by capsule sanitisers: walks a flat
 * `Record<string, unknown>` once and returns the surviving entries
 * + the names of the dropped keys. Pure — no I/O, no telemetry side
 * effects.
 *
 * `dropReason` is `'key'` when the key matched a DENY_SUBSTRING and
 * `'value'` when the value shape was non-primitive. Capsules use
 * this to populate `privacy.omittedFields` honestly.
 */
export interface RedactionOutcome {
  surviving: Record<string, string | number | boolean | null>;
  dropped: Array<{ key: string; reason: 'key' | 'value' }>;
}

export function redactFlatRecord(
  record: Record<string, unknown>
): RedactionOutcome {
  const surviving: Record<string, string | number | boolean | null> = {};
  const dropped: Array<{ key: string; reason: 'key' | 'value' }> = [];
  for (const [key, value] of Object.entries(record)) {
    if (keyLooksSensitive(key)) {
      dropped.push({ key, reason: 'key' });
      continue;
    }
    if (valueLooksSensitive(value)) {
      dropped.push({ key, reason: 'value' });
      continue;
    }
    surviving[key] = value as string | number | boolean | null;
  }
  return { surviving, dropped };
}
