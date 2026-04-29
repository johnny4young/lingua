/**
 * Hand-rolled body validators for the Slice 1 endpoints.
 *
 * Why hand-rolled (no zod / valibot): Slice 1 has four request shapes
 * with shallow fields. Adding a schema library to a Cloudflare Worker
 * adds bundle weight (zod ships ~10KB minified, even tree-shaken) and
 * one more dependency to keep version-locked. The validators here are
 * each ~20 LOC and produce the same `issues: string[]` array shape that
 * Slice 2's webhook payload validator can extend without rewriting the
 * caller surface.
 */

const SUPPORTED_SURFACES = new Set<string>(['desktop', 'web']);

export type Surface = 'desktop' | 'web';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const TEXT_ENCODER = new TextEncoder();

/**
 * Hard upper bounds applied to every string field. Reject early so a
 * megabyte-scale `deviceName` never reaches the D1 INSERT path. Numbers
 * sized for the legitimate origin: deviceId is `crypto.randomUUID()`
 * (36 chars), deviceName seeds from `os.hostname()` (typically <64,
 * 254 cap leaves room for the user's edits), token is a JWS with two
 * base64url segments (a few hundred bytes — 4096 has 10x headroom),
 * email is RFC-5321 254 cap. `os` is informational only — Electron
 * sends one of `darwin|win32|linux` and the web build sends
 * `web-${browserFamily}` (chrome / firefox / safari / edge / etc., or
 * the catch-all `web-unknown`). The 64-byte cap accommodates both
 * shapes plus reasonable headroom for any future surface (mobile,
 * Tauri) without forcing a server change every time the renderer
 * gains a new browser detection branch.
 */
export const MAX_EMAIL_LENGTH = 254;
export const MAX_DEVICE_ID_LENGTH = 128;
export const MAX_DEVICE_NAME_LENGTH = 254;
export const MAX_TOKEN_LENGTH = 4096;
export const MAX_OS_LENGTH = 64;

/**
 * Permissive `os` shape check: lowercase ASCII letters, digits, and
 * single internal hyphens (`darwin`, `win32`, `web-chrome`,
 * `web-unknown`). Rejects whitespace, punctuation, and HTML-bait so a
 * compromised client cannot poison a peer's device list with markup
 * even though React escapes it on render.
 */
const OS_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: string[] };

function pushIssue(issues: string[], message: string): void {
  issues.push(message);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function exceedsUtf8ByteCap(value: string, maxBytes: number): boolean {
  return TEXT_ENCODER.encode(value).byteLength > maxBytes;
}

export interface TrialStartBody {
  email: string;
  deviceId: string;
  deviceName: string;
  os: string;
}

export function validateTrialStartBody(input: unknown): ValidationResult<TrialStartBody> {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, issues: ['body must be a JSON object'] };
  }
  const record = input as Record<string, unknown>;

  const email = asString(record.email)?.trim().toLowerCase() ?? '';
  if (email.length === 0) pushIssue(issues, 'email is required');
  else if (exceedsUtf8ByteCap(email, MAX_EMAIL_LENGTH)) {
    pushIssue(issues, `email exceeds ${MAX_EMAIL_LENGTH} byte cap`);
  } else if (!EMAIL_PATTERN.test(email)) pushIssue(issues, 'email is malformed');

  const deviceId = asString(record.deviceId)?.trim() ?? '';
  if (deviceId.length === 0) pushIssue(issues, 'deviceId is required');
  else if (exceedsUtf8ByteCap(deviceId, MAX_DEVICE_ID_LENGTH)) {
    pushIssue(issues, `deviceId exceeds ${MAX_DEVICE_ID_LENGTH} byte cap`);
  }

  const deviceName = asString(record.deviceName)?.trim() ?? '';
  if (deviceName.length === 0) pushIssue(issues, 'deviceName is required');
  else if (exceedsUtf8ByteCap(deviceName, MAX_DEVICE_NAME_LENGTH)) {
    pushIssue(issues, `deviceName exceeds ${MAX_DEVICE_NAME_LENGTH} byte cap`);
  }

  const os = asString(record.os)?.trim().toLowerCase() ?? '';
  validateOsField(os, issues);

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: { email, deviceId, deviceName, os },
  };
}

export interface LicenseActivateBody {
  token: string;
  deviceId: string;
  deviceName: string;
  os: string;
  surface: Surface;
}

