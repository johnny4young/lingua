/**
 * RL-096 Slice 1 — pure helpers for the Privacy + Trust dashboard.
 *
 * Pulled out of `<PrivacyTrustSection>` so the size estimator, the
 * byte formatter, and the localStorage row builder are independently
 * unit-testable without rendering the component. All helpers are
 * read-only with respect to localStorage; the dashboard's Clear
 * action calls `removeItem` directly from the component handler.
 */

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
  // RL-025 Slice A fold B — dependency detection lives entirely
  // local for now (the panel reads imports from the active buffer
  // and asks main whether `node_modules/<name>` exists). Future
  // slices B + C add `npm install` / `micropip` install paths that
  // DO hit a registry; when they ship the row flips its `status`
  // from `'enabled'` (local-only, always on) to a closed enum that
  // tracks the install network call separately.
  'dependencies',
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
      lastCallAt: null,
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
      // AI surfaces ship in a later slice; mark unavailable until
      // RL-031 lands so the row honestly reads "nothing here yet".
      status: 'unavailable',
      lastCallAt: null,
    },
    {
      feature: 'dependencies',
      // RL-025 Slice A — detection + classification are fully local
      // (renderer scans the buffer; main does an `existsSync` on
      // `node_modules`). Slice A surfaces NO network calls; the row
      // exists today so the install path that lands in Slice B / C
      // has a stable home in the audit table from day one.
      status: 'enabled',
      lastCallAt: null,
    },
  ];
}

/**
 * Format a Unix timestamp as a localised "X minutes ago" style
 * relative label. Falls back to a localeable date string for older
 * timestamps. Returns the empty string for `null`.
 */
export function formatRelativeTimestamp(
  at: number | null,
  now: number = Date.now()
): string {
  if (at === null) return '';
  const deltaMs = now - at;
  if (deltaMs < 0) return new Date(at).toLocaleString();
  const seconds = Math.floor(deltaMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
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
