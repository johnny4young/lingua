/**
 * implementation - per-tab dependency detection runner.
 *
 * One hook subscribes to the active tab's content + language +
 * filePath, debounces edits (300ms keystroke / 60ms paste), handles
 * cheap eligibility/cache paths, and activates the parser/classifier
 * runtime only when source may reference a package. Results land in
 * `useDependencyDetectionStore`.
 *
 * Telemetry:
 * - `dependency.detected_in_tab { language, countBucket }` fires
 *   per completed cycle, gated by the master toggle.
 * - `dependency.banner_shown { language }` fires once per session
 *   per (tabId, language) when the panel first surfaces a row.
 * - `dependency.classifications_summary { language, ... }` fires
 *   once per session per (tabId, language) - bucketed counts per
 *   status (implementation note).
 */

import { useEffect } from 'react';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  useDependencyDetectionStore,
  computeDetectionHash,
  type ClassifiedDependency,
  type TabDetectionState,
} from '../stores/dependencyDetectionStore';
import {
  isDependencyAdapterLanguage,
  sourceMayReferenceDependencies,
} from '../../shared/dependencies/registry';
import {
  bucketDependencyCount,
  DEPENDENCY_DETECTION_MAX_BUFFER_BYTES,
  type DependencyAdapterLanguage,
  type DependencyCountBucket,
} from '../../shared/dependencies/types';
import { useTelemetry, type TelemetryTrack } from './useTelemetry';
import { useUIStore } from '../stores/uiStore';
import { loadDependencyDetectionRuntime } from './dependencyDetectionRuntimeLoader';
import { dependencyDetectionDebounceMs } from './dependencyDetectionPaste';

// Per-session de-dup for the once-per-tab+language telemetry events.
const bannerShownKeys = new Set<string>();
const summaryFiredKeys = new Set<string>();

function bannerKey(tabId: string, language: string): string {
  return `${tabId}::${language}`;
}

// Share the canonical bucketing helper from
// `src/shared/dependencies/types.ts` so the renderer-side rollup
// event stays aligned with the closed-enum telemetry validator.
function bucketStatusCount(count: number): DependencyCountBucket {
  return bucketDependencyCount(count);
}

function fireDetectedTelemetry(
  track: TelemetryTrack,
  language: DependencyAdapterLanguage,
  classified: readonly ClassifiedDependency[]
): void {
  track('dependency.detected_in_tab', {
    language,
    countBucket: bucketDependencyCount(classified.length),
  });
}

function fireBannerShownTelemetry(
  track: TelemetryTrack,
  tabId: string,
  language: DependencyAdapterLanguage
): void {
  const key = bannerKey(tabId, language);
  if (bannerShownKeys.has(key)) return;
  bannerShownKeys.add(key);
  track('dependency.banner_shown', { language });
}

function fireSummaryTelemetry(
  track: TelemetryTrack,
  tabId: string,
  language: DependencyAdapterLanguage,
  classified: readonly ClassifiedDependency[]
): void {
  const key = bannerKey(tabId, language);
  if (summaryFiredKeys.has(key)) return;
  summaryFiredKeys.add(key);
  let detected = 0;
  let installed = 0;
  let needsDesktop = 0;
  let unsupported = 0;
  for (const dep of classified) {
    if (dep.status === 'detected') detected += 1;
    else if (dep.status === 'installed') installed += 1;
    else if (dep.status === 'needs-desktop') needsDesktop += 1;
    else if (dep.status === 'unsupported') unsupported += 1;
  }
  track('dependency.classifications_summary', {
    language,
    detectedBucket: bucketStatusCount(detected),
    installedBucket: bucketStatusCount(installed),
    needsDesktopBucket: bucketStatusCount(needsDesktop),
    unsupportedBucket: bucketStatusCount(unsupported),
  });
}

export function useDependencyDetection(): void {
  const { track } = useTelemetry();
  const enabled = useSettingsStore((s) => s.dependencyDetectionEnabled);
  const activeTab = useEditorStore((state) => getActiveTab(state));
  const setDetection = useDependencyDetectionStore((s) => s.setDetection);
  const clearDetections = useDependencyDetectionStore((s) => s.clear);
  const evictTab = useDependencyDetectionStore((s) => s.evictTab);
  const pushStatusNotice = useUIStore((s) => s.pushStatusNotice);

  const tabId = activeTab?.id ?? null;
  const language = activeTab?.language ?? null;
  const content = activeTab?.content ?? '';
  const filePath = activeTab?.filePath ?? undefined;
  const adapterLanguage =
    language && isDependencyAdapterLanguage(language) ? language : null;

  useEffect(() => {
    if (!enabled) {
      // Clear every tab's cache so opting out removes package names
      // from memory immediately, not only for the active tab.
      clearDetections();
      return;
    }
    if (!tabId || !language) return;
    if (!adapterLanguage) {
      evictTab(tabId);
      return;
    }
    let cancelled = false;
    const abortController = new AbortController();

    const runDetection = async () => {
      const detectionHash = computeDetectionHash(
        adapterLanguage,
        content,
        filePath ?? ''
      );
      const existing = useDependencyDetectionStore
        .getState()
        .byTab.get(tabId);
      if (existing && existing.detectionHash === detectionHash) return;
      if (content.length > DEPENDENCY_DETECTION_MAX_BUFFER_BYTES) {
        const next: TabDetectionState = {
          tabId,
          language: adapterLanguage,
          detectionHash,
          dependencies: [],
          classifiedAt: Date.now(),
          skippedReason: 'buffer-too-large',
        };
        if (!cancelled) setDetection(tabId, next);
        return;
      }

      if (!sourceMayReferenceDependencies(adapterLanguage, content)) {
        const next: TabDetectionState = {
          tabId,
          language: adapterLanguage,
          detectionHash,
          dependencies: [],
          classifiedAt: Date.now(),
          cwdHasPackageJson: null,
        };
        if (!cancelled) {
          setDetection(tabId, next);
          fireDetectedTelemetry(track, adapterLanguage, []);
        }
        return;
      }

      let result;
      try {
        const runtime = await loadDependencyDetectionRuntime();
        if (cancelled) return;
        result = await runtime.classifyDependencies({
          content,
          language: adapterLanguage,
          filePath,
          signal: abortController.signal,
        });
      } catch {
        if (!cancelled) {
          pushStatusNotice({
            tone: 'error',
            messageKey: 'dependencies.detectionLoadFailed',
          });
        }
        return;
      }
      if (cancelled) return;
      const { classified, cwdHasPackageJson } = result;
      const next: TabDetectionState = {
        tabId,
        language: adapterLanguage,
        detectionHash,
        dependencies: classified,
        classifiedAt: Date.now(),
        cwdHasPackageJson,
      };
      setDetection(tabId, next);
      fireDetectedTelemetry(track, adapterLanguage, classified);
      if (classified.length > 0) {
        fireBannerShownTelemetry(track, tabId, adapterLanguage);
        fireSummaryTelemetry(track, tabId, adapterLanguage, classified);
      }
    };

    const debounceMs = dependencyDetectionDebounceMs();
    const timer = window.setTimeout(() => {
      void runDetection();
    }, debounceMs);
    return () => {
      cancelled = true;
      abortController.abort();
      window.clearTimeout(timer);
    };
  }, [
    enabled,
    tabId,
    language,
    adapterLanguage,
    content,
    filePath,
    setDetection,
    clearDetections,
    evictTab,
    pushStatusNotice,
    track,
  ]);
}
