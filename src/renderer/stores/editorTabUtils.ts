import type { FileTab, Language } from '../types';
import { defaultCodeForLanguage, extensionForLanguage } from '../utils/languageMeta';
import { runtimeModeForNewTab, workflowModeForNewTab } from './editorModeHelpers';

/**
 * RL-128 — pure tab helpers extracted verbatim from `editorStore.ts`.
 *
 * This module owns the language-capability droppers (auto-log, stdin, compare,
 * variable inspector, recipe binding, one-shot timeout), notebook-title
 * normalisation, the workspace-tab constants/predicates, the Free tab-budget
 * count, and `createDefaultTab`. Everything here is a pure function over a
 * `FileTab` (or `Language`) — no store reads, no `set`/`get`. It depends only
 * on `editorModeHelpers` (for `createDefaultTab`'s mode seeds) and the
 * language-meta helpers, so it sits below every store-bound module in the
 * import graph.
 *
 * The store frequently strips optional tab fields via object rest
 * destructuring (`const { field: _drop, ...rest } = tab`). The follow-up
 * `void _drop` statements are intentional: they make the omission explicit to
 * TypeScript/ESLint while preserving the runtime shape of the returned object.
 */

export function normalizeNotebookTitle(input: string): string {
  const withoutExtension = input.endsWith('.linguanb')
    ? input.slice(0, -'.linguanb'.length)
    : input;
  return withoutExtension.trim() || 'Untitled notebook';
}

export function notebookFileNameForTitle(title: string): string {
  return `${normalizeNotebookTitle(title)}.linguanb`;
}

export function languageSupportsAutoLog(language: Language): boolean {
  return language === 'javascript' || language === 'typescript';
}

