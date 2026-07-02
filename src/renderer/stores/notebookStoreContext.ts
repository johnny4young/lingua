import type { StoreApi } from 'zustand';
import type { NotebookState } from './notebookStore';

/**
 * T9 — shared store-binding types for the notebook action factories.
 *
 * `notebookStore.ts` was split into focused modules; the per-tab action
 * setters + selectors now live in `notebook*Actions.ts` / `notebookSelectors.ts`
 * files as factories of the form `createX(set, get) => Pick<NotebookState, …>`.
 * These aliases give every factory the exact zustand `set` / `get` signatures
 * the `create()` callback receives, so the extracted actions behave identically
 * to when they were inline (same partial-update semantics, same `get()` reads).
 * Mirrors `editorStoreContext.ts`.
 */

/** zustand `set` for the notebook store — same overloads `create()` passes in. */
export type NotebookSet = StoreApi<NotebookState>['setState'];

/** zustand `get` for the notebook store — returns the fully-assembled state. */
export type NotebookGet = StoreApi<NotebookState>['getState'];
