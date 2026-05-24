/**
 * RL-025 Slice A + Slice B — bottom-panel "Dependencies" tab body.
 *
 * Slice A shipped read-only detection with a disabled Install button.
 * Slice B wires the Install path: a click on a `'detected'` row (or
 * the "Install all" header button — fold F) calls into main via
 * `window.lingua.dependencies.installJs`, transitions the row(s) to
 * `'installing'`, streams subprocess output into an inline log
 * surface, and updates the row(s) to `'installed'` / `'failed'` /
 * `'detected'` (on cancel) when the batch finishes.
 *
 * Folds active in this surface:
 *   - A — refuses click when the resolved cwd has no `package.json`
 *     (the renderer learns the flag from the Slice A resolver).
 *   - B — single-spawn batched install. Multiple clicks within
 *     `BATCH_WINDOW_MS` coalesce into one npm invocation.
 *   - C — pre-flight integrity check happens in main; the panel
 *     just shows whatever statuses come back.
 *   - E — install log buffer is retained per-tab across panel
 *     hide/show; the surface only renders when there is content to
 *     show (or an install is running).
 *   - F — "Install all" header button when ≥2 rows are
 *     `'detected'` and not already in flight.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, Package, Download, X } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import {
  mapInstallStatusToDependencyStatus,
  useDependencyDetectionStore,
} from '../../stores/dependencyDetectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { ClassifiedDependency } from '../../stores/dependencyDetectionStore';
import type {
  DependencyAdapterLanguage,
  DependencyInstallFailureReason,
  DependencyInstallOutcome,
  DependencyStatus,
} from '../../../shared/dependencies/types';
import { bucketDependencyCount } from '../../../shared/dependencies/types';
import { trackEvent } from '../../utils/telemetry';

type PillTone =
  | 'detected'
  | 'installed'
  | 'installing'
  | 'failed'
  | 'unsupported'
  | 'needs-desktop';

const STATUS_TONE: Record<DependencyStatus, string> = {
  detected: 'border-warning/40 bg-warning/15 text-warning',
  installed: 'border-success/40 bg-success/15 text-success',
  installing: 'border-info/40 bg-info/15 text-info',
  failed: 'border-error/40 bg-error/15 text-error',
  unsupported: 'border-border/60 bg-background-elevated/60 text-fg-muted',
  'needs-desktop': 'border-border/60 bg-background-elevated/60 text-fg-muted',
};

const STATUS_I18N_KEY: Record<DependencyStatus, string> = {
  detected: 'dependencies.status.detected',
  installed: 'dependencies.status.installed',
  installing: 'dependencies.status.installing',
  failed: 'dependencies.status.failed',
  unsupported: 'dependencies.status.unsupported',
  'needs-desktop': 'dependencies.status.needsDesktop',
};

/**
 * Fold B — coalescing window. A user clicking through several rows
 * in quick succession after a paste collapses into a single `npm
 * install pkg1 pkg2 pkg3` invocation rather than N sequential
 * spawns. The window is small enough that single deliberate clicks
 * still get their own batch.
 */
const BATCH_WINDOW_MS = 500;

interface PanelContext {
  readonly canInstall: boolean;
  /** Tooltip key when the row's Install button is disabled. */
  readonly disabledReasonKey: string | null;
  /**
   * RL-025 Slice C — tooltip key when the Install button is
   * ENABLED. Used to surface backend-specific hints (e.g. "Install
   * via Pyodide micropip" on the Python web path). `null` falls
   * back to the generic Install button label.
   */
  readonly enabledHintKey: string | null;
  /**
   * RL-025 Slice C reviewer fix — tooltip key for rows whose
   * status is `'unsupported'`. Python web tabs surface a more
   * informative "Pyodide has no compatible wheel for this package"
   * instead of the generic `disabledTooltip`. `null` falls back to
   * the generic disabled copy on other backends.
   */
  readonly unsupportedTooltipKey: string | null;
  /**
   * RL-025 Slice C — when the panel is rendering a Python tab on
   * web, the install path is Pyodide micropip (not npm). Drives a
   * different click handler in `performInstall` so we don't try to
   * call `bridge.installJs` for Python rows.
   */
  readonly isPythonWeb: boolean;
}