export function validateLicenseActivateBody(input: unknown): ValidationResult<LicenseActivateBody> {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, issues: ['body must be a JSON object'] };
  }
  const record = input as Record<string, unknown>;

  const token = asString(record.token)?.trim() ?? '';
  if (token.length === 0) pushIssue(issues, 'token is required');
  else if (exceedsUtf8ByteCap(token, MAX_TOKEN_LENGTH)) {
    pushIssue(issues, `token exceeds ${MAX_TOKEN_LENGTH} byte cap`);
  }

  const deviceId = asString(record.deviceId)?.trim() ?? '';
  if (deviceId.length === 0) pushIssue(issues, 'deviceId is required');
  else if (exceedsUtf8ByteCap(deviceId, MAX_DEVICE_ID_LENGTH)) {
    pushIssue(issues, `deviceId exceeds ${MAX_DEVICE_ID_LENGTH} byte cap`);
  }

  const deviceName = asString(record.deviceName)?.trim() ?? '';
  if (deviceName.length === 0) pushIssue(issues, 'deviceName is required');
  else if (exceedsUtf8ByteCap(deviceName, MAX_DEVICE_NAME_LENGTH)) {
    pushIssue(issues, `deviceName exceeds ${MAX_DEVICE_NAME_LENGTH} byte cap`);
  }

  const os = asString(record.os)?.trim().toLowerCase() ?? '';
  validateOsField(os, issues);

  // Surface is required for the split-bucket device limit. Renderer
  // sends 'desktop' when window.lingua.license is present, 'web' when
  // not. See LICENSING_ADR Decision 4.
  const surface = asString(record.surface) ?? '';
  if (!SUPPORTED_SURFACES.has(surface)) {
    pushIssue(issues, `surface must be one of ${[...SUPPORTED_SURFACES].join(', ')}`);
  }

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: {
      token,
      deviceId,
      deviceName,
      os,
      surface: surface as Surface,
    },
  };
}

/**
 * Shared `os` field validator for `/trials/start` and
 * `/licenses/activate`. The renderer is the source of truth for the
 * exact strings that flow through (Electron emits Node's `process.platform`
 * values; web emits `web-${browserFamily}`). The server only enforces
 * a length cap and a permissive shape so a junk string cannot break
 * the device-list display.
 */
function validateOsField(os: string, issues: string[]): void {
  if (os.length === 0) {
    pushIssue(issues, 'os is required');
    return;
  }
  if (exceedsUtf8ByteCap(os, MAX_OS_LENGTH)) {
    pushIssue(issues, `os exceeds ${MAX_OS_LENGTH} byte cap`);
    return;
  }
  if (!OS_PATTERN.test(os)) {
    pushIssue(issues, 'os must be lowercase letters/digits with optional hyphens');
  }
}

export interface LicenseStatusRequest {
  token: string;
  deviceId: string;
  surface: Surface;
}

const BEARER_PREFIX = /^Bearer\s+/iu;

/**
 * Read the license token from the Authorization header rather than the
 * URL — the token is a credential, and CF Workers observability +
 * access logs capture URL query params verbatim. Authorization headers
 * are excluded from those logs by default, which is the correct place
 * for a bearer credential per RFC 6750.
 *
 * `deviceId` stays in the query string: it is a non-secret installation
 * identifier and the renderer needs it to scope the lookup.
 */
export function validateLicenseStatusRequest(
  authorization: string | null,
  params: URLSearchParams,
): ValidationResult<LicenseStatusRequest> {
  const issues: string[] = [];

  let token = '';
  if (typeof authorization === 'string' && BEARER_PREFIX.test(authorization)) {
    token = authorization.replace(BEARER_PREFIX, '').trim();
  }
  if (token.length === 0) {
    pushIssue(issues, 'token is required (send as Authorization: Bearer <token>)');
  } else if (exceedsUtf8ByteCap(token, MAX_TOKEN_LENGTH)) {
    pushIssue(issues, `token exceeds ${MAX_TOKEN_LENGTH} byte cap`);
  }

  const deviceId = (params.get('deviceId') ?? '').trim();
  if (deviceId.length === 0) pushIssue(issues, 'deviceId is required');
  else if (exceedsUtf8ByteCap(deviceId, MAX_DEVICE_ID_LENGTH)) {
    pushIssue(issues, `deviceId exceeds ${MAX_DEVICE_ID_LENGTH} byte cap`);
  }

  const surface = (params.get('surface') ?? '').trim();
  if (!SUPPORTED_SURFACES.has(surface)) {
    pushIssue(issues, `surface must be one of ${[...SUPPORTED_SURFACES].join(', ')}`);
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { token, deviceId, surface: surface as Surface } };
}

export interface DeviceRemoveBody {
  token: string;
  deviceIdToRemove: string;
}

export function validateDeviceRemoveBody(input: unknown): ValidationResult<DeviceRemoveBody> {
  const issues: string[] = [];
  if (!input || typeof input !== 'object') {
    return { ok: false, issues: ['body must be a JSON object'] };
  }
  const record = input as Record<string, unknown>;

  const token = asString(record.token)?.trim() ?? '';
  if (token.length === 0) pushIssue(issues, 'token is required');
  else if (exceedsUtf8ByteCap(token, MAX_TOKEN_LENGTH)) {
    pushIssue(issues, `token exceeds ${MAX_TOKEN_LENGTH} byte cap`);
  }

  const deviceIdToRemove = asString(record.deviceIdToRemove)?.trim() ?? '';
  if (deviceIdToRemove.length === 0) pushIssue(issues, 'deviceIdToRemove is required');
  else if (exceedsUtf8ByteCap(deviceIdToRemove, MAX_DEVICE_ID_LENGTH)) {
    pushIssue(issues, `deviceIdToRemove exceeds ${MAX_DEVICE_ID_LENGTH} byte cap`);
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { token, deviceIdToRemove } };
}
