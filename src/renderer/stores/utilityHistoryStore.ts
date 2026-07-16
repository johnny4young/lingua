import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import i18next from 'i18next';
import { createMigrate } from './persistence/migrationRegistry';
import {
  DEFAULT_DEVELOPER_UTILITY_ID,
  DEVELOPER_UTILITIES,
  type DeveloperUtilityId,
} from '../data/developerUtilities';
import { currentEffectiveTier } from './licenseSelectors';
import { isEntitled } from '../../shared/entitlements';
import { pushUpsellNotice } from '../utils/upsellNotice';

/**
 * RL-069 Slice 3 — Per-tool history + favorites store.
 *
 * Lives in a dedicated localStorage namespace (`lingua-utility-state`)
 * separated from `lingua-settings`. Reasoning:
 *   1. Settings rehydrates on every boot and is read-heavy; mixing in
 *      a per-tool history map (potentially 29 tools * 10 entries) bloats
 *      every Settings save and risks tripping the localStorage quota.
 *   2. Favorites + history have their own atomic clear UX ("Clear all
 *      utility history") that should not interact with the user's
 *      Settings.
 *   3. The shape evolves at a different cadence than Settings —
 *      keeping it isolated keeps the merge / sanitize logic small.
 *
 * Persistence rules:
 *   - `favorites` always persists (a pin is a deliberate user action).
 *   - `persistEnabled` and `history` only persist for Pro/paid tiers
 *     that grant DEV_UTILITIES. Free users still get session history
 *     and favorites, but the workflow/persistence layer is not saved
 *     across reloads.
 *   - Within Pro, `history` only persists for tools where
 *     `persistEnabled[id]` is true. Session-scoped entries for other
 *     tools are dropped on reload via `partialize`.
 *
 * Caps (Suggested change F):
 *   - `MAX_ENTRIES_PER_TOOL = 10` — FIFO eviction.
 *   - `MAX_BYTES_PER_ENTRY = 16_384` — 16KB cap per input/output pair
 *     so a single accidental paste of a huge payload cannot eat the
 *     whole tool's history budget. Truncates with an ellipsis suffix.
 *   - `MAX_BYTES_PERSISTED = 256_000` — 256KB total persisted budget.
 *     If exceeded the persist middleware's set throws on
 *     QuotaExceededError; we catch by trimming the lowest-priority
 *     tools first (oldest entries across all tools).
 */

export const UTILITY_HISTORY_STORAGE_KEY = 'lingua-utility-state';
export const MAX_ENTRIES_PER_TOOL = 10;
export const MAX_BYTES_PER_ENTRY = 16_384;
export const MAX_BYTES_PERSISTED = 256_000;

const TEXT_ENCODER = new TextEncoder();
const TRUNCATION_SUFFIX = '…';
const TRUNCATION_SUFFIX_BYTES = byteLength(TRUNCATION_SUFFIX);

export interface UtilityHistoryEntry {
  /** Monotonic id used for React keys and dedupe checks. */
  id: string;
  /** ISO 8601 timestamp. */
  at: string;
  /** Truncated input snapshot (≤ MAX_BYTES_PER_ENTRY). */
  input: string;
  /** Truncated output snapshot (≤ MAX_BYTES_PER_ENTRY). Empty for failures. */
  output: string;
  /** Whether the input or output was clipped to fit the cap. */
  truncated: boolean;
}

/** IT2-F4 — a one-shot input seed for a utility panel. */
export interface PendingUtilityInput {
  utilityId: DeveloperUtilityId;
  input: string;
}

export interface UtilityHistoryState {
  /** Per-tool ring buffer, newest first. */
  history: Partial<Record<DeveloperUtilityId, UtilityHistoryEntry[]>>;
  /** Per-tool persistence opt-in. Default false (session-scoped). */
  persistEnabled: Partial<Record<DeveloperUtilityId, boolean>>;
  /** Pinned tools, in user-defined order. */
  favorites: DeveloperUtilityId[];
  /** Currently selected tool in the full-screen Utilities workspace. */
  activeUtilityId: DeveloperUtilityId;
  /**
   * IT2-F4 — one-shot input handed from the smart-paste router to the
   * target panel (`usePendingUtilityInput` consumes and clears it).
   * Session-only by design: it is NOT in `partialize`, so a pending
   * paste never survives a reload.
   */
  pendingUtilityInput: PendingUtilityInput | null;

