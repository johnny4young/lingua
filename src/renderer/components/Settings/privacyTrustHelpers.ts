/**
 * implementation — pure helpers for the Privacy + Trust dashboard.
 *
 * Pulled out of `<PrivacyTrustSection>` so the size estimator, the
 * byte formatter, and the localStorage row builder are independently
 * unit-testable without rendering the component. All helpers are
 * read-only with respect to localStorage; the dashboard's Clear
 * action calls `removeItem` directly from the component handler.
 */

import type { TrustEvent, TrustFeature } from '../../stores/trustEventStore';

/**
 * Closed list of localStorage keys Lingua owns. Auditing only what
 * we know we created keeps the table honest — third-party keys
 * (e.g. monaco's editor state) are intentionally hidden because
 * they are out of our control.
 */
export const LINGUA_LOCAL_STORE_KEYS = [
  'lingua-settings',
  'lingua-license',
  'lingua-snippets',
  'lingua-utility-state',
  'lingua-trust-events',
] as const;

export type LinguaLocalStoreKey = (typeof LINGUA_LOCAL_STORE_KEYS)[number];

export interface LocalStoreRow {
  readonly key: LinguaLocalStoreKey;
  readonly purposeKey: string;
  readonly bytes: number;
}

/**
 * Estimate the byte size of a localStorage value. localStorage stores
 * UTF-16 code units, so each character is 2 bytes. Falls back to 0
 * when the key is absent or localStorage throws (private mode, quota
 * exceeded, etc.).
 */
export function estimateLocalStorageSize(key: string): number {
  if (typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return 0;
    return raw.length * 2;
  } catch {
    return 0;
  }
}

/**
 * Human-friendly byte formatter — B / KB / MB. Mirrors the
 * `formatBytes` pattern from `executionHistoryStore` snapshot
 * size displays but localised inline so the dashboard does not
 * depend on a store internal.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Build the localStorage audit table rows. Each row carries an i18n
 * purposeKey so the rendered description tracks the active locale.
 */
export function getLocalStoreRows(): ReadonlyArray<LocalStoreRow> {
  return LINGUA_LOCAL_STORE_KEYS.map((key) => ({
    key,
    purposeKey: `settings.privacy.localStores.purpose.${key}`,
    bytes: estimateLocalStorageSize(key),
  }));
}

/**
 * Closed enum of features whose network activity is summarised in
 * the dashboard. The order is the table render order.
 */
export const NETWORK_ACTIVITY_FEATURES = [
  'telemetry',
  'updates',
  'license',
  'capsule-export',
  'ai',
  // implementation Slice A implementation note — dependency detection lives entirely
  // local for now (the panel reads imports from the active buffer
  // and asks main whether `node_modules/<name>` exists). Future
  // implementation add `npm install` / `micropip` install paths that
  // DO hit a registry; when they ship the row flips its `status`
  // from `'enabled'` (local-only, always on) to a closed enum that
  // tracks the install network call separately.
  'dependencies',
  // implementation Sub-slice G implementation note — output→source line origin tracking.
  // Captures the source line of each console output row to drive
  // the `<OutputLineBadge>` click + hover affordances. Local-only;
  // never sent to the network. Status reflects the
  // `outputSourceMappingEnabled` Settings flag so a user can audit
  // the feature at a glance.
  'outputOriginTracking',
  // implementation note — Git read-only layer (status pill + diff
  // panel). Local-only: `execFile('git', ['status', '--porcelain'])`
  // + `git show HEAD:<file>` against the resolved repo root. NO
  // remote refs, NO `git fetch`, NO network. implementation removed the
  // Settings master toggle; the dashboard row is transparency for
  // the baseline local-only surface.
  'gitReadOnlyLayer',
  // implementation next slice implementation note — console image clipboard paste. A pasted
  // image becomes an in-memory `image` rich console entry; it is NEVER
  // persisted to localStorage and NEVER sent over the network (only a
  // closed-enum telemetry status + size bucket is emitted, no bytes).
  // The row exists purely for transparency on the new input surface.
  'consoleImagePaste',
  // implementation note — project zip bundle export / import. Reads
  // and writes whole project trees on disk via the capability-sandboxed
  // `fs:exportBundle` / `fs:importBundle` IPCs. Pure local: a `.zip` is
  // written to / read from a user-chosen path; nothing is sent over the
  // network (only a closed-enum status + file-count bucket is emitted as
  // telemetry, never paths or bytes). Row exists for transparency on the
  // new whole-tree read/write surface.
  'projectBundle',
] as const;