function buildPanelContext(args: {
  readonly isWeb: boolean;
  readonly hasFilePath: boolean;
  readonly cwdHasPackageJson: boolean | null;
  readonly language: DependencyAdapterLanguage | null;
}): PanelContext {
  // RL-025 Slice C — Python web has its own install path via Pyodide
  // micropip. No filesystem involved → skip the unsaved-tab and
  // missing-package.json gates. `enabledHintKey` surfaces the
  // Pyodide nature in the tooltip so the user knows the install
  // hits the Pyodide CDN, not npm.
  if (args.isWeb && args.language === 'python') {
    return {
      canInstall: true,
      disabledReasonKey: null,
      enabledHintKey: 'dependencies.install.pythonWebReadyTooltip',
      // RL-025 Slice C — a Python web row that ends up
      // `'unsupported'` was rejected by Pyodide micropip for a
      // native wheel; the tooltip surfaces that root cause.
      unsupportedTooltipKey: 'dependencies.install.pythonUnsupportedTooltip',
      isPythonWeb: true,
    };
  }
  if (args.isWeb) {
    return {
      canInstall: false,
      disabledReasonKey: 'dependencies.install.webUnavailableTooltip',
      enabledHintKey: null,
      unsupportedTooltipKey: null,
      isPythonWeb: false,
    };
  }
  if (!args.hasFilePath) {
    return {
      canInstall: false,
      disabledReasonKey: 'dependencies.install.unsavedTabTooltip',
      enabledHintKey: null,
      unsupportedTooltipKey: null,
      isPythonWeb: false,
    };
  }
  if (args.cwdHasPackageJson === false) {
    return {
      canInstall: false,
      disabledReasonKey: 'dependencies.install.noPackageJsonTooltip',
      enabledHintKey: null,
      unsupportedTooltipKey: null,
      isPythonWeb: false,
    };
  }
  return {
    canInstall: true,
    disabledReasonKey: null,
    enabledHintKey: null,
    unsupportedTooltipKey: null,
    isPythonWeb: false,
  };
}

function fireInstallTelemetryStarted(
  language: DependencyAdapterLanguage,
  batchSize: number
): void {
  void trackEvent('dependency.install_started', {
    language,
    countBucket: bucketDependencyCount(batchSize),
  });
}

function fireInstallTelemetryCompleted(
  language: DependencyAdapterLanguage,
  outcome: DependencyInstallOutcome
): void {
  void trackEvent('dependency.install_completed', { language, outcome });
}

function fireInstallTelemetryFailureReason(
  language: DependencyAdapterLanguage,
  reason: DependencyInstallFailureReason
): void {
  void trackEvent('dependency.install_failed_reason', { language, reason });
}

