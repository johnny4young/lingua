import type { StoreApi } from 'zustand';
import type { SettingsState } from '../types';

/**
 * RL-129 — shared store-binding types for the settings action factories.
 *
 * `settingsStore.ts` was split into focused modules; the per-domain setters now
 * live in `settings*Actions.ts` files as factories of the form
 * `createXActions(set[, get]) => Pick<SettingsState, …>`. These aliases give
 * every factory the exact zustand `set` / `get` signatures the persist-wrapped
 * `create()` callback receives, so the extracted setters behave identically to
 * when they were inline (same partial-update semantics, same `get()` reads, same
 * telemetry side-effects). `persist` does not change the consumer-facing
 * `setState` / `getState` shapes, so the `StoreApi` indexed accesses are exact.
 */

/** zustand `set` for the settings store — same overloads the persist creator passes in. */
export type SettingsSet = StoreApi<SettingsState>['setState'];

/** zustand `get` for the settings store — returns the fully-assembled state. */
export type SettingsGet = StoreApi<SettingsState>['getState'];
