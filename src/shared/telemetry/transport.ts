/**
 * Wire payload shape and coarse metadata helpers for telemetry transport.
 *
 * Network delivery intentionally remains in the renderer emitter, where
 * consent, endpoint configuration, and best-effort failure handling live.
 */

import type { TelemetryEventName } from './catalog';

export interface TelemetryBaseFields {
  appVersion: string;
  osBucket: string;
  /** `pro` / `free` / `grace` / `invalid` — never the raw token. */
  licenseStatus: string;
  /** Coarse session id generated per-launch — not a user identifier. */
  sessionId: string;
}

export interface TelemetryEvent extends TelemetryBaseFields {
  event: TelemetryEventName;
  /**
   * Allowed per-event properties. Keys listed here are the only ones that
   * survive the redactor. Any key not in this map is dropped, not sent.
   */
  properties: Record<string, string | number | boolean>;
  /** Milliseconds since epoch — rounded to the minute to reduce fingerprintability. */
  timestamp: number;
}

/** Bucket an OS version string into a coarse "platform/major" form. */
export function bucketOs(platform: string, version: string): string {
  if (!platform) return 'unknown';
  const major = version.match(/^\d+/u)?.[0] ?? 'unknown';
  return `${platform}/${major}`;
}

/**
 * Generate a coarse, non-persistent session id (32 hex chars). Used as a
 * fingerprint-resistant grouping key for events inside a single launch.
 * Deliberately module-agnostic so renderer + tests + any future main
 * emitter call through the same helper.
 */
export function createSessionId(): string {
  const source =
    typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
      ? crypto
      : globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    // Worst case (no Web Crypto): return a time-based fallback. Still
    // single-launch scoped — it never leaves memory and is only used to
    // group events, never to identify a user.
    return `t${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffff).toString(16)}`.padEnd(
      32,
      '0'
    );
  }
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Simple duration bucketer so we never transmit raw run times. */
export function bucketDurationMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  if (ms < 50) return 50;
  if (ms < 250) return 250;
  if (ms < 1000) return 1000;
  if (ms < 5000) return 5000;
  if (ms < 30_000) return 30_000;
  return 60_000;
}
