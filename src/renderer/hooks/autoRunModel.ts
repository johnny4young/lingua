import type { WorkflowMode } from '../../shared/workflowMode';
import { isJavaScriptFamily } from '../../shared/languageFamilies';
import type { FileTab, Language } from '../types';
import {
  resolveBrowserPreviewRefreshInterval,
  type BrowserPreviewRefreshInterval,
} from '../../shared/browserPreviewRefresh';

export const AUTO_RUN_DEBOUNCE_MS = 1200;
export type AutoLogCountBucket = '1' | '2-5' | '6-20' | '20-plus';

export interface AutoRunInput {
  code: string;
  language: Language;
  runtimeMode: FileTab['runtimeMode'];
  workflowMode: WorkflowMode;
  autoLogEnabled: boolean;
  /** Effective per-tab Browser preview refresh interval; null elsewhere. */
  browserPreviewRefreshIntervalMs: BrowserPreviewRefreshInterval | null;
  /** implementation — stdin is part of the effective run input. */
  stdinBuffer: string | undefined;
}

type AutoLogDefaults = Partial<Record<Language, boolean>>;

export function resolveAutoLogEnabled(
  language: Language,
  workflowMode: WorkflowMode,
  tabOverride: boolean | undefined,
  defaults: AutoLogDefaults
): boolean {
  if (!isJavaScriptFamily(language) || workflowMode !== 'scratchpad') {
    return false;
  }
  return tabOverride === undefined
    ? defaults[language] === true
    : tabOverride === true;
}

export function isSameAutoRunInput(
  previous: AutoRunInput | null,
  next: AutoRunInput
): boolean {
  return (
    previous !== null &&
    previous.code === next.code &&
    previous.language === next.language &&
    previous.runtimeMode === next.runtimeMode &&
    previous.workflowMode === next.workflowMode &&
    previous.autoLogEnabled === next.autoLogEnabled &&
    previous.browserPreviewRefreshIntervalMs ===
      next.browserPreviewRefreshIntervalMs &&
    previous.stdinBuffer === next.stdinBuffer
  );
}

export function resolveAutoRunSchedule(
  runtimeMode: FileTab['runtimeMode'],
  code: string,
  browserPreviewPreference: BrowserPreviewRefreshInterval
): {
  debounceMs: number | null;
  browserPreviewRefreshIntervalMs: BrowserPreviewRefreshInterval | null;
} {
  if (runtimeMode !== 'browser-preview') {
    return {
      debounceMs: AUTO_RUN_DEBOUNCE_MS,
      browserPreviewRefreshIntervalMs: null,
    };
  }

  const intervalMs = resolveBrowserPreviewRefreshInterval(
    code,
    browserPreviewPreference
  );
  return {
    debounceMs: intervalMs === 0 ? null : intervalMs,
    browserPreviewRefreshIntervalMs: intervalMs,
  };
}

/** Bucket telemetry counts into the closed safe-token allowlist. */
export function bucketAutoLogCount(count: number): AutoLogCountBucket {
  if (count <= 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  return '20-plus';
}
