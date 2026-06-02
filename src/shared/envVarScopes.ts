/**
 * RL-011 Slice A — pure env-var scope merger.
 *
 * Tab > project > global > process precedence, with empty-string
 * values preserved (POSIX-like "unset the inherited variable" shape).
 * Designed to live in `src/shared/` so renderer + main can reason
 * about the same merge.
 *
 * Current consumers:
 *   - renderer `envVarsStore` validates/sanitizes persisted user tiers,
 *   - Go/Rust desktop runners merge the user record with host env in main,
 *   - the Python worker receives the user record and hydrates `os.environ`.
 */

/** Single tier in the precedence stack. Keys are validated per entry. */
export type EnvVarScope = Readonly<Record<string, string>>;

export interface EnvVarStack {
  /** Host-process environment (lowest precedence). Optional for tests. */
  processEnv?: EnvVarScope;
  /** Persisted across sessions, ships with every runner invocation. */
  global?: EnvVarScope;
  /** Persisted per project when a project is open. */
  project?: EnvVarScope;
  /** Ephemeral per tab — lives only as long as the tab does. */
  tab?: EnvVarScope;
}

export type KeyValidationReason =
  | 'empty'
  | 'too-long'
  | 'invalid-leading-character'
  | 'invalid-character'
  | 'reserved-prefix';

export interface KeyValidationOk {
  ok: true;
}

export interface KeyValidationErr {
  ok: false;
  reason: KeyValidationReason;
}

export type KeyValidationResult = KeyValidationOk | KeyValidationErr;

/** POSIX-style env-var names: leading letter or underscore, then [A-Z0-9_]. */
const POSIX_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/u;

/** Hard limit matches what Linux getconf ARG_MAX realistically tolerates. */
export const MAX_KEY_LENGTH = 128;
export const MAX_VALUE_LENGTH = 32_768;
export const MAX_SCOPE_KEYS = 100;

/**
 * Names we refuse to let the user override. Changing them during a
 * runner invocation has side effects we cannot guarantee (PATH) or
 * exposes secrets from the host (HOME, SHELL). Runner-specific env
 * (`GOOS`, `RUSTFLAGS`, `PYTHONPATH`) intentionally stays user-writable
 * — that's the whole point of the feature.
 */
const RESERVED_KEYS: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'LOGNAME',
  'PWD',
  'OLDPWD',
]);

export function validateEnvVarKey(rawKey: string): KeyValidationResult {
  if (typeof rawKey !== 'string' || rawKey.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  if (rawKey.length > MAX_KEY_LENGTH) {
    return { ok: false, reason: 'too-long' };
  }
  if (!POSIX_ENV_KEY.test(rawKey)) {
    // Give a slightly more specific hint when the problem is clearly
    // a leading digit (the common case) vs any other invalid char.
    if (/^[0-9]/u.test(rawKey)) {
      return { ok: false, reason: 'invalid-leading-character' };
    }
    return { ok: false, reason: 'invalid-character' };
  }
  if (RESERVED_KEYS.has(rawKey)) {
    return { ok: false, reason: 'reserved-prefix' };
  }
  return { ok: true };
}

/**
 * Sanitize an incoming scope before we persist it. Drops invalid keys
 * silently — the UI layer is expected to pre-validate and surface the
 * reasons; this helper is the last line of defense before merge.
 */
export function sanitizeScope(scope: EnvVarScope | undefined): EnvVarScope {
  if (!scope) return {};
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(scope)) {
    if (count >= MAX_SCOPE_KEYS) break;
    if (!validateEnvVarKey(key).ok) continue;
    if (typeof value !== 'string') continue;
    if (value.length > MAX_VALUE_LENGTH) continue;
    out[key] = value;
    count += 1;
  }
  return out;
}

/**
 * Produce the merged env to hand to a runner, respecting tab > project
 * > global > process precedence. Empty-string values are preserved so
 * a tab-level `KEY=''` can mask an inherited host value.
 */
export function mergeEnvScopes(stack: EnvVarStack): Readonly<Record<string, string>> {
  return Object.freeze({
    ...sanitizeScope(stack.processEnv),
    ...sanitizeScope(stack.global),
    ...sanitizeScope(stack.project),
    ...sanitizeScope(stack.tab),
  });
}

/**
 * Test helper — describe the precedence each key resolved to. Not used
 * in production flows; kept here because the UI layer may eventually
 * want to show "tab override" badges next to each merged row.
 */
export type ScopeName = 'processEnv' | 'global' | 'project' | 'tab';

export function traceEnvScopes(
  stack: EnvVarStack
): Record<string, { value: string; from: ScopeName }> {
  const trace: Record<string, { value: string; from: ScopeName }> = {};
  const order: ScopeName[] = ['processEnv', 'global', 'project', 'tab'];
  for (const name of order) {
    const scope = sanitizeScope(stack[name]);
    for (const [key, value] of Object.entries(scope)) {
      trace[key] = { value, from: name };
    }
  }
  return trace;
}
