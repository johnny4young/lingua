/**
 * Renderer settings store — assembly point (RL-129 / AUDIT-09).
 *
 * This is the long-lived `lingua-settings` localStorage boundary, so the store
 * treats every rehydrated value as untrusted user-controlled input. Runtime
 * setters reject invalid enum values at call time, while the imported
 * `settingsMerge` repeats those guards for hand-edited localStorage, stale
 * profile imports, and forward-version drift. Fields that affect privacy or
 * telemetry are persisted as explicit user choices; telemetry events emitted by
 * setters are adoption signals only and rely on `trackEvent` for consent
 * enforcement.
 *
 * The former 1092-line monolith was carved into focused modules with ZERO public
 * API change; this file just wires them together:
 *
 *   - `settingsStoreContext`     — shared `SettingsSet` / `SettingsGet` types
 *   - `settingsDefaults`         — seed consts + `createInitialSettingsState()`
 *   - `settingsSanitizers`       — rehydrate/runtime value narrowing
 *   - `settingsMerge`            — the persist `merge` rehydrate sanitizer
 *   - `settingsPersistence`      — `partialize` + `syncConsentMirror`
 *   - `settings{Appearance,Runtime,Privacy,Session}Actions` — setter factories
 *
 * The action factories each take the zustand `(set[, get])` and return a disjoint
 * slice of `SettingsState`; spreading them alongside `createInitialSettingsState()`
 * reproduces the original single object literal exactly. The `sanitizeShortcutOverrides`
 * re-export keeps the profile-import consumer's import path unchanged.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SettingsState } from '../types';
import { createMigrate } from './persistence/migrationRegistry';
import { createInitialSettingsState } from './settingsDefaults';
import { settingsPartialize, syncConsentMirror } from './settingsPersistence';
import { settingsMerge } from './settingsMerge';
import { createAppearanceActions } from './settingsAppearanceActions';
import { createRuntimeActions } from './settingsRuntimeActions';
import { createPrivacyActions } from './settingsPrivacyActions';
import { createSessionActions } from './settingsSessionActions';

/**
 * Single renderer source of truth for user preferences. The persist wrapper is
 * deliberately explicit: `partialize` lists every durable field and `merge`
 * sanitizes every persisted map/enum before the live store sees it.
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...createInitialSettingsState(),
      ...createAppearanceActions(set),
      ...createRuntimeActions(set, get),
      ...createPrivacyActions(set),
      ...createSessionActions(set),
    }),
    {
      name: 'lingua-settings',
      // RL-126 / AUDIT-06 — schema version + central migration. The 0->1 step
      // is identity (no shape change yet); the existing onRehydrate/merge
      // sanitizers still run after migrate. RL-111 added the 1->2 step
      // (restoreSession boolean -> restoreSessionMode enum) in
      // migrationRegistry; bump here in lockstep.
      version: 2,
      migrate: createMigrate('lingua-settings'),
      partialize: settingsPartialize,
      merge: settingsMerge,
      onRehydrateStorage: () => (state) => {
        if (!state) {
          return;
        }
        // Seed/refresh the main-process mirror after every startup
        // rehydrate so pre-existing opt-ins survive the upgrade to the
        // RL-067 mirror path without forcing the user to toggle again.
        syncConsentMirror(state.telemetryConsent);
      },
    }
  )
);

// Public API re-export — unchanged import path for the profile-import consumer.
export { sanitizeShortcutOverrides } from './settingsSanitizers';
