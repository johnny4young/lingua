import type { Language } from '../types';
import { useSettingsStore } from './settingsStore';
import {
  coerceRuntimeMode,
  defaultRuntimeModeFor,
  languageHasRuntimeModes,
  type RuntimeMode,
} from '../../shared/runtimeModes';
import {
  coerceWorkflowMode,
  defaultWorkflowMode,
  type WorkflowMode,
} from '../../shared/workflowMode';

/**
 * RL-128 — runtime/workflow mode resolution helpers, extracted verbatim from
 * `editorStore.ts`. These resolve the per-tab `runtimeMode` / `workflowMode`
 * for freshly-created vs session-restored tabs, honouring the user's Settings
 * defaults and snapping tampered/stale persisted values back to a supported
 * value via the shared `coerce*` helpers. Leaf module — depends only on
 * `settingsStore` + the shared mode contracts, never on `editorStore`.
 */

export function runtimeModeForNewTab(
  language: Language,
  explicit?: RuntimeMode
): RuntimeMode | undefined {
  if (!languageHasRuntimeModes(language)) return undefined;
  if (explicit !== undefined) return coerceRuntimeMode(explicit, language) ?? undefined;
  const settingsDefault = useSettingsStore.getState().defaultRuntimeMode;
  return (
    coerceRuntimeMode(settingsDefault, language) ??
    defaultRuntimeModeFor(language) ??
    undefined
  );
}

export function runtimeModeForRestoredTab(
  language: Language,
  persisted?: RuntimeMode
): RuntimeMode | undefined {
  return coerceRuntimeMode(persisted, language) ?? undefined;
}

/**
 * RL-020 Slice 2 — resolve the workflow mode for a freshly created
 * tab. Honours the per-language default the user set in Settings
 * (when present) and falls through to the shared
 * `defaultWorkflowMode` helper otherwise. The Settings lookup is
 * tolerant: if the persisted default is no longer valid for the
 * language (e.g. user upgraded from a build where `debug` was
 * allowed for Python), `coerceWorkflowMode` snaps it back to a
 * supported value.
 */
export function workflowModeForNewTab(
  language: Language,
  explicit?: WorkflowMode
): WorkflowMode {
  if (explicit !== undefined) {
    return coerceWorkflowMode(explicit, language);
  }
  const settingsDefault = useSettingsStore
    .getState()
    .workflowModeDefaultsByLanguage[language];
  if (settingsDefault !== undefined) {
    return coerceWorkflowMode(settingsDefault, language);
  }
  return defaultWorkflowMode(language);
}

/**
 * RL-020 Slice 2 — resolve the workflow mode for a tab restored from
 * a previous session. Same shape as the runtime-mode restore helper
 * — `coerceWorkflowMode` snaps an unknown / unsupported persisted
 * value back to the language's default so a tampered or stale
 * localStorage entry cannot leave the live store in a bad shape.
 */
export function workflowModeForRestoredTab(
  language: Language,
  persisted?: WorkflowMode
): WorkflowMode {
  return coerceWorkflowMode(persisted, language);
}