export function DependenciesPanel() {
  const { t } = useTranslation();
  const activeTab = useEditorStore((s) =>
    s.activeTabId
      ? s.tabs.find((tab) => tab.id === s.activeTabId) ?? null
      : null
  );
  const detection = useDependencyDetectionStore((s) =>
    activeTab
      ? (() => {
          const entry = s.byTab.get(activeTab.id) ?? null;
          return entry?.language === activeTab.language ? entry : null;
        })()
      : null
  );
  const installState = useDependencyDetectionStore((s) =>
    activeTab ? s.installByTab.get(activeTab.id) ?? null : null
  );
  const startInstall = useDependencyDetectionStore((s) => s.startInstall);
  const appendInstallLog = useDependencyDetectionStore(
    (s) => s.appendInstallLog
  );
  const endInstall = useDependencyDetectionStore((s) => s.endInstall);
  const detectionEnabled = useSettingsStore(
    (s) => s.dependencyDetectionEnabled
  );
  const isWeb =
    typeof window !== 'undefined' && window.lingua?.platform === 'web';

  const rows = useMemo<readonly ClassifiedDependency[]>(
    () => detection?.dependencies ?? [],
    [detection]
  );

  const hasFilePath = Boolean(activeTab?.filePath);
  const cwdHasPackageJson = detection?.cwdHasPackageJson ?? null;
  const detectionLanguage = detection?.language ?? null;
  const ctx = useMemo(
    () =>
      buildPanelContext({
        isWeb,
        hasFilePath,
        cwdHasPackageJson,
        language: detectionLanguage,
      }),
    [isWeb, hasFilePath, cwdHasPackageJson, detectionLanguage]
  );

  const isInstalling = (installState?.installing.size ?? 0) > 0;
  const language = detection?.language ?? null;
  const filePath = activeTab?.filePath ?? null;
  const tabId = activeTab?.id ?? null;

  // Fold B — coalescing buffer for rapid clicks. We accumulate
  // names in a ref and flush after `BATCH_WINDOW_MS` of inactivity.
  const pendingBatchRef = useRef<{ readonly names: Set<string> } | null>(null);
  const flushTimerRef = useRef<number | null>(null);

  const isPythonWeb = ctx.isPythonWeb;
  const performInstall = useCallback(
    async (names: readonly string[]) => {
      if (!tabId || !language || names.length === 0) return;
      // Desktop JS/TS keeps the Slice B contract: needs a filePath
      // because main resolves cwd from it. Python web bypasses
      // filesystem entirely — `filePath` is permitted to be null.
      if (!isPythonWeb && !filePath) return;
      const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      startInstall(tabId, runId, names);
      fireInstallTelemetryStarted(language, names.length);
      try {
        let outcome: DependencyInstallOutcome;
        let failureReason: DependencyInstallFailureReason | null;
        const perNameStatus: Record<string, DependencyStatus> = {};
        if (isPythonWeb) {
          // RL-025 Slice C — Pyodide micropip path. Service module
          // shares the worker with PythonRunner so the install is
          // visible to the next Run.
          const { installPython } = await import(
            '../../services/pythonWebInstaller'
          );
          const appendLog = appendInstallLog;
          const result = await installPython({
            runId,
            specifiers: names,
            onLog: (chunk) => appendLog(tabId, chunk.chunk),
          });
          outcome = result.outcome;
          failureReason = result.failureReason;
          // RL-025 Slice C reviewer fix — `micropip.install` accepts
          // a batch but reports one batch-level error. When the user
          // installs a single Python package and it comes back as
          // `'unsupported-wheel'`, we know that wheel is the
          // culprit and can promote its row to `'unsupported'`.
          // When the batch had MULTIPLE names, the failure could be
          // any one of them; we have no per-name reason from Pyodide,
          // so map every `'failed'` row to plain `'failed'` rather
          // than mis-labelling pure-Python packages as unsupported.
          const wheelRejectionIsSingleton =
            failureReason === 'unsupported-wheel' && names.length === 1;
          for (const [name, status] of Object.entries(result.statuses)) {
            if (status === 'failed' && wheelRejectionIsSingleton) {
              perNameStatus[name] = 'unsupported';
            } else {
              perNameStatus[name] = mapInstallStatusToDependencyStatus(status);
            }
          }
        } else {
          const bridge = window.lingua?.dependencies;
          if (!bridge || typeof bridge.installJs !== 'function') {
            const fallback: Record<string, DependencyStatus> = {};
            for (const name of names) fallback[name] = 'failed';
            endInstall(tabId, runId, 'failed', fallback);
            fireInstallTelemetryCompleted(language, 'failed');
            fireInstallTelemetryFailureReason(language, 'unknown');
            return;
          }
          const result = await bridge.installJs(runId, names, filePath ?? '');
          outcome = result.outcome;
          failureReason = result.failureReason;
          for (const [name, status] of Object.entries(result.statuses)) {
            perNameStatus[name] = mapInstallStatusToDependencyStatus(status);
          }
        }
        endInstall(tabId, runId, outcome, perNameStatus);
        fireInstallTelemetryCompleted(language, outcome);
        if (
          (outcome === 'failed' ||
            outcome === 'partial' ||
            outcome === 'timed-out') &&
          failureReason
        ) {
          fireInstallTelemetryFailureReason(language, failureReason);
        }
      } catch {
        // Network blip / IPC error → treat as a failed batch with
        // unknown reason. The store also resets the installing set
        // so the UI does not lock up.
        const fallback: Record<string, DependencyStatus> = {};
        for (const name of names) fallback[name] = 'failed';
        endInstall(tabId, runId, 'failed', fallback);
        fireInstallTelemetryCompleted(language, 'failed');
        fireInstallTelemetryFailureReason(language, 'unknown');
      }
    },
    [
      tabId,
      language,
      filePath,
      isPythonWeb,
      startInstall,
      endInstall,
      appendInstallLog,
    ]
  );

  const flushBatch = useCallback(() => {
    const pending = pendingBatchRef.current;
    pendingBatchRef.current = null;
    flushTimerRef.current = null;
    if (!pending || pending.names.size === 0) return;
    void performInstall([...pending.names]);
  }, [performInstall]);

  const queueForInstall = useCallback(
    (name: string) => {
      if (!ctx.canInstall) return;
      if (isInstalling) return;
      if (!pendingBatchRef.current) {
        pendingBatchRef.current = { names: new Set<string>() };
      }
      pendingBatchRef.current.names.add(name);
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
      }
      flushTimerRef.current = window.setTimeout(flushBatch, BATCH_WINDOW_MS);
    },
    [ctx.canInstall, flushBatch, isInstalling]
  );

  const handleInstallAll = useCallback(() => {
    if (!ctx.canInstall) return;
    if (isInstalling) return;
    const names = rows
      .filter((row) => row.status === 'detected')
      .map((row) => row.name);
    if (names.length === 0) return;
    // Bypass the coalescing window — explicit "Install all" is
    // already a single batch.
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    pendingBatchRef.current = null;
    void performInstall(names);
  }, [ctx.canInstall, isInstalling, rows, performInstall]);

  const activeRunId = installState?.runId ?? null;
  const handleCancel = useCallback(() => {
    if (!activeRunId) return;
    const bridge = window.lingua?.dependencies;
    if (!bridge || typeof bridge.cancelInstallJs !== 'function') return;
    void bridge.cancelInstallJs(activeRunId);
  }, [activeRunId]);

  // Subscribe to streamed log chunks from main once per tab. The
  // unsubscribe runs when the tab changes (or unmounts).
  useEffect(() => {
    const bridge = window.lingua?.dependencies;
    if (!bridge || typeof bridge.onInstallLogJs !== 'function') return;
    if (!tabId) return;
    const off = bridge.onInstallLogJs((event) => {
      // Only append when the runId matches the current tab's run
      // — protects against stale event delivery after a tab switch.
      const current = useDependencyDetectionStore
        .getState()
        .installByTab.get(tabId);
      if (!current || current.runId !== event.runId) return;
      appendInstallLog(tabId, event.chunk);
    });
    return () => off();
  }, [tabId, appendInstallLog]);

  // Flush a pending batch when the tab changes — otherwise the
  // coalescer would silently strand names.
  useEffect(() => {
    return () => {
      if (flushTimerRef.current !== null) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      pendingBatchRef.current = null;
    };
  }, [tabId]);

  if (!detectionEnabled) {
    return (
      <EmptyState
        title={t('dependencies.tab.title')}
        body={t('dependencies.disabled')}
      />
    );
  }

  if (!activeTab) {
    return (
      <EmptyState
        title={t('dependencies.tab.title')}
        body={t('dependencies.empty.noTab')}
      />
    );
  }

  if (detection?.skippedReason === 'buffer-too-large') {
    return (
      <EmptyState
        title={t('dependencies.tab.title')}
        body={t('dependencies.bufferTooLarge')}
      />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title={t('dependencies.tab.title')}
        body={t('dependencies.empty.body')}
      />
    );
  }

  const installableCount = rows.filter(
    (row) => row.status === 'detected'
  ).length;
  const showInstallAll = ctx.canInstall && installableCount >= 2;
  const logVisible = Boolean(
    installState && (installState.installing.size > 0 || installState.log)
  );

  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-testid="dependencies-panel"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border/70 bg-surface/40 px-4 py-2 text-xs uppercase tracking-[0.12em] text-fg-subtle">
        <div className="flex items-center gap-2">
          <Boxes size={12} aria-hidden="true" />
          <span>
            {t('dependencies.header.label', { count: rows.length })}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {showInstallAll ? (
            <button
              type="button"
              onClick={handleInstallAll}
              disabled={isInstalling}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/60 px-2 py-1 text-[11px] normal-case tracking-normal text-fg-base hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:hover:bg-surface/60"
              data-testid="dependencies-install-all"
            >
              <Download size={11} aria-hidden="true" />
              {t('dependencies.install.allButton', { count: installableCount })}
            </button>
          ) : null}
          <span className="text-[10.5px] normal-case tracking-normal text-fg-muted">
            {t('dependencies.privacyNote')}
          </span>
        </div>
      </header>
      <ul
        className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/60"
        data-testid="dependencies-panel-list"
      >
        {rows.map((row) => (
          <DependencyRow
            key={row.name}
            dep={row}
            isWeb={isWeb}
            canInstall={ctx.canInstall}
            isInstallInFlight={isInstalling}
            disabledReasonKey={ctx.disabledReasonKey}
            enabledHintKey={ctx.enabledHintKey}
            unsupportedTooltipKey={ctx.unsupportedTooltipKey}
            onInstall={queueForInstall}
          />
        ))}
      </ul>
      {logVisible ? (
        <InstallLogSurface
          isRunning={isInstalling}
          // RL-025 Slice C — Pyodide doesn't expose mid-microtask
          // cancel semantics + fold D was rejected, so Python web
          // installs hide the Cancel button. The log still streams
          // and the install runs to completion (or 90 s soft
          // timeout via `pythonWebInstaller`).
          cancellable={isInstalling && !isPythonWeb}
          installKey={`${installState?.lastAttemptAt ?? 0}:${
            installState?.runId ?? 'finished'
          }`}
          log={installState?.log ?? ''}
          onCancel={handleCancel}
        />
      ) : null}
    </div>
  );
}

