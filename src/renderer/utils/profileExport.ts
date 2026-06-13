/**
 * RL-089 — collect a portable user profile from the renderer stores
 * and trigger a download as JSON.
 *
 * Allowlist-driven: only fields the schema declares portable are
 * emitted. License tokens, device IDs, telemetry consent, recent
 * files / sessions, plugin discovery state, and transient UI state
 * stay on the device.
 */

import {
  PROFILE_SCHEMA_VERSION,
  profileFilename,
  type LinguaProfile,
  type PortableSettings,
  type PortableSnippet,
  type PortableEnvVars,
} from '../../shared/profile/profile';
import { useEnvVarsStore } from '../stores/envVarsStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useSnippetsStore } from '../stores/snippetsStore';

const APP_VERSION =
  (typeof import.meta !== 'undefined' &&
    (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_LINGUA_APP_VERSION) ||
  '0.0.0';

function pickPortableSettings(): PortableSettings {
  const state = useSettingsStore.getState();
  return {
    theme: state.theme,
    editorTheme: state.editorTheme,
    fontSize: state.fontSize,
    fontFamily: state.fontFamily,
    // Slice 2 baseline values — kept in the export schema for
    // backward compatibility with older readers that still expect them.
    fontLigatures: true,
    showLineNumbers: true,
    wordWrap: state.wordWrap,
    minimap: state.minimap,
    layoutPreset: state.layoutPreset,
    loopProtection: true,
    maxLoopIterations: state.maxLoopIterations,
    hideUndefined: true,
    restoreSessionMode: state.restoreSessionMode,
    formatOnSave: state.formatOnSave,
    vimMode: state.vimMode,
    syncShellWithEditorTheme: true,
    executionHistorySnapshotEnabled: state.executionHistorySnapshotEnabled,
    language: state.language,
    shortcutOverrides: state.shortcutOverrides,
    keymapPreset: state.keymapPreset,
    themePack: state.themePack,
  };
}

function pickPortableSnippets(): PortableSnippet[] {
  return useSnippetsStore.getState().snippets.map((snippet) => ({
    id: snippet.id,
    language: snippet.language,
    label: snippet.label,
    description: snippet.description,
    code: snippet.code,
    createdAt: snippet.createdAt,
  }));
}

function pickPortableEnvVars(): PortableEnvVars {
  const state = useEnvVarsStore.getState();
  // Tab-scoped env vars are session-local; intentionally NOT exported.
  return {
    global: { ...state.global },
    project: Object.fromEntries(
      Object.entries(state.project).map(([projectId, scope]) => [projectId, { ...scope }])
    ),
  };
}

export function buildProfile(now: Date = new Date()): LinguaProfile {
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion: APP_VERSION,
    data: {
      settings: pickPortableSettings(),
      snippets: pickPortableSnippets(),
      envVars: pickPortableEnvVars(),
    },
  };
}

/**
 * Trigger a browser download of the profile JSON. Uses a Blob URL +
 * hidden anchor click; web-capable, no IPC needed. Revokes the URL
 * on the next tick so the browser can flush the download first.
 */
export function downloadProfileFile(
  profile: LinguaProfile,
  doc: Document = document,
  now: Date = new Date()
): void {
  const json = `${JSON.stringify(profile, null, 2)}\n`;
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = url;
  anchor.download = profileFilename(now);
  anchor.style.display = 'none';
  doc.body.appendChild(anchor);
  anchor.click();
  doc.body.removeChild(anchor);
  // Microtask delay so the download UI captures the URL before we revoke.
  // Best-effort: jsdom and some web targets stub URL.revokeObjectURL away.
  setTimeout(() => {
    try {
      URL.revokeObjectURL?.(url);
    } catch {
      // ignore — leaking a single Blob URL for one tick is fine
    }
  }, 0);
}
