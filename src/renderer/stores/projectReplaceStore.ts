/**
 * RL-024 Slice 2 — project replace store.
 *
 * Mirrors the shape of `useProjectSearchStore` but adds:
 *
 *   - A `replacement` query alongside the search `query`.
 *   - Per-match `replacement` + `replacedPreview` so the overlay can
 *     render a before/after diff inline (no client-side regex
 *     substitution; main provides both).
 *   - `applyToFile(relativePath)` + `applyToAll()` actions that
 *     dispatch through the IPC bridge. Apply queue progress (fold A)
 *     surfaces via `applyProgress: { done, total } | null`.
 *   - Regex + case-sensitive toggles. Fold C — cooperative cancel
 *     is enforced main-side via `perLineTimeoutMs`.
 *
 * Store actions are isolated so the overlay can subscribe to the
 * slice it needs (preview list, progress strip, apply queue) without
 * forcing a re-render on every keystroke.
 */

import { create } from 'zustand';
import i18next from 'i18next';
import { asRelativePath, asRootId } from '../../shared/fs/brandedIds';

export type ProjectReplaceStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProjectReplaceMatch {
  readonly line: number;
  readonly column: number;
  readonly preview: string;
  readonly matchStart: number;
  readonly matchEnd: number;
  /** The full line after substitution (windowed for display). */
  readonly replacedPreview: string;
  /** The substituted text for THIS match only (Monaco edit payload). */
  readonly replacement: string;
}

export interface ProjectReplaceResult {
  readonly relativePath: string;
  readonly matches: readonly ProjectReplaceMatch[];
  /**
   * RL-024 Slice 2 fold C — file was skipped during preview because
   * the regex deadline fired. The overlay marks the row with a
   * "regex took too long" notice and excludes it from apply-to-all.
   */
  readonly regexTimedOut?: boolean;
}

/**
 * RL-024 Slice 2 fold A — apply-to-all progress strip. `null` when
 * idle; otherwise the overlay renders a thin progress bar with
 * `done / total files`. The strip persists for a brief moment after
 * completion so the user sees the final count.
 */
export interface ProjectReplaceProgress {
  readonly done: number;
  readonly total: number;
}

interface ProjectReplaceState {
  readonly query: string;
  readonly replacement: string;
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  readonly rootId: string | null;
  readonly status: ProjectReplaceStatus;
  readonly results: readonly ProjectReplaceResult[];
  readonly totalMatches: number;
  readonly error: string | null;
  readonly requestId: number;
  /** Names currently being applied (apply-to-file or apply-to-all). */
  readonly applying: ReadonlySet<string>;
  readonly applyProgress: ProjectReplaceProgress | null;

  setQuery: (query: string) => void;
  setReplacement: (replacement: string) => void;
  setRegex: (regex: boolean) => void;
  setCaseSensitive: (caseSensitive: boolean) => void;
  preview: (rootId: string) => Promise<void>;
  applyToFile: (
    relativePath: string,
    options?: { readonly via?: 'ipc' | 'monaco' }
  ) => Promise<{ ok: boolean; replaced: number }>;
  applyToAll: () => Promise<{ ok: number; failed: number; replaced: number }>;
  clear: () => void;
}

function sumMatches(
  results: readonly ProjectReplaceResult[]
): number {
  return results.reduce(
    (total, result) => total + result.matches.length,
    0
  );
}

function userFacingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('unknown-root')) {
    return i18next.t('fs.error.unknownRoot');
  }
  if (message.includes('escapes-root') || message.includes('unsafe-path')) {
    return i18next.t('fs.error.escapesRoot');
  }
  return message;
}

