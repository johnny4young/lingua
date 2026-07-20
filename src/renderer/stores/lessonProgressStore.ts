/**
 * implementation Slice B implementation note — Persisted recipe progress store.
 *
 * Tracks which recipes the user has opened / attempted / passed /
 * skipped, so the overlay can sort by recent activity and the
 * sidebar badge (implementation note) can show a `passed / total` counter. Lives
 * on its own isolated localStorage key (`lingua-lesson-progress`) so
 * a Settings reset doesn't wipe progress, and a "Reset recipe
 * progress" click (implementation note) doesn't touch `lingua-settings`.
 *
 * Shape parity with `utilityPipelineStore` + `workspaceToolStore`:
 *
 *   - CRUD via `recordOpened` / `recordRun` / `markSkipped`.
 *   - LRU cap (`LESSON_PROGRESS_CAP = 200`) bounds storage growth.
 *   - Sanitize-on-rehydrate drops invalid entries silently so a
 *     hand-edited localStorage cannot brick the badge or the
 *     overlay.
 *
 * Privacy posture:
 *
 *   - Progress entries hold only the recipeId, a closed-enum status,
 *     a timestamp, and a small counter. NO user code, NO assertion
 *     details, NO output bytes.
 *   - The catalog recipeId is a public string; it never reaches the
 *     telemetry wire (`recipe.opened` / `recipe.test_run` carry
 *     `language` only, implementation note in the plan).
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createMigrate } from './persistence/migrationRegistry';

export const LESSON_PROGRESS_CAP = 200;

export const LESSON_PROGRESS_STATUSES = [
  'opened',
  'attempted',
  'passed',
  'skipped',
] as const;
export type LessonProgressStatus = (typeof LESSON_PROGRESS_STATUSES)[number];

export interface LessonProgressEntryV1 {
  readonly recipeId: string;
  readonly status: LessonProgressStatus;
  readonly lastSeenAt: string;
  readonly attemptCount: number;
  readonly lastResult?: { readonly passed: number; readonly total: number };
}

export interface LessonProgressState {
  readonly entries: Readonly<Record<string, LessonProgressEntryV1>>;

  // -------- mutations -----------------------------------------------------

  /** First-open or repeat-open of a recipe (status `'opened'` unless already attempted/passed). */
  recordOpened: (recipeId: string) => void;
  /** Run + Test completed — store the attempted/passed status + assertion counts. */
  recordRun: (
    recipeId: string,
    summary: { readonly passed: number; readonly total: number }
  ) => void;
  /** User explicitly skips a recipe — sticky `'skipped'` (doesn't decay). */
  markSkipped: (recipeId: string) => void;
  /** Reset a single recipe (drop the entry). */
  resetRecipe: (recipeId: string) => void;
  /** implementation note — wipe the whole progress map. Used by Settings → Reset recipe progress. */
  resetAll: () => void;

  // -------- selectors -----------------------------------------------------

  /** Look up an entry; undefined when missing. */
  getEntry: (recipeId: string) => LessonProgressEntryV1 | undefined;
  /** Convenience — count of recipes the user has fully passed. */
  passedCount: () => number;
  /** Convenience — count of recipes the user has any history with. */
  touchedCount: () => number;
}

function createInitialState(): Pick<LessonProgressState, 'entries'> {
  return { entries: {} };
}

function isLessonProgressStatus(value: unknown): value is LessonProgressStatus {
  return (
    typeof value === 'string' &&
    (LESSON_PROGRESS_STATUSES as readonly string[]).includes(value)
  );
}

function isValidLessonEntry(value: unknown): value is LessonProgressEntryV1 {
  if (value === null || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.recipeId !== 'string' || obj.recipeId.length === 0) return false;
  if (!isLessonProgressStatus(obj.status)) return false;
  if (typeof obj.lastSeenAt !== 'string') return false;
  if (!Number.isFinite(Date.parse(obj.lastSeenAt))) return false;
  if (typeof obj.attemptCount !== 'number') return false;
  if (
    !Number.isFinite(obj.attemptCount) ||
    !Number.isInteger(obj.attemptCount) ||
    obj.attemptCount < 0
  ) {
    return false;
  }
  if (obj.lastResult !== undefined) {
    if (obj.lastResult === null || typeof obj.lastResult !== 'object') return false;
    const lr = obj.lastResult as Record<string, unknown>;
    if (typeof lr.passed !== 'number' || typeof lr.total !== 'number') return false;
    if (!Number.isFinite(lr.passed) || !Number.isFinite(lr.total)) return false;
    if (!Number.isInteger(lr.passed) || !Number.isInteger(lr.total)) return false;
    if (lr.passed < 0 || lr.total < 0 || lr.passed > lr.total) return false;
  }
  return true;
}

/**
 * If the entries map exceeds the cap after a write, drop the oldest
 * `lastSeenAt` entries until back under cap. Stable ordering — newest
 * `lastSeenAt` survives.
 */
