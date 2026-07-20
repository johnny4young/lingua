import type { SettingsState } from '../types';
import { BASELINE_SENSITIVE_HEADERS_LC } from './settingsDefaults';
import { syncConsentMirror } from './settingsPersistence';
import type { SettingsSet } from './settingsStoreContext';

/**
 * implementation — privacy/consent setter factory for the settings store.
 * Bundles the execution-history-snapshot toggle, telemetry + three
 * clipboard-on-focus consents, the dependency-detection master switch, and the
 * sensitive-HTTP-header add/remove setters. Extracted verbatim from
 * `settingsStore.ts`. `setTelemetryConsent` mirrors the choice to the main
 * process via `syncConsentMirror`; the clipboard consents are renderer-scoped.
 * `set`-only — none of these setters read `get()`.
 */
export function createPrivacyActions(
  set: SettingsSet
): Pick<
  SettingsState,
  | 'toggleExecutionHistorySnapshot'
  | 'setTelemetryConsent'
  | 'setUtilitiesClipboardOnFocusConsent'
  | 'setCapsuleImportClipboardOnFocusConsent'
  | 'setImportPreviewClipboardOnFocusConsent'
  | 'toggleDependencyDetectionEnabled'
  | 'addSensitiveHttpHeader'
  | 'removeSensitiveHttpHeader'
> {
  return {
    toggleExecutionHistorySnapshot: () =>
      set((s) => ({ executionHistorySnapshotEnabled: !s.executionHistorySnapshotEnabled })),
    setTelemetryConsent: (telemetryConsent) => {
      set({ telemetryConsent });
      // Mirror to main so `bootCrashReporter` can read consent at the
      // next app boot, before createWindow().
      syncConsentMirror(telemetryConsent);
    },
    // implementation — clipboard-on-focus consent. Local-only; no
    // mirror to main because the feature is renderer-scoped.
    setUtilitiesClipboardOnFocusConsent: (utilitiesClipboardOnFocusConsent) => {
      set({ utilitiesClipboardOnFocusConsent });
    },
    // implementation note — capsule-import clipboard auto-detect
    // consent. Same renderer-scoped boundary as the utilities one.
    setCapsuleImportClipboardOnFocusConsent: (
      capsuleImportClipboardOnFocusConsent
    ) => {
      set({ capsuleImportClipboardOnFocusConsent });
    },
    // implementation note — import-preview clipboard auto-detect
    // consent. implementation ships the setter so Settings UI can land
    // when needed; the actual auto-detect on overlay focus is
    // deferred to implementation.
    setImportPreviewClipboardOnFocusConsent: (
      importPreviewClipboardOnFocusConsent
    ) => {
      set({ importPreviewClipboardOnFocusConsent });
    },
    // implementation — dependency detection master switch.
    toggleDependencyDetectionEnabled: () =>
      set((state) => ({
        dependencyDetectionEnabled: !state.dependencyDetectionEnabled,
      })),
    addSensitiveHttpHeader: (name) =>
      set((state) => {
        if (typeof name !== 'string') return state;
        const normalised = name.trim().toLowerCase();
        if (normalised.length === 0 || normalised.length > 100) return state;
        // Baseline list is enforced at redaction time; if the user
        // adds one, it's a harmless no-op (still redacted) but we
        // skip the array insert to avoid duplicate rows in the UI.
        if (BASELINE_SENSITIVE_HEADERS_LC.has(normalised)) return state;
        if (state.sensitiveHttpHeaders.includes(normalised)) return state;
        return {
          sensitiveHttpHeaders: [...state.sensitiveHttpHeaders, normalised],
        };
      }),
    removeSensitiveHttpHeader: (name) =>
      set((state) => {
        if (typeof name !== 'string') return state;
        const normalised = name.trim().toLowerCase();
        if (normalised.length === 0) return state;
        // Baseline names cannot be removed via this seam — silent
        // no-op so the UI's hover-X chip never appears on a
        // baseline row anyway.
        if (BASELINE_SENSITIVE_HEADERS_LC.has(normalised)) return state;
        if (!state.sensitiveHttpHeaders.includes(normalised)) return state;
        return {
          sensitiveHttpHeaders: state.sensitiveHttpHeaders.filter(
            (h) => h !== normalised
          ),
        };
      }),
  };
}
