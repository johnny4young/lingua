/**
 * Contract for the desktop secret vault: values encrypted with Electron
 * `safeStorage` in main, one blob per id under `userData/secrets`.
 *
 * Ids are namespaced (`ai.api-key`, `http-env.<env>.<var>`, and the main-only
 * `db.<connection id>`) and restricted to
 * a filename-safe charset so main can map them to files without escaping.
 */

/** `encrypted` writes to disk; `session` keeps values in main memory only. */
export type SecretStorageMode = 'encrypted' | 'session';

export interface SecretVaultStatus {
  readonly mode: SecretStorageMode;
  /** Linux `safeStorage.getSelectedStorageBackend()` value, when known. */
  readonly backend?: string;
}

export type SecretWriteResult =
  | { readonly ok: true; readonly mode: SecretStorageMode }
  | { readonly ok: false; readonly reason: 'invalid-id' | 'invalid-value' | 'write-failed' };

export interface SecretVaultBridge {
  status(): Promise<SecretVaultStatus>;
  set(id: string, value: string): Promise<SecretWriteResult>;
  get(id: string): Promise<string | null>;
  delete(id: string): Promise<{ readonly ok: boolean }>;
  /** Ids stored under `prefix` (encrypted and session-only). */
  list(prefix: string): Promise<readonly string[]>;
}

export const MAX_SECRET_VALUE_LENGTH = 64 * 1024;

const SEGMENT = '[A-Za-z0-9_-]{1,80}';
/** Known namespaces only, so a renderer cannot mint files in new ones. `db` is main-only. */
const NAMESPACE = '(?:ai|http-env|db)';
const SECRET_ID_RE = new RegExp(`^${NAMESPACE}(?:\\.${SEGMENT}){1,3}$`);
const SECRET_PREFIX_RE = new RegExp(`^${NAMESPACE}\\.(?:${SEGMENT}\\.){0,2}$`);

export function isValidSecretId(value: unknown): value is string {
  return typeof value === 'string' && SECRET_ID_RE.test(value);
}

/** A list prefix is a namespace plus zero to two segments, ending in a dot. */
export function isValidSecretPrefix(value: unknown): value is string {
  return typeof value === 'string' && SECRET_PREFIX_RE.test(value);
}

export function isValidSecretValue(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_SECRET_VALUE_LENGTH;
}

export const AI_API_KEY_SECRET_ID = 'ai.api-key';
export const HTTP_ENV_SECRET_PREFIX = 'http-env.';

const SAFE_SEGMENT_RE = new RegExp(`^${SEGMENT}$`);

/** Hand-imported ids may hold any characters; hash those into a safe segment. */
function toSegment(raw: string): string {
  if (SAFE_SEGMENT_RE.test(raw)) return raw;
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `h${hash.toString(16).padStart(8, '0')}`;
}

export function httpEnvSecretId(environmentId: string, variableId: string): string {
  return `${HTTP_ENV_SECRET_PREFIX}${toSegment(environmentId)}.${toSegment(variableId)}`;
}
