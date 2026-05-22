/**
 * RL-025 Slice A - per-tab dependency detection runner.
 *
 * One hook subscribes to the active tab's content + language +
 * filePath, debounces edits (300ms keystroke / 60ms paste), runs the
 * adapter detector, calls the desktop resolver IPC for JS/TS, and
 * writes the classified result to `useDependencyDetectionStore`.
 *
 * Telemetry:
 * - `dependency.detected_in_tab { language, countBucket }` fires
 *   per completed cycle, gated by the master toggle.
 * - `dependency.banner_shown { language }` fires once per session
 *   per (tabId, language) when the panel first surfaces a row.
 * - `dependency.classifications_summary { language, ... }` fires
 *   once per session per (tabId, language) - bucketed counts per
 *   status (fold F).
 */

import { useEffect, useMemo } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useSettingsStore } from '../stores/settingsStore';
import {
  useDependencyDetectionStore,
  computeDetectionHash,
  type ClassifiedDependency,
  type TabDetectionState,
} from '../stores/dependencyDetectionStore';
import {
  maybeGetDependencyAdapter,
  type DependencyAdapterLanguage,
} from '../../shared/dependencies/registry';
import {
  bucketDependencyCount,
  DEPENDENCY_DETECTION_MAX_BUFFER_BYTES,
  type DependencyCountBucket,
  type DependencyStatus,
  type DetectedDependency,
} from '../../shared/dependencies/types';
import { trackEvent } from '../utils/telemetry';

const KEYSTROKE_DEBOUNCE_MS = 300;
const PASTE_DEBOUNCE_MS = 60;
const PASTE_RECENCY_MS = 250;

let lastPasteAt = 0;

/**
 * Editor surfaces (CodeEditor's `onDidPaste`) call this so the next
 * detection cycle picks the short debounce. Fold D - paste UX feels
 * instant; keystroke UX stays calm.
 */
export function notifyDependencyDetectionPaste(): void {
  lastPasteAt = Date.now();
}

// Per-session de-dup for the once-per-tab+language telemetry events.
const bannerShownKeys = new Set<string>();
const summaryFiredKeys = new Set<string>();

function bannerKey(tabId: string, language: string): string {
  return `${tabId}::${language}`;
}

function classifyOnWeb(
  deps: readonly DetectedDependency[],
  language: DependencyAdapterLanguage
): ClassifiedDependency[] {
  // JS/TS web cannot install (no `node_modules` to walk). Python web
  // CAN install via `micropip` in Slice C, but Slice A only reports
  // `detected` because the Pyodide loaded-packages bridge hasn't
  // been opened yet. JS/TS Python distinction kept explicit so
  // Slice B/C can change the per-language map without re-shaping.
  const status: DependencyStatus =
    language === 'python' ? 'detected' : 'needs-desktop';
  return deps.map((dep) => ({ ...dep, status }));
}

async function classifyOnDesktop(
  deps: readonly DetectedDependency[],
  language: DependencyAdapterLanguage,
  filePath?: string
): Promise<ClassifiedDependency[]> {
  if (language === 'python') {
    // Python desktop install path is a deferred slice (virtualenv
    // story). Honest signal: needs-desktop says "yes we know about
    // it but the installer isn't here yet".
    return deps.map((dep) => ({ ...dep, status: 'needs-desktop' as const }));
  }
  const names = deps.map((dep) => dep.name);
  if (names.length === 0) return [];
  const bridge = window.lingua?.dependencies;
  if (!bridge || typeof bridge.resolveJs !== 'function') {
    return deps.map((dep) => ({ ...dep, status: 'detected' as const }));
  }
  try {
    const result = await bridge.resolveJs(names, filePath);
    return deps.map((dep) => {
      const raw = result.statuses[dep.name];
      const status: DependencyStatus =
        raw === 'installed'
          ? 'installed'
          : raw === 'invalid'
            ? 'unsupported'
            : 'detected';
      return { ...dep, status };
    });
  } catch {
    return deps.map((dep) => ({ ...dep, status: 'detected' as const }));
  }
}

