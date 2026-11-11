/**
 * Requests for the license-server flows started from Settings: trial,
 * education start and renew, and recovery. The web renderer calls them with
 * its build-time base URL and desktop main with its allowlisted one, so both
 * surfaces send the same bodies and read responses the same way.
 *
 * Every request returns a tagged union and never throws: no base URL maps to
 * `disabled`, a network error or the 5-second timeout to `unreachable`.
 */

import type {
  EducationRenewFailureReason,
  EducationRenewInput,
  EducationRenewResult,
  EducationRenewSuccess,
  EducationStartFailureReason,
  EducationStartInput,
  EducationStartPending,
  EducationStartResult,
  LicenseRecoverFailureReason,
  LicenseRecoverInput,
  LicenseRecoverPending,
  LicenseRecoverResult,
  TrialStartFailureReason,
  TrialStartInput,
  TrialStartResult,
  TrialStartSuccess,
} from './licenseServerTypes';
import { stripProtocolEnvelope, validateLicenseServerProtocol } from './licenseServerProtocol';

const REQUEST_TIMEOUT_MS = 5000;

type PostOutcome =
  | { ok: true; response: Response; body: Record<string, unknown> | null; json: unknown }
  | { ok: false; message: string };

async function postJson(url: string, payload: unknown): Promise<PostOutcome> {
  const controller = new AbortController();
  // The timeout covers the body read too, so a stalled response cannot hang the form.
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'fetch failed' };
    }
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      if (controller.signal.aborted) return { ok: false, message: 'request timed out' };
    }
    const body =
      json !== null && typeof json === 'object' && !Array.isArray(json)
        ? (json as Record<string, unknown>)
        : null;
    return { ok: true, response, body, json };
  } finally {
    clearTimeout(timer);
  }
}

function readIssues(body: Record<string, unknown> | null): string[] | undefined {
  const raw = body?.issues;
  if (!Array.isArray(raw)) return undefined;
  const filtered = raw.filter((entry): entry is string => typeof entry === 'string');
  return filtered.length > 0 ? filtered : undefined;
}

function readMessage(body: Record<string, unknown> | null): string | undefined {
  return typeof body?.message === 'string' ? body.message : undefined;
}

function pickReason<R extends string>(raw: unknown, known: readonly R[]): R | 'server-error' {
  return typeof raw === 'string' && (known as readonly string[]).includes(raw)
    ? (raw as R)
    : 'server-error';
}

function serverError(response: Response) {
  return { ok: false as const, reason: 'server-error' as const, message: `HTTP ${response.status}` };
}

const TRIAL_REASONS = [
  'invalid-input',
  'trial-unavailable',
  'rate-limited',
  'not-implemented',
] as const satisfies readonly TrialStartFailureReason[];

export async function requestTrialStart(
  baseUrl: string | null,
  input: TrialStartInput
): Promise<TrialStartResult> {
  if (!baseUrl) return { ok: false, reason: 'disabled' };
  const result = await postJson(`${baseUrl}/trials/start`, input);
  if (!result.ok) return { ok: false, reason: 'unreachable', message: result.message };
  const protocol = validateLicenseServerProtocol(result.json);
  if (!protocol.ok) return { ok: false, reason: protocol.reason };
  const { body } = protocol;
  const { response } = result;

  if (response.status >= 500) return serverError(response);
  // The worker answers a duplicate email or device with 200 and ok:false.
  if (response.ok && body.ok === true) {
    return stripProtocolEnvelope(body) as unknown as TrialStartSuccess;
  }
  return {
    ok: false,
    reason: pickReason(body.reason, TRIAL_REASONS),
    message: readMessage(body),
    issues: readIssues(body),
    canRecover: body.canRecover === true ? true : undefined,
    retryAfter: typeof body.retryAfter === 'number' ? body.retryAfter : undefined,
  };
}

const EDUCATION_START_REASONS = [
  'invalid-input',
  'not-educational',
  'education-unavailable',
  'rate-limited',
  'confirmation-email-failed',
  'not-implemented',
] as const satisfies readonly EducationStartFailureReason[];

export async function requestEducationStart(
  baseUrl: string | null,
  input: EducationStartInput
): Promise<EducationStartResult> {
  if (!baseUrl) return { ok: false, reason: 'disabled' };
  const result = await postJson(`${baseUrl}/education/start`, input);
  if (!result.ok) return { ok: false, reason: 'unreachable', message: result.message };
  const { response, body } = result;

  if (response.status >= 500) return serverError(response);
  if (response.ok && body?.ok === true && body.pending === true) {
    return body as unknown as EducationStartPending;
  }
  return {
    ok: false,
    reason: pickReason(body?.reason, EDUCATION_START_REASONS),
    message: readMessage(body),
    issues: readIssues(body),
    canRecover: body?.canRecover === true ? true : undefined,
    retryAfter: typeof body?.retryAfter === 'number' ? body.retryAfter : undefined,
  };
}

const EDUCATION_RENEW_REASONS = [
  'invalid-input',
  'not-educational',
  'unknown-license',
  'email-mismatch',
  'not-implemented',
] as const satisfies readonly EducationRenewFailureReason[];

export async function requestEducationRenew(
  baseUrl: string | null,
  input: EducationRenewInput
): Promise<EducationRenewResult> {
  if (!baseUrl) return { ok: false, reason: 'disabled' };
  const result = await postJson(`${baseUrl}/education/renew`, input);
  if (!result.ok) return { ok: false, reason: 'unreachable', message: result.message };
  const { response, body } = result;

  if (response.status >= 500) return serverError(response);
  if (response.ok && body?.ok === true) {
    return body as unknown as EducationRenewSuccess;
  }
  return {
    ok: false,
    reason: pickReason(body?.reason, EDUCATION_RENEW_REASONS),
    message: readMessage(body),
    issues: readIssues(body),
  };
}

const RECOVER_REASONS = ['invalid-input'] as const satisfies readonly LicenseRecoverFailureReason[];

export async function requestRecoveryStart(
  baseUrl: string | null,
  input: LicenseRecoverInput
): Promise<LicenseRecoverResult> {
  if (!baseUrl) return { ok: false, reason: 'disabled' };
  const result = await postJson(`${baseUrl}/licenses/recover/start`, input);
  if (!result.ok) return { ok: false, reason: 'unreachable', message: result.message };
  // Recovery is no-info-leak only once the response speaks a known protocol.
  const protocol = validateLicenseServerProtocol(result.json);
  if (!protocol.ok) return { ok: false, reason: protocol.reason };
  const { body } = protocol;
  const { response } = result;

  if (response.status >= 500) return serverError(response);
  if (response.ok && body.ok === true && body.pending === true) {
    return body as unknown as LicenseRecoverPending;
  }
  return {
    ok: false,
    reason: pickReason(body.reason, RECOVER_REASONS),
    message: readMessage(body),
  };
}
