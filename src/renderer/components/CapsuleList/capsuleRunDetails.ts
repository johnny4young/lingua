import type { RunCapsuleV1 } from '../../../shared/runCapsule';
import { isJavaScriptFamily } from '../../../shared/languageFamilies';
import { RUNTIME_MODES } from '../../../shared/runtimeModes';
import { isSqlRemoteEngine } from '../../../shared/sqlConnections';
import { ENGINE_LABEL, LOCAL_ENGINE } from '../SqlWorkspace/sqlConnectionStyle';

type Translate = (key: string) => string;

const isRuntimeMode = (mode: string) => (RUNTIME_MODES as readonly string[]).includes(mode);

/**
 * Where the code ran, or null when the capsule cannot say: non-JS tabs store the default `worker`
 * whatever ran them, so only runtimes known per language or per workspace get a name.
 */
export function capsuleRuntimeLabel(capsule: RunCapsuleV1, t: Translate): string | null {
  const mode = capsule.tab.runtimeMode;
  const { language } = capsule.tab;
  if (mode === 'browser-preview') return t('runtimeMode.mode.browserPreview');
  // The toolbar's Worker reads as Web Worker here, where no runtime picker sits beside it.
  if (isJavaScriptFamily(language)) return mode === 'worker' ? 'Web Worker' : isRuntimeMode(mode) ? t(`runtimeMode.mode.${mode}`) : null;
  if (language === 'python') return 'Pyodide';
  if (language === 'ruby' && capsule.environment.platform === 'web') return 'ruby.wasm';
  if (mode === 'duckdb-wasm') return LOCAL_ENGINE;
  if (mode.startsWith('sql-')) {
    const engine = mode.slice(4);
    return isSqlRemoteEngine(engine) ? ENGINE_LABEL[engine] : null;
  }
  if (mode === 'http-client') return t('capsuleList.runtime.http');
  if (mode === 'utility-pipeline') return t('capsuleList.runtime.pipeline');
  return null;
}

export function capsulePlatformLabel(capsule: RunCapsuleV1, t: Translate): string {
  return t(capsule.environment.platform === 'desktop' ? 'license.devices.surface.desktop' : 'license.devices.surface.web');
}