// Share the canonical bucketing helper from
// `src/shared/dependencies/types.ts` so the renderer-side rollup
// event stays aligned with the closed-enum telemetry validator.
function bucketStatusCount(count: number): DependencyCountBucket {
  return bucketDependencyCount(count);
}

function fireDetectedTelemetry(
  language: DependencyAdapterLanguage,
  classified: readonly ClassifiedDependency[]
): void {
  void trackEvent('dependency.detected_in_tab', {
    language,
    countBucket: bucketDependencyCount(classified.length),
  });
}

function fireBannerShownTelemetry(
  tabId: string,
  language: DependencyAdapterLanguage
): void {
  const key = bannerKey(tabId, language);
  if (bannerShownKeys.has(key)) return;
  bannerShownKeys.add(key);
  void trackEvent('dependency.banner_shown', { language });
}

function fireSummaryTelemetry(
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
  void trackEvent('dependency.classifications_summary', {
    language,
    detectedBucket: bucketStatusCount(detected),
    installedBucket: bucketStatusCount(installed),
    needsDesktopBucket: bucketStatusCount(needsDesktop),
    unsupportedBucket: bucketStatusCount(unsupported),
  });
}

/**
 * Test-only reset helper. Wipes the session-scoped dedup sets so
 * specs can re-assert the once-per-(tabId, language) gates without
 * leaking through a previous test's state.
 */
export function __resetDependencyDetectionTelemetryDedup(): void {
  bannerShownKeys.clear();
  summaryFiredKeys.clear();
  lastPasteAt = 0;
}

export function useDependencyDetection(): void {
  const enabled = useSettingsStore((s) => s.dependencyDetectionEnabled);
  const activeTab = useEditorStore((state) =>
    state.activeTabId
      ? state.tabs.find((t) => t.id === state.activeTabId) ?? null
      : null
  );
  const setDetection = useDependencyDetectionStore((s) => s.setDetection);
  const clearDetections = useDependencyDetectionStore((s) => s.clear);
  const evictTab = useDependencyDetectionStore((s) => s.evictTab);

  const tabId = activeTab?.id ?? null;
  const language = activeTab?.language ?? null;
  const content = activeTab?.content ?? '';
  const filePath = activeTab?.filePath ?? undefined;

  const adapter = useMemo(
    () => maybeGetDependencyAdapter(language),
    [language]
  );

  useEffect(() => {
    if (!enabled) {
      // Clear every tab's cache so opting out removes package names
      // from memory immediately, not only for the active tab.
      clearDetections();
      return;
    }
    if (!tabId || !language) return;
    if (!adapter) {
      evictTab(tabId);
      return;
    }
    const adapterLanguage = adapter.language;
    let cancelled = false;

    const runDetection = async () => {
      const detectionHash = computeDetectionHash(adapterLanguage, content);
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
      const detected = adapter.detect(content);
      const isWeb = window.lingua?.platform === 'web';
      const classified = isWeb
        ? classifyOnWeb(detected, adapterLanguage)
        : await classifyOnDesktop(detected, adapterLanguage, filePath);
      if (cancelled) return;
      const next: TabDetectionState = {
        tabId,
        language: adapterLanguage,
        detectionHash,
        dependencies: classified,
        classifiedAt: Date.now(),
      };
      setDetection(tabId, next);
      fireDetectedTelemetry(adapterLanguage, classified);
      if (classified.length > 0) {
        fireBannerShownTelemetry(tabId, adapterLanguage);
        fireSummaryTelemetry(tabId, adapterLanguage, classified);
      }
    };

    const sincePasteMs = Date.now() - lastPasteAt;
    const debounceMs =
      sincePasteMs >= 0 && sincePasteMs < PASTE_RECENCY_MS
        ? PASTE_DEBOUNCE_MS
        : KEYSTROKE_DEBOUNCE_MS;
    const timer = window.setTimeout(() => {
      void runDetection();
    }, debounceMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    enabled,
    tabId,
    language,
    content,
    filePath,
    adapter,
    setDetection,
    clearDetections,
    evictTab,
  ]);
}