function DependencyRow({
  dep,
  isWeb: _isWeb,
  canInstall,
  isInstallInFlight,
  disabledReasonKey,
  enabledHintKey,
  unsupportedTooltipKey,
  onInstall,
}: {
  readonly dep: ClassifiedDependency;
  readonly isWeb: boolean;
  readonly canInstall: boolean;
  readonly isInstallInFlight: boolean;
  readonly disabledReasonKey: string | null;
  readonly enabledHintKey: string | null;
  /**
   * RL-025 Slice C reviewer fix — tooltip key for `'unsupported'`
   * rows. Python web tabs surface a more informative
   * "Pyodide has no compatible wheel for this package" instead of
   * the generic `disabledTooltip`. `null` falls back to the
   * generic disabled copy.
   */
  readonly unsupportedTooltipKey: string | null;
  readonly onInstall: (name: string) => void;
}) {
  const { t } = useTranslation();
  const status = dep.status;
  // RL-025 Slice C — `canInstall` is the panel-context's verdict
  // (Python web is installable even though `isWeb === true`). Drop
  // the blanket `isWeb` check from disabled-state and trust
  // `canInstall` so the Python web path can enable the button.
  const disabled =
    status !== 'detected' || !canInstall || isInstallInFlight;
  // Tooltip cascade:
  //   1. cross-platform package shape (`needs-desktop`) — always
  //      shows the desktop hint even on a build that could otherwise
  //      install (the package itself is the blocker).
  //   2. enabled state → backend-specific hint (e.g. Pyodide
  //      micropip on Python web) or the generic Install label.
  //   3. install in flight → "wait for current install" copy.
  //   4. row in a non-detected state (`installed`, `failed`,
  //      `unsupported`) → generic disabled tooltip.
  //   5. panel-context disabled reason (unsaved tab, no
  //      `package.json`, web build for non-Python) → that key.
  const tooltipKey =
    status === 'needs-desktop'
      ? 'dependencies.install.needsDesktopTooltip'
      : !disabled
        ? enabledHintKey ?? 'dependencies.install.button'
        : isInstallInFlight
          ? 'dependencies.install.inFlightTooltip'
          : status === 'unsupported'
            ? unsupportedTooltipKey ?? 'dependencies.install.disabledTooltip'
            : status !== 'detected'
              ? 'dependencies.install.disabledTooltip'
              : disabledReasonKey ?? 'dependencies.install.disabledTooltip';
  return (
    <li
      className="flex items-center gap-3 px-4 py-2.5"
      data-testid={`dependency-row-${dep.name}`}
      data-dependency-status={status}
    >
      <Package
        size={14}
        aria-hidden="true"
        className="shrink-0 text-fg-subtle"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-[13px] text-fg-base">
          {dep.name}
          {dep.submodule ? (
            <span className="text-fg-subtle">/{dep.submodule}</span>
          ) : null}
        </p>
      </div>
      <span
        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] uppercase tracking-wide ${STATUS_TONE[status]}`}
        data-testid={`dependency-status-${dep.name}`}
      >
        {t(STATUS_I18N_KEY[status])}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={disabled ? undefined : () => onInstall(dep.name)}
        title={t(tooltipKey)}
        aria-label={t('dependencies.install.button')}
        className={
          disabled
            ? 'inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/40 px-2 py-1 text-[11px] text-fg-muted opacity-60 cursor-not-allowed'
            : 'inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/40 px-2 py-1 text-[11px] text-fg-base hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'
        }
        data-testid={`dependency-install-${dep.name}`}
      >
        <Download size={11} aria-hidden="true" />
        {t('dependencies.install.button')}
      </button>
    </li>
  );
}

function InstallLogSurface({
  isRunning,
  cancellable,
  installKey,
  log,
  onCancel,
}: {
  readonly isRunning: boolean;
  /**
   * RL-025 Slice C — when false, suppress the Cancel button even
   * while the install is in flight. Python web installs are
   * uninterruptible; showing a Cancel that does nothing is
   * misleading UX.
   */
  readonly cancellable: boolean;
  readonly installKey: string;
  readonly log: string;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [hiddenInstallKey, setHiddenInstallKey] = useState<string | null>(null);
  // Auto-scroll the log content to the bottom as new chunks arrive.
  const scrollRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [log]);
  if (hiddenInstallKey === installKey) return null;
  return (
    <div
      className="border-t border-border/70 bg-surface/30"
      data-testid="dependencies-install-log"
    >
      <header className="flex items-center justify-between gap-3 px-4 py-2 text-xs uppercase tracking-[0.12em] text-fg-subtle">
        <span>{t('dependencies.install.log.title')}</span>
        <div className="flex items-center gap-2">
          {isRunning && cancellable ? (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/40 px-2 py-1 text-[11px] normal-case tracking-normal text-fg-base hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              data-testid="dependencies-install-cancel"
            >
              <X size={11} aria-hidden="true" />
              {t('dependencies.install.cancelButton')}
            </button>
          ) : !isRunning ? (
            <button
              type="button"
              onClick={() => setHiddenInstallKey(installKey)}
              className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/40 px-2 py-1 text-[11px] normal-case tracking-normal text-fg-base hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              data-testid="dependencies-install-log-dismiss"
            >
              <X size={11} aria-hidden="true" />
              {t('dependencies.install.log.dismiss')}
            </button>
          ) : null}
        </div>
      </header>
      <pre
        ref={scrollRef}
        className="max-h-40 overflow-auto whitespace-pre-wrap break-words px-4 pb-3 font-mono text-[11px] leading-relaxed text-fg-muted"
        data-testid="dependencies-install-log-output"
      >
        {log.length === 0 ? t('dependencies.install.log.empty') : log}
      </pre>
    </div>
  );
}

function EmptyState({
  title,
  body,
}: {
  readonly title: string;
  readonly body: string;
}) {
  return (
    <div
      className="flex h-full min-h-0 flex-col items-center justify-center gap-2 bg-background px-6 text-center"
      data-testid="dependencies-panel-empty"
    >
      <Boxes size={20} aria-hidden="true" className="text-fg-subtle" />
      <p className="text-sm font-semibold text-fg-base">{title}</p>
      <p className="max-w-[44ch] text-[12.5px] leading-relaxed text-fg-muted">
        {body}
      </p>
    </div>
  );
}

// `PillTone` exported for tests that want to assert the closed enum is
// exhaustive against `DependencyStatus`. Renamed to avoid eslint
// "unused" since the component does not consume the value directly.
export type { PillTone };
