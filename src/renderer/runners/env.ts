import i18next from 'i18next';
import { useEditorStore } from '../stores/editorStore';
import { useEnvVarsStore } from '../stores/envVarsStore';
import { useProjectStore } from '../stores/projectStore';
import { trackEvent } from '../utils/telemetry';

// internal close-out — fire `env.project_scope_used` at most once per renderer
// session, the first time a native runner resolves env while a project is open.
let projectScopeTelemetryEmitted = false;

/**
 * Resolve the effective user-space env for subprocess-style runners.
 * The host env allowlist stays in main; this only sends explicit
 * user/project/tab variables across the preload boundary.
 */
export function resolveUserEnvForRunner(): Record<string, string> {
  // internal contract: user-defined env vars are a desktop-only feature.
  // The web build keeps the Settings surface honest for tier editing and
  // trace preview, but runnable paths must not leak those vars into the
  // browser runtimes.
  if (typeof window !== 'undefined' && window.lingua?.platform === 'web') {
    return {};
  }

  const { activeTabId } = useEditorStore.getState();
  const { currentProject } = useProjectStore.getState();
  const envState = useEnvVarsStore.getState();
  const projectId = currentProject?.id ?? null;

  // internal close-out — once-per-session adoption signal for project-scoped env.
  // Only when a project is open; `hasProjectVars` says whether that project
  // carries any project-tier overrides. No keys/values/paths leave the renderer.
  if (!projectScopeTelemetryEmitted && projectId) {
    projectScopeTelemetryEmitted = true;
    const hasProjectVars = Object.keys(envState.project[projectId] ?? {}).length > 0;
    void trackEvent('env.project_scope_used', { hasProjectVars });
  }

  return { ...envState.resolveEffectiveEnv({}, projectId, activeTabId) };
}

export function resolveNativeRunnerMessages(): NativeRunnerMessages {
  return {
    compileOutputTruncated: i18next.t('runner.compileOutput.truncated'),
    stdoutTruncated: i18next.t('runner.truncated.stdout'),
    stderrTruncated: i18next.t('runner.truncated.stderr'),
  };
}