  pushEntry: (toolId: DeveloperUtilityId, input: string, output: string) => void;
  clearHistory: (toolId?: DeveloperUtilityId) => void;
  togglePersist: (toolId: DeveloperUtilityId) => void;

  pinFavorite: (toolId: DeveloperUtilityId) => void;
  unpinFavorite: (toolId: DeveloperUtilityId) => void;
  reorderFavorites: (next: DeveloperUtilityId[]) => void;
  isFavorite: (toolId: DeveloperUtilityId) => boolean;
  setActiveUtilityId: (toolId: DeveloperUtilityId) => void;
  setPendingUtilityInput: (pending: PendingUtilityInput | null) => void;
}

function byteLength(value: string): number {
  return TEXT_ENCODER.encode(value).byteLength;
}

function truncate(value: string): { value: string; truncated: boolean } {
  if (byteLength(value) <= MAX_BYTES_PER_ENTRY) {
    return { value, truncated: false };
  }

  const maxPayloadBytes = Math.max(0, MAX_BYTES_PER_ENTRY - TRUNCATION_SUFFIX_BYTES);
  let bytes = 0;
  let endIndex = 0;
  for (const chunk of value) {
    const nextBytes = byteLength(chunk);
    if (bytes + nextBytes > maxPayloadBytes) break;
    bytes += nextBytes;
    endIndex += chunk.length;
  }

  return { value: `${value.slice(0, endIndex)}${TRUNCATION_SUFFIX}`, truncated: true };
}

let monotonicEntryId = 0;
function nextEntryId(): string {
  monotonicEntryId += 1;
  return `${Date.now()}-${monotonicEntryId}`;
}

const KNOWN_UTILITY_IDS = new Set<DeveloperUtilityId>(
  DEVELOPER_UTILITIES.map(utility => utility.id)
);

function isKnownUtilityId(value: unknown): value is DeveloperUtilityId {
  return typeof value === 'string' && KNOWN_UTILITY_IDS.has(value as DeveloperUtilityId);
}

function canPersistUtilityWorkflows(): boolean {
  return isEntitled(currentEffectiveTier(), 'DEV_UTILITIES');
}

function notifyUtilityWorkflowsLocked(): void {
  pushUpsellNotice({
    messageKey: 'upsell.freeCeilingReached',
    featureLabel: i18next.t('upsell.feature.utilityWorkflows'),
  });
}

/**
 * Approximate byte count of the persisted slice. The persist middleware
 * stringifies before writing, so the same shape is what eats the quota.
 */
function approximatePersistedBytes(state: {
  history: UtilityHistoryState['history'];
  persistEnabled: UtilityHistoryState['persistEnabled'];
  favorites: UtilityHistoryState['favorites'];
}): number {
  try {
    return byteLength(JSON.stringify(state));
  } catch {
    return 0;
  }
}

