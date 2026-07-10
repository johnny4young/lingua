import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createMigrate } from './persistence/migrationRegistry';

/**
 * RL-096 Slice 1 — Trust event log.
 *
 * Bounded local log (cap 200) of trust-relevant actions for the
 * Privacy + Trust Dashboard. The shape is deliberately MINIMAL:
 * `feature` + `action` + `sensitivity` + `summary` only. There is
 * NO `payload?: unknown` field because the entire point of the
 * dashboard is to assure the user nothing sensitive is captured
 * here. The TypeScript shape pins the contract; the `record()` path
 * builds a fresh event object so any extra keys are dropped at
 * runtime as a defense-in-depth measure when JS callers ignore the
 * typings.
 *
 * Pinned by `tests/stores/trustEventStore.test.ts`:
 *   - 200-entry FIFO cap (push 201, oldest drops).
 *   - Extra props from callers are stripped (shape integrity).
 *   - `clear()` empties the log.
 *   - `summary` is always a string.
 */

export type TrustFeature =
  | 'telemetry'
  | 'updates'
  | 'license'
  | 'share-link'
  | 'capsule-export'
  | 'run-ledger'
  | 'ai';

export type TrustSensitivity = 'low' | 'medium' | 'high';

export interface TrustEvent {
  readonly id: number;
  readonly at: number;
  readonly feature: TrustFeature;
  readonly action: string;
  readonly sensitivity: TrustSensitivity;
  readonly summary: string;
}

const TRUST_EVENT_CAP = 200;
export const TRUST_EVENT_STORAGE_KEY = 'lingua-trust-events';

/**
 * The caller-supplied fields for a trust event — everything on {@link
 * TrustEvent} except the store-assigned `id` + `at`. `summary` must be
 * METADATA ONLY (never code, field values, tokens, or a share URL); the
 * store truncates it to 200 chars but does not otherwise inspect it.
 * Consumed by both `record` and {@link recordTrustEventBestEffort}.
 */
export interface TrustEventInput {
  readonly feature: TrustFeature;
  readonly action: string;
  readonly sensitivity: TrustSensitivity;
  readonly summary: string;
}

interface TrustEventState {
  readonly events: ReadonlyArray<TrustEvent>;
  /**
   * Record a new trust event. Sanitises the incoming shape:
   *   - drops any extra keys not on `TrustEvent`
   *   - coerces `summary` to string and truncates to 200 chars
   *   - assigns a monotonic id + `Date.now()` timestamp
   *   - enforces the 200-entry FIFO cap by shifting out oldest
   */
  readonly record: (input: TrustEventInput) => void;
  /** Empty the log. Used by the Privacy dashboard's local-store clear flow. */
  readonly clear: () => void;
}

let trustEventCounter = 0;

const SUMMARY_MAX_LENGTH = 200;

function sanitiseSummary(value: unknown): string {
  if (typeof value !== 'string') return '';
  if (value.length <= SUMMARY_MAX_LENGTH) return value;
  return `${value.slice(0, SUMMARY_MAX_LENGTH)}…`;
}

function isTrustFeature(value: unknown): value is TrustFeature {
  return typeof value === 'string' && VALID_FEATURES.has(value as TrustFeature);
}

function isTrustSensitivity(value: unknown): value is TrustSensitivity {
  return (
    typeof value === 'string' &&
    VALID_SENSITIVITIES.has(value as TrustSensitivity)
  );
}

function sanitizePersistedEvents(value: unknown): TrustEvent[] {
  if (!Array.isArray(value)) return [];
  const sanitized: TrustEvent[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const candidate = raw as Record<string, unknown>;
    if (!isTrustFeature(candidate.feature)) continue;
    if (!isTrustSensitivity(candidate.sensitivity)) continue;
    if (typeof candidate.action !== 'string' || candidate.action.length === 0) {
      continue;
    }
    if (typeof candidate.id !== 'number' || !Number.isFinite(candidate.id)) {
      continue;
    }
    if (typeof candidate.at !== 'number' || !Number.isFinite(candidate.at)) {
      continue;
    }
    sanitized.push({
      id: candidate.id,
      at: candidate.at,
      feature: candidate.feature,
      action: candidate.action,
      sensitivity: candidate.sensitivity,
      summary: sanitiseSummary(candidate.summary),
    });
  }
  return sanitized.slice(-TRUST_EVENT_CAP);
}

function nextTrustEventId(events: ReadonlyArray<TrustEvent>): number {
  for (const event of events) {
    if (event.id > trustEventCounter) {
      trustEventCounter = event.id;
    }
  }
  trustEventCounter += 1;
  return trustEventCounter;
}

const VALID_FEATURES = new Set<TrustFeature>([
  'telemetry',
  'updates',
  'license',
  'share-link',
  'capsule-export',
  'ai',
]);

const VALID_SENSITIVITIES = new Set<TrustSensitivity>([
  'low',
  'medium',
  'high',
]);

export const useTrustEventStore = create<TrustEventState>()(
  persist(
    (set) => ({
      events: [],
      record: (input) => {
        if (!VALID_FEATURES.has(input.feature)) return;
        if (!VALID_SENSITIVITIES.has(input.sensitivity)) return;
        if (typeof input.action !== 'string' || input.action.length === 0) {
          return;
        }
        set((state) => {
          const entry: TrustEvent = {
            id: nextTrustEventId(state.events),
            at: Date.now(),
            feature: input.feature,
            action: input.action,
            sensitivity: input.sensitivity,
            summary: sanitiseSummary(input.summary),
          };
          const next = [...state.events, entry];
          if (next.length > TRUST_EVENT_CAP) {
            next.splice(0, next.length - TRUST_EVENT_CAP);
          }
          return { events: next };
        });
      },
      clear: () => set({ events: [] }),
    }),
    {
      name: TRUST_EVENT_STORAGE_KEY,
      version: 1,
      migrate: createMigrate(TRUST_EVENT_STORAGE_KEY),
      partialize: (state) => ({ events: state.events }),
      merge: (persisted, current) => {
        const events =
          persisted && typeof persisted === 'object'
            ? sanitizePersistedEvents(
                (persisted as { events?: unknown }).events
              )
            : [];
        return { ...current, events };
      },
    }
  )
);

export const TRUST_EVENT_CAP_FOR_TEST = TRUST_EVENT_CAP;
export const _sanitizeTrustEventsForTesting = sanitizePersistedEvents;
export function _resetTrustEventCounterForTesting(): void {
  trustEventCounter = 0;
}

/**
 * RL-096 Slice 2 reviewer hardening — trust capture is a transparency mirror,
 * not the source of truth for the user action. If localStorage is unavailable
 * or over quota, the egress that already succeeded (clipboard/share/update/
 * telemetry/license) must not be reported as failed. Use this helper at
 * outbound call sites instead of calling `record` directly.
 */
export function recordTrustEventBestEffort(input: TrustEventInput): void {
  try {
    useTrustEventStore.getState().record(input);
  } catch {
    // Best-effort transparency only; never break the primary action.
  }
}