export const useProjectReplaceStore = create<ProjectReplaceState>(
  (set, get) => ({
    query: '',
    replacement: '',
    regex: false,
    caseSensitive: false,
    rootId: null,
    status: 'idle',
    results: [],
    totalMatches: 0,
    error: null,
    requestId: 0,
    applying: new Set<string>(),
    applyProgress: null,

    setQuery: (query) => set({ query }),
    setReplacement: (replacement) => set({ replacement }),
    setRegex: (regex) => set({ regex }),
    setCaseSensitive: (caseSensitive) => set({ caseSensitive }),

    preview: async (rootId) => {
      const { query, replacement, regex, caseSensitive } = get();
      const searchText = query;
      // RL-024 Slice 2 reviewer pass — every fast-path return must
      // bump `requestId` too. Otherwise, an in-flight non-empty
      // query's late response would still match the current
      // `requestId` and overwrite this freshly-cleared idle state
      // with stale results.
      if (searchText.length === 0) {
        set({
          rootId,
          status: 'idle',
          results: [],
          totalMatches: 0,
          error: null,
          requestId: get().requestId + 1,
        });
        return;
      }

      const replaceInFiles = window.lingua?.fs?.replaceInFiles;
      if (!replaceInFiles) {
        set({
          rootId,
          status: 'ready',
          results: [],
          totalMatches: 0,
          error: null,
          requestId: get().requestId + 1,
        });
        return;
      }

      const requestId = get().requestId + 1;
      set({ rootId, status: 'loading', error: null, requestId });

      try {
        const results = await replaceInFiles(
          asRootId(rootId),
          asRelativePath(''),
          searchText,
          replacement,
          { regex, caseSensitive }
        );
        if (get().requestId !== requestId) return;
        const projectResults: ProjectReplaceResult[] = results.map(
          (result) => ({
            relativePath: result.relativePath,
            matches: result.matches.map((match) => ({
              line: match.line,
              column: match.column,
              preview: match.preview,
              matchStart: match.matchStart,
              matchEnd: match.matchEnd,
              replacedPreview: match.replacedPreview,
              replacement: match.replacement,
            })),
            ...(result.regexTimedOut ? { regexTimedOut: true } : {}),
          })
        );
        set({
          status: 'ready',
          results: projectResults,
          totalMatches: sumMatches(projectResults),
          error: null,
        });
      } catch (err) {
        if (get().requestId !== requestId) return;
        set({
          status: 'error',
          results: [],
          totalMatches: 0,
          error: userFacingError(err),
        });
      }
    },

    applyToFile: async (relativePath, options) => {
      const { rootId, query, replacement, regex, caseSensitive, applying } =
        get();
      if (!rootId || query.length === 0) {
        return { ok: false, replaced: 0 };
      }
      if (applying.has(relativePath)) {
        return { ok: false, replaced: 0 };
      }
      const nextApplying = new Set(applying);
      nextApplying.add(relativePath);
      set({ applying: nextApplying });

      let outcome: { ok: boolean; replaced: number };
      try {
        if (options?.via === 'monaco') {
          // The caller is responsible for applying the Monaco edit;
          // the store only tracks the apply set. The caller reports
          // replaced count back through this branch.
          outcome = { ok: true, replaced: 0 };
        } else {
          const applyReplaceInFile =
            window.lingua?.fs?.applyReplaceInFile;
          if (!applyReplaceInFile) {
            outcome = { ok: false, replaced: 0 };
          } else {
            const result = await applyReplaceInFile(
              asRootId(rootId),
              asRelativePath(relativePath),
              query,
              replacement,
              { regex, caseSensitive }
            );
            outcome = { ok: result.ok, replaced: result.replaced };
          }
        }
      } catch {
        outcome = { ok: false, replaced: 0 };
      }

      // Remove from preview when applied successfully so the user
      // sees the row disappear (matches no longer exist on disk).
      set((state) => {
        const stillApplying = new Set(state.applying);
        stillApplying.delete(relativePath);
        const trimmedResults = outcome.ok
          ? state.results.filter((r) => r.relativePath !== relativePath)
          : state.results;
        return {
          applying: stillApplying,
          results: trimmedResults,
          totalMatches: sumMatches(trimmedResults),
        };
      });
      return outcome;
    },

    applyToAll: async () => {
      const { results } = get();
      const eligible = results.filter(
        (r) => !r.regexTimedOut && r.matches.length > 0
      );
      if (eligible.length === 0) {
        return { ok: 0, failed: 0, replaced: 0 };
      }
      // RL-024 Slice 2 fold A — apply queue progress.
      set({ applyProgress: { done: 0, total: eligible.length } });

      let okCount = 0;
      let failedCount = 0;
      let totalReplaced = 0;

      for (let i = 0; i < eligible.length; i += 1) {
        const entry = eligible[i]!;
        const result = await get().applyToFile(entry.relativePath);
        if (result.ok) {
          okCount += 1;
          totalReplaced += result.replaced;
        } else {
          failedCount += 1;
        }
        set({
          applyProgress: { done: i + 1, total: eligible.length },
        });
      }

      // Hold the strip for ~1s so the user sees the final count.
      setTimeout(() => {
        set((state) =>
          state.applyProgress &&
          state.applyProgress.done === state.applyProgress.total
            ? { applyProgress: null }
            : state
        );
      }, 1000);
      return { ok: okCount, failed: failedCount, replaced: totalReplaced };
    },

    clear: () => {
      set({
        query: '',
        replacement: '',
        regex: false,
        caseSensitive: false,
        rootId: null,
        status: 'idle',
        results: [],
        totalMatches: 0,
        error: null,
        applying: new Set<string>(),
        applyProgress: null,
        requestId: get().requestId + 1,
      });
    },
  })
);
