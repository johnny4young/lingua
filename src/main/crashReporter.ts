/**
 * Crash reporting bootstrap for RL-067.
 *
 * The Electron `crashReporter` captures main + renderer crashes and uploads
 * minidumps to a configured endpoint. Per the RL-067 acceptance criteria:
 *   - Opt-in is unified with the RL-065 telemetry consent — this module
 *     reads the same renderer-persisted flag (`lingua-settings.
 *     telemetryConsent`) via the `readConsent` helper the renderer sets up.
 *   - The endpoint is env-configurable so dev / staging / prod can point at
 *     different back-ends with the same binary.
 *   - Lingua does not attach app-level user code, file paths, or project
 *     names through `extra` fields. Electron still uploads diagnostic
 *     minidumps to the configured endpoint, so the UI copy must describe
 *     crash reporting as opt-in diagnostics rather than a no-data claim.
 *
 * This file is main-side only. The renderer already owns consent and
 * cannot call `crashReporter.start` directly, so the two processes
 * coordinate through a small boot-time file read — see `readConsentAtBoot`.
 */

import { crashReporter } from 'electron';
import { readFile } from 'node:fs/promises';

export interface CrashReporterConfig {
  /** Build version string injected at boot. */
  appVersion: string;
  /** Absolute path to a JSON snapshot of the persisted settings, if available. */
  settingsPath?: string;
  /** Override the upload endpoint for tests. */
  endpoint?: string;
  /** Override the kill switch for tests. */
  killSwitch?: boolean;
  /** Override the consent reader for tests. */
  readConsentAtBoot?: () => Promise<'granted' | 'declined' | 'unset'>;
}

const CRASH_REPORTER_PRODUCT = 'Lingua';
const CRASH_REPORTER_COMPANY = 'Lingua';

function readKillSwitch(): boolean {
  const raw = process.env.LINGUA_CRASH_REPORTER_DISABLED;
  return raw === '1' || raw === 'true';
}

function readEndpoint(): string | null {
  const raw = process.env.LINGUA_CRASH_REPORTER_URL;
  return typeof raw === 'string' && raw.length > 0 ? raw : null;
}

/**
 * Parse the zustand-persist snapshot stored under `lingua-settings` in the
 * renderer. Returns `'unset'` on malformed input so we bias toward not
 * sending crash reports when consent cannot be proven.
 */
export function parsePersistedTelemetryConsent(
  raw: string | null | undefined
): 'granted' | 'declined' | 'unset' {
  if (typeof raw !== 'string' || raw.length === 0) {
    return 'unset';
  }

  try {
    const parsed = JSON.parse(raw) as {
      state?: { telemetryConsent?: string };
    };
    const consent = parsed.state?.telemetryConsent;
    if (consent === 'granted' || consent === 'declined' || consent === 'unset') {
      return consent;
    }
    return 'unset';
  } catch {
    return 'unset';
  }
}

/**
 * Optional file-based fallback for tests or future adapters that mirror the
 * `lingua-settings` snapshot outside the renderer process.
 */
export async function readConsentFromSettingsFile(
  settingsPath: string
): Promise<'granted' | 'declined' | 'unset'> {
  try {
    const raw = await readFile(settingsPath, 'utf-8');
    return parsePersistedTelemetryConsent(raw);
  } catch {
    return 'unset';
  }
}

export interface CrashReporterBootResult {
  status: 'started' | 'skipped-no-consent' | 'skipped-no-endpoint' | 'skipped-kill-switch';
  reason?: string;
}

/**
 * Idempotent bootstrap. Main should call this once after `app.whenReady()`.
 * The returned result is shaped so tests can assert every branch and so the
 * main process can surface a structured log line (never the user's
 * telemetry state — just the outcome string).
 */
export async function bootCrashReporter(
  config: CrashReporterConfig
): Promise<CrashReporterBootResult> {
  if (config.killSwitch ?? readKillSwitch()) {
    return { status: 'skipped-kill-switch' };
  }

  const endpoint = config.endpoint ?? readEndpoint();
  if (!endpoint) {
    return { status: 'skipped-no-endpoint' };
  }

  const consent = await (config.readConsentAtBoot ??
    (() =>
      config.settingsPath
        ? readConsentFromSettingsFile(config.settingsPath)
        : Promise.resolve<'granted' | 'declined' | 'unset'>('unset')))();

  if (consent !== 'granted') {
    return { status: 'skipped-no-consent', reason: consent };
  }

  crashReporter.start({
    productName: CRASH_REPORTER_PRODUCT,
    companyName: CRASH_REPORTER_COMPANY,
    submitURL: endpoint,
    uploadToServer: true,
    // The Electron API accepts `extra` for tagging — we only attach the
    // app version so the back-end can filter by build. Nothing here
    // touches user code or filesystem paths.
    extra: { appVersion: config.appVersion },
    // Rate-limiting avoids hammering the endpoint if a build enters a
    // crash loop; the default `compress: true` keeps payloads small.
    rateLimit: true,
  });

  return { status: 'started' };
}
