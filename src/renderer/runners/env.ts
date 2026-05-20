import i18next from 'i18next';
import { useEditorStore } from '../stores/editorStore';
import { useEnvVarsStore } from '../stores/envVarsStore';
import { useProjectStore } from '../stores/projectStore';

/**
 * Resolve the effective user-space env for subprocess-style runners.
 * The host env allowlist stays in main; this only sends explicit
 * user/project/tab variables across the preload boundary.
 */
export function resolveUserEnvForRunner(): Record<string, string> {
  // RL-011 contract: user-defined env vars are a desktop-only feature.
  // The web build keeps the Settings surface honest for tier editing and
  // trace preview, but runnable paths must not leak those vars into the
  // browser runtimes.
  if (typeof window !== 'undefined' && window.lingua?.platform === 'web') {
    return {};
  }

  const { activeTabId } = useEditorStore.getState();
  const { currentProject } = useProjectStore.getState();
  const { resolveEffectiveEnv } = useEnvVarsStore.getState();
  return { ...resolveEffectiveEnv({}, currentProject?.id ?? null, activeTabId) };
}

export function resolveNativeRunnerMessages(): NativeRunnerMessages {
  return {
    compileOutputTruncated: i18next.t('runner.compileOutput.truncated'),
    stdoutTruncated: i18next.t('runner.truncated.stdout'),
    stderrTruncated: i18next.t('runner.truncated.stderr'),
  };
}