export function dropAutoLogIfUnsupported<T extends FileTab>(tab: T): T {
  if (languageSupportsAutoLog(tab.language)) return tab;
  const { autoLogEnabled: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

/**
 * RL-020 Slice 6 — the worker-side stdin patch ships for the three
 * languages whose runner goes through a worker today: JS / TS via
 * `js-worker.ts` and Python via `python-worker.ts`. Go / Rust runners
 * are WASM-based (Go) or compile-and-run on the host; threading
 * stdin into those is a follow-up because the patch surface is
 * different.
 */
export function languageSupportsStdin(language: Language): boolean {
  return language === 'javascript' || language === 'typescript' || language === 'python';
}

export function dropStdinIfUnsupported<T extends FileTab>(tab: T): T {
  if (languageSupportsStdin(tab.language)) return tab;
  const { stdinBuffer: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

/**
 * RL-020 Slice 7 fold D — drop the per-tab one-shot extended
 * timeout when the tab no longer points at the code the user was
 * inspecting. Rename to a different language is the canonical case:
 * the user pressed "Run with extended timeout" while looking at a
 * JS buffer; renaming the tab to Go shouldn't silently apply the
 * one-shot to the next Go run. Cleared in `renameTab` and on
 * Save-As (`persistTab`) too, alongside the symmetric autoLog +
 * stdin drops.
 */
export function dropNextRunTimeoutOverride<T extends FileTab>(tab: T): T {
  if (tab.nextRunTimeoutOverrideMs === undefined) return tab;
  const { nextRunTimeoutOverrideMs: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

/**
 * RL-020 Slice 8 — drop the per-tab Compare flag whenever the
 * language changes (rename / Save-As). The comparator snapshot is
 * tracked by the result store; the editor-store side just owns the
 * toggle bit. Symmetric to `dropAutoLogIfUnsupported` /
 * `dropStdinIfUnsupported`.
 */
export function dropCompareIfLanguageChanged<T extends FileTab>(
  tab: T,
  previousLanguage: Language | null
): T {
  if (previousLanguage === null || tab.language === previousLanguage) return tab;
  if (tab.compareWithSnapshotEnabled === undefined) return tab;
  const { compareWithSnapshotEnabled: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

/**
 * RL-039 Slice B — set of languages a recipe can run against. Slice
 * B is JS-only; Slice C+ widens. A rename / Save-As that moves a
 * recipe-bound tab outside this set drops the binding so the bottom
 * panel `'recipe'` tab + the FloatingActionPill recipes badge stop
 * surfacing stale state. Mirrors `dropAutoLogIfUnsupported` /
 * `dropCompareIfLanguageChanged`.
 */
export const RECIPE_BINDING_SUPPORTED_LANGUAGES: ReadonlySet<Language> = new Set(['javascript']);

export function dropRecipeBindingIfLanguageChanged<T extends FileTab>(
  tab: T,
  previousLanguage: Language | null
): T {
  if (previousLanguage === null || tab.language === previousLanguage) return tab;
  if (tab.recipeBindingId === undefined) return tab;
  if (RECIPE_BINDING_SUPPORTED_LANGUAGES.has(tab.language)) return tab;
  const { recipeBindingId: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

/**
 * RL-020 Slice 9 — set of languages the variable inspector
 * captures for. Renames / Save-As to a language outside this set
 * drops the per-tab inspector flag.
 */
export const VARIABLE_INSPECTOR_SUPPORTED_LANGUAGES: ReadonlySet<Language> = new Set([
  'javascript',
  'typescript',
  'python',
]);

export function isVariableInspectorSupportedLanguage(language: Language): boolean {
  return VARIABLE_INSPECTOR_SUPPORTED_LANGUAGES.has(language);
}

/**
 * RL-020 Slice 9 — drop the per-tab variable inspector flag when
 * the rename / Save-As lands on a language outside the supported
 * set. The scope snapshot itself is tracked by the result store;
 * this helper only owns the toggle bit.
 */
export function dropVariableInspectorIfLanguageChanged<T extends FileTab>(
  tab: T,
  previousLanguage: Language | null
): T {
  if (previousLanguage === null || tab.language === previousLanguage) return tab;
  if (tab.variableInspectorEnabled === undefined) return tab;
  if (isVariableInspectorSupportedLanguage(tab.language)) return tab;
  const { variableInspectorEnabled: _drop, ...rest } = tab;
  void _drop;
  return rest as T;
}

/**
 * SQL/HTTP MODEL rework — the SQL and HTTP surfaces are COLLECTION
 * workspaces, not one-editor-tab-per-query. There is at most ONE SQL
 * workspace tab and ONE HTTP workspace tab, each carrying a STABLE
 * constant id so session restore and focus-or-create are idempotent.
 * The collection of queries / requests lives in `useWorkspaceSqlStore`
 * / `useWorkspaceToolStore` and is navigated by the in-panel rail
 * (`activeQueryId` / `activeRequestId`); the tab no longer maps to a
 * single query/request id.
 */
export const SQL_WORKSPACE_TAB_ID = 'lingua:workspace:sql';
export const HTTP_WORKSPACE_TAB_ID = 'lingua:workspace:http';
export const UTILITIES_WORKSPACE_TAB_ID = 'lingua:workspace:utilities';

/**
 * Display names for the workspace tabs. The tab strip shows the
 * SQL / HTTP / Utilities glyph + this name, never a single query/request name.
 */
export const SQL_WORKSPACE_TAB_NAME = 'SQL';
export const HTTP_WORKSPACE_TAB_NAME = 'HTTP';
export const UTILITIES_WORKSPACE_TAB_NAME = 'Utilities';

/**
 * A SQL / HTTP / Utilities workspace tab is the container for a whole collection,
 * not a single document, so it is EXEMPT from the RL-060 Free tab
 * budget — a Free user always gets the workspaces. Only
 * non-workspace tabs (code + notebook) count toward the ceiling.
 */
export function isWorkspaceTab(tab: Pick<FileTab, 'kind'>): boolean {
  return tab.kind === 'sql' || tab.kind === 'http' || tab.kind === 'utilities';
}

/**
 * Count only the tabs that consume the Free tab budget — workspace
 * tabs (SQL / HTTP / Utilities) are exempt. Callers add the proposed new tab
 * themselves before comparing against `withinTabBudget`.
 */
export function budgetedTabCount(tabs: ReadonlyArray<FileTab>): number {
  return tabs.reduce((acc, tab) => (isWorkspaceTab(tab) ? acc : acc + 1), 0);
}

export const createDefaultTab = (language: Language = 'javascript'): FileTab => {
  const id = crypto.randomUUID();
  const short = id.slice(0, 8);
  // RL-019 Slice 1 — JS/TS tabs adopt the per-app default mode (fold
  // B). Non-JS/TS tabs deliberately omit the field.
  const runtimeMode = runtimeModeForNewTab(language);
  // RL-020 Slice 2 — every tab carries an explicit workflow mode so
  // the toolbar segmented control and `useAutoRun` short-circuit
  // both have a single source of truth. Language-specific defaults
  // come from `settingsStore.workflowModeDefaultsByLanguage` (when
  // the user has overridden the shared helper) or the
  // `defaultWorkflowMode` shared helper.
  const workflowMode = workflowModeForNewTab(language);
  return {
    id,
    name: `untitled-${short}.${extensionForLanguage(language)}`,
    language,
    content: defaultCodeForLanguage(language),
    isDirty: false,
    runtimeMode,
    workflowMode,
  };
};