export type NetworkActivityFeature =
  (typeof NETWORK_ACTIVITY_FEATURES)[number];

export type NetworkActivityStatus = 'enabled' | 'disabled' | 'unavailable';

export interface NetworkActivityRow {
  readonly feature: NetworkActivityFeature;
  readonly status: NetworkActivityStatus;
  readonly lastCallAt: number | null;
}

/**
 * Derive the network activity table from current store state.
 * Caller passes the relevant slices to keep this helper pure.
 */
export function buildNetworkActivityRows(args: {
  readonly telemetryConsent: 'granted' | 'declined' | 'unset';
  readonly licenseStatus: 'pro' | 'free' | 'invalid' | 'grace';
  readonly capsuleExportLastAt: number | null;
  readonly telemetryLastAt: number | null;
  readonly updateCheckLastAt: number | null;
  /**
   * implementation note — most recent successful license verify
   * (active / grace). Surfaced as the `license` row's `lastCallAt`.
   */
  readonly licenseVerifyLastAt?: number | null;
  /**
   * implementation — most recent dependency install start. The
   * dashboard surfaces this as the `dependencies` row's
   * `lastCallAt` so the audit table honestly reports the most
   * recent network call.
   */
  readonly dependencyInstallLastAt?: number | null;
}): ReadonlyArray<NetworkActivityRow> {
  return [
    {
      feature: 'telemetry',
      status: args.telemetryConsent === 'granted' ? 'enabled' : 'disabled',
      lastCallAt: args.telemetryLastAt,
    },
    {
      feature: 'updates',
      // Web build can poll a remote feed; desktop honours the
      // configured updater. Both are normally enabled out of the box;
      // this row reflects "ever called" via lastCallAt.
      status: 'enabled',
      lastCallAt: args.updateCheckLastAt,
    },
    {
      feature: 'license',
      status:
        args.licenseStatus === 'pro' || args.licenseStatus === 'grace'
          ? 'enabled'
          : 'disabled',
      lastCallAt: args.licenseVerifyLastAt ?? null,
    },
    {
      feature: 'capsule-export',
      // Capsule export only happens on explicit user action; status
      // is always enabled (the feature is always available). The
      // lastCallAt timestamp tells the real story.
      status: 'enabled',
      lastCallAt: args.capsuleExportLastAt,
    },
    {
      feature: 'ai',
      // AI surfaces ship in a later work; mark unavailable until
      // internal lands so the row honestly reads "nothing here yet".
      status: 'unavailable',
      lastCallAt: null,
    },
    {
      feature: 'dependencies',
      // implementation — detection + classification are fully local
      // (renderer scans the buffer; main does an `existsSync` on
      // `node_modules`). implementation lights up the JS/TS desktop install
      // path; `lastCallAt` now reflects the most recent `npm install`
      // start so the audit table honestly reports the most recent
      // network call. implementation stays local-only; the install path
      // only fires when the user clicks Install explicitly.
      status: 'enabled',
      lastCallAt: args.dependencyInstallLastAt ?? null,
    },
    {
      feature: 'outputOriginTracking',
      // implementation — captures the source line of each console
      // output row to drive click + hover affordances. Pure local: the
      // worker reads its own `new Error().stack`, attaches a line
      // integer to each payload, and the renderer paints a chip. NO
      // file paths, NO content, NO network calls — the row appears in
      // the audit table for transparency. implementation removed the master
      // toggle, so this row is unconditionally 'enabled'; the per-tab
      // `// @origin off` directive remains as the user-controlled
      // opt-out.
      status: 'enabled',
      lastCallAt: null,
    },
    {
      feature: 'gitReadOnlyLayer',
      // implementation note — pure local invocation of `git
      // status --porcelain` / `git diff HEAD` / `git show HEAD:<f>`
      // against the resolved repo root. NO remote refs, NO fetch,
      // NO push, NO writes of any kind in implementation. implementation
      // removed the Settings master toggle (git awareness is now
      // baseline); the per-file `// @git-ignore-status` directive
      // remains as the user-controlled opt-out. Row is `'enabled'`
      // whenever the binary + repo posture resolved.
      status: 'enabled',
      lastCallAt: null,
    },
    {
      feature: 'consoleImagePaste',
      // implementation detail — pasting an image into the console renders
      // it as an in-memory `image` rich entry. Pure local: the bytes
      // never touch localStorage and never leave the renderer (only a
      // closed-enum status + size bucket is emitted as telemetry). Row
      // is `'enabled'` for transparency on the input surface.
      status: 'enabled',
      lastCallAt: null,
    },
    {
      feature: 'projectBundle',
      // implementation note — export/import a project as a `.zip`.
      // Pure local disk I/O through the capability sandbox; nothing
      // leaves the machine. Always `'enabled'` (the feature is always
      // available); the closed-enum telemetry carries only status +
      // file-count bucket, never paths or bytes.
      status: 'enabled',
      lastCallAt: null,
    },
  ];
}

