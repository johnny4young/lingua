import type { StoreApi } from 'zustand';
import type { EditorState } from '../types';

/**
 * RL-128 — shared store-binding types for the editor action factories.
 *
 * `editorStore.ts` was split into focused modules; the per-tab action setters
 * now live in `editor*Actions.ts` files as factories of the form
 * `createXActions(set, get) => Pick<EditorState, …>`. These aliases give every
 * factory the exact zustand `set` / `get` signatures the `create()` callback
 * receives, so the extracted actions behave identically to when they were
 * inline (same partial-update + replace semantics, same `get()` reads).
 */

/** zustand `set` for the editor store — same overloads `create()` passes in. */
export type EditorSet = StoreApi<EditorState>['setState'];

/** zustand `get` for the editor store — returns the fully-assembled state. */
export type EditorGet = StoreApi<EditorState>['getState'];