export const useUtilityHistoryStore = create<UtilityHistoryState>()(
  persist(
    (set, get) => ({
      history: {},
      persistEnabled: {},
      favorites: [],
      activeUtilityId: DEFAULT_DEVELOPER_UTILITY_ID,
      pendingUtilityInput: null,

      pushEntry: (toolId, input, output) => {
        const inputCapped = truncate(input);
        const outputCapped = truncate(output);
        const entry: UtilityHistoryEntry = {
          id: nextEntryId(),
          at: new Date().toISOString(),
          input: inputCapped.value,
          output: outputCapped.value,
          truncated: inputCapped.truncated || outputCapped.truncated,
        };
        set(state => {
          const previous = state.history[toolId] ?? [];
          // Avoid duplicate consecutive entries — re-pressing Apply on
          // the same input shouldn't bloat the ring with N copies.
          if (
            previous.length > 0 &&
            previous[0]!.input === entry.input &&
            previous[0]!.output === entry.output
          ) {
            return state;
          }
          const next = [entry, ...previous].slice(0, MAX_ENTRIES_PER_TOOL);
          return {
            history: { ...state.history, [toolId]: next },
          };
        });
      },

      clearHistory: toolId => {
        set(state => {
          if (!toolId) {
            return { history: {} };
          }
          const next = { ...state.history };
          delete next[toolId];
          return { history: next };
        });
      },

      togglePersist: toolId => {
        if (!canPersistUtilityWorkflows()) {
          notifyUtilityWorkflowsLocked();
          return;
        }
        set(state => ({
          persistEnabled: {
            ...state.persistEnabled,
            [toolId]: !state.persistEnabled[toolId],
          },
        }));
      },

      pinFavorite: toolId => {
        set(state => {
          if (state.favorites.includes(toolId)) return state;
          return { favorites: [...state.favorites, toolId] };
        });
      },

      unpinFavorite: toolId => {
        set(state => ({
          favorites: state.favorites.filter(id => id !== toolId),
        }));
      },

      reorderFavorites: next => {
        // Trust callers to pass a valid permutation, but defensively
        // strip any id that's not currently pinned. This guards against
        // a stale drag-and-drop payload referencing a tool that was
        // unpinned mid-drag (rare but observable).
        const allowed = new Set(get().favorites);
        const sanitized = next.filter(id => allowed.has(id) && isKnownUtilityId(id));
        set({ favorites: sanitized });
      },

      isFavorite: toolId => get().favorites.includes(toolId),

      setActiveUtilityId: toolId => {
        if (!isKnownUtilityId(toolId)) return;
        set({ activeUtilityId: toolId });
      },

      setPendingUtilityInput: pending => {
        if (pending && !isKnownUtilityId(pending.utilityId)) return;
        set({ pendingUtilityInput: pending });
      },
    }),
    {
      name: UTILITY_HISTORY_STORAGE_KEY,
      version: 1,
      migrate: createMigrate(UTILITY_HISTORY_STORAGE_KEY),
      storage: createJSONStorage(() => localStorage),
      // Slice 3 — only persist the bits the user explicitly opted into.
      // History is filtered per-tool by `persistEnabled[id]`. Favorites
      // always persist; workflow persistence toggles/history are paid
      // and are stripped while the effective tier is Free.
      partialize: state => {
        if (!canPersistUtilityWorkflows()) {
          return {
            history: {},
            persistEnabled: {},
            favorites: state.favorites,
            activeUtilityId: state.activeUtilityId,
          };
        }
        const persistedHistory: UtilityHistoryState['history'] = {};
        for (const [toolId, entries] of Object.entries(state.history)) {
          if (state.persistEnabled[toolId as DeveloperUtilityId]) {
            persistedHistory[toolId as DeveloperUtilityId] = entries;
          }
        }
        const candidate = {
          history: persistedHistory,
          persistEnabled: state.persistEnabled,
          favorites: state.favorites,
          activeUtilityId: state.activeUtilityId,
        };
        // Trim oldest entries across all tools until the budget fits.
        let bytes = approximatePersistedBytes(candidate);
        while (bytes > MAX_BYTES_PERSISTED) {
          // Find the tool with the oldest last entry and drop one entry.
          let oldestToolId: DeveloperUtilityId | null = null;
          let oldestAt = Infinity;
          for (const [toolId, entries] of Object.entries(candidate.history)) {
            const last = entries[entries.length - 1];
            if (!last) continue;
            const t = Date.parse(last.at);
            if (t < oldestAt) {
              oldestAt = t;
              oldestToolId = toolId as DeveloperUtilityId;
            }
          }
          if (!oldestToolId) break;
          const entries = candidate.history[oldestToolId]!;
          if (entries.length <= 1) {
            delete candidate.history[oldestToolId];
          } else {
            candidate.history[oldestToolId] = entries.slice(0, -1);
          }
          bytes = approximatePersistedBytes(candidate);
        }
        return candidate;
      },
      // The merge happens once on rehydrate. We defensively coerce
      // unknown ids out of `favorites` so an older catalog version that
      // shipped a different id can't break the modal — an id that no
      // longer maps to a panel is silently dropped.
      merge: (persisted, current) => {
        if (!persisted || typeof persisted !== 'object') return current;
        const candidate = persisted as Partial<UtilityHistoryState>;
        return {
          ...current,
          history: candidate.history ?? {},
          persistEnabled: candidate.persistEnabled ?? {},
          favorites: Array.isArray(candidate.favorites)
            ? candidate.favorites.filter(isKnownUtilityId)
            : [],
          activeUtilityId: isKnownUtilityId(candidate.activeUtilityId)
            ? candidate.activeUtilityId
            : DEFAULT_DEVELOPER_UTILITY_ID,
        };
      },
    }
  )
);