/**
 * implementation — reduce the trust-event log to the most recent `at`
 * per feature. Pure; the dashboard feeds the result into
 * {@link buildNetworkActivityRows} so each Network row shows a real
 * "last call" derived from the captured events instead of a hardcoded
 * `null`. Features with no recorded event are simply absent from the map.
 */
export function latestEventAtByFeature(
  events: ReadonlyArray<TrustEvent>
): Partial<Record<TrustFeature, number>> {
  const latest: Partial<Record<TrustFeature, number>> = {};
  for (const event of events) {
    const prev = latest[event.feature];
    if (prev === undefined || event.at > prev) {
      latest[event.feature] = event.at;
    }
  }
  return latest;
}

/**
 * Injectable translator for {@link formatRelativeTimestamp} — maps an i18n
 * key + `{ count }` to a localized string (call sites pass i18next's `t`).
 * Keeping it injectable lets the helper stay pure + unit-testable without an
 * i18n runtime; when omitted, the helper falls back to a terse English
 * `Xs/Xm/Xh ago`.
 */
export type RelativeTimestampTranslator = (
  key: string,
  options: { readonly count: number }
) => string;

function formatRelativeUnit(
  unit: 'seconds' | 'minutes' | 'hours',
  count: number,
  translate?: RelativeTimestampTranslator
): string {
  if (translate) {
    return translate(`settings.privacy.relative.${unit}`, { count });
  }
  const suffix = unit === 'seconds' ? 's' : unit === 'minutes' ? 'm' : 'h';
  return `${count}${suffix} ago`;
}

/**
 * Format a Unix timestamp as a localised "X minutes ago" style relative
 * label via the optional {@link RelativeTimestampTranslator}. Falls back to a
 * localeable date string for older timestamps. Returns the empty string for
 * `null`.
 */
export function formatRelativeTimestamp(
  at: number | null,
  now: number = Date.now(),
  translate?: RelativeTimestampTranslator
): string {
  if (at === null) return '';
  const deltaMs = now - at;
  if (deltaMs < 0) return new Date(at).toLocaleString();
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return formatRelativeUnit('seconds', seconds, translate);
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return formatRelativeUnit('minutes', minutes, translate);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatRelativeUnit('hours', hours, translate);
  return new Date(at).toLocaleDateString();
}

/**
 * Compute median + P95 of an array of numbers. Used by the
 * run-history timeline section. Returns `null` for both when the
 * input is empty so the caller can render an empty-state.
 */
export function medianAndP95(
  values: ReadonlyArray<number>
): { readonly median: number | null; readonly p95: number | null } {
  if (values.length === 0) return { median: null, p95: null };
  const sorted = [...values].sort((a, b) => a - b);
  const midIndex = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[midIndex - 1]! + sorted[midIndex]!) / 2
      : sorted[midIndex]!;
  const p95Index = Math.min(
    sorted.length - 1,
    Math.floor(sorted.length * 0.95)
  );
  return { median, p95: sorted[p95Index]! };
}