function enforceCap(
  entries: Record<string, LessonProgressEntryV1>
): Record<string, LessonProgressEntryV1> {
  const keys = Object.keys(entries);
  if (keys.length <= LESSON_PROGRESS_CAP) return entries;
  const sorted = keys
    .map((id) => ({ id, ts: entries[id]?.lastSeenAt ?? '' }))
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  const drop = sorted.slice(0, keys.length - LESSON_PROGRESS_CAP);
  const next = { ...entries };
  for (const { id } of drop) {
    delete next[id];
  }
  return next;
}

export const useLessonProgressStore = create<LessonProgressState>()(
  persist(
    (set, get) => ({
      ...createInitialState(),

      recordOpened: (recipeId) => {
        if (typeof recipeId !== 'string' || recipeId.length === 0) return;
        set((state) => {
          const now = new Date().toISOString();
          const prior = state.entries[recipeId];
          // If the user already attempted / passed / skipped this
          // recipe, don't downgrade their status on a re-open.
          const status: LessonProgressStatus =
            prior?.status === 'passed' ||
            prior?.status === 'attempted' ||
            prior?.status === 'skipped'
              ? prior.status
              : 'opened';
          const entry: LessonProgressEntryV1 = {
            recipeId,
            status,
            lastSeenAt: now,
            attemptCount: prior?.attemptCount ?? 0,
            ...(prior?.lastResult ? { lastResult: prior.lastResult } : {}),
          };
          return { entries: enforceCap({ ...state.entries, [recipeId]: entry }) };
        });
      },

      recordRun: (recipeId, summary) => {
        if (typeof recipeId !== 'string' || recipeId.length === 0) return;
        if (
          !Number.isFinite(summary.passed) ||
          !Number.isFinite(summary.total) ||
          summary.passed < 0 ||
          summary.total < 0 ||
          summary.passed > summary.total ||
          !Number.isInteger(summary.passed) ||
          !Number.isInteger(summary.total)
        ) {
          return;
        }
        set((state) => {
          const now = new Date().toISOString();
          const prior = state.entries[recipeId];
          // Promote to `'passed'` only when every assertion passes.
          // Keep `'passed'` sticky — a follow-up failing run does NOT
          // demote back to `'attempted'`. The lastResult is still
          // updated so the badge shows the most recent score.
          const status: LessonProgressStatus =
            summary.total > 0 && summary.passed === summary.total
              ? 'passed'
              : prior?.status === 'passed'
                ? 'passed'
                : 'attempted';
          const entry: LessonProgressEntryV1 = {
            recipeId,
            status,
            lastSeenAt: now,
            attemptCount: (prior?.attemptCount ?? 0) + 1,
            lastResult: { passed: summary.passed, total: summary.total },
          };
          return { entries: enforceCap({ ...state.entries, [recipeId]: entry }) };
        });
      },

      markSkipped: (recipeId) => {
        if (typeof recipeId !== 'string' || recipeId.length === 0) return;
        set((state) => {
          const now = new Date().toISOString();
          const prior = state.entries[recipeId];
          if (prior?.status === 'passed') return state; // Don't downgrade.
          const entry: LessonProgressEntryV1 = {
            recipeId,
            status: 'skipped',
            lastSeenAt: now,
            attemptCount: prior?.attemptCount ?? 0,
            ...(prior?.lastResult ? { lastResult: prior.lastResult } : {}),
          };
          return { entries: enforceCap({ ...state.entries, [recipeId]: entry }) };
        });
      },

      resetRecipe: (recipeId) =>
        set((state) => {
          if (!state.entries[recipeId]) return state;
          const next = { ...state.entries };
          delete next[recipeId];
          return { entries: next };
        }),

      resetAll: () => set({ entries: {} }),

      getEntry: (recipeId) => get().entries[recipeId],
      passedCount: () => {
        const { entries } = get();
        let n = 0;
        for (const key in entries) {
          if (entries[key]?.status === 'passed') n += 1;
        }
        return n;
      },
      touchedCount: () => Object.keys(get().entries).length,
    }),
    {
      name: 'lingua-lesson-progress',
      version: 1,
      migrate: createMigrate('lingua-lesson-progress'),
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ entries: state.entries }),
      merge: (persisted, current) => {
        const merged = { ...current };
        if (
          persisted &&
          typeof persisted === 'object' &&
          !Array.isArray(persisted)
        ) {
          const p = persisted as Record<string, unknown>;
          if (p.entries && typeof p.entries === 'object' && !Array.isArray(p.entries)) {
            const safe: Record<string, LessonProgressEntryV1> = {};
            for (const [key, value] of Object.entries(
              p.entries as Record<string, unknown>
            )) {
              if (typeof key !== 'string' || key.length === 0) continue;
              if (!isValidLessonEntry(value)) continue;
              // Ensure the persisted recipeId matches the map key —
              // a mismatch means hand-edit, drop it.
              if (value.recipeId !== key) continue;
              safe[key] = value;
            }
            merged.entries = enforceCap(safe);
          }
        }
        return merged;
      },
    }
  )
);

/**
 * Test seam — reset the store to its initial state.
 */
export function resetLessonProgressStoreForTests(): void {
  useLessonProgressStore.setState(createInitialState());
}
