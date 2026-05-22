/**
 * RL-025 Slice A — bottom-panel "Dependencies" tab body.
 *
 * Read-only: shows one row per detected dependency for the active
 * tab plus a localized status pill. Install button renders but
 * stays disabled in Slice A; Slice B / C will wire it up to the
 * dependency adapter's install path.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Boxes, Package, Download } from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useDependencyDetectionStore } from '../../stores/dependencyDetectionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { ClassifiedDependency } from '../../stores/dependencyDetectionStore';
import type { DependencyStatus } from '../../../shared/dependencies/types';

type PillTone = 'detected' | 'installed' | 'installing' | 'failed' | 'unsupported' | 'needs-desktop';

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
  const detectionEnabled = useSettingsStore(
    (s) => s.dependencyDetectionEnabled
  );
  const isWeb =
    typeof window !== 'undefined' && window.lingua?.platform === 'web';

  const rows = useMemo<readonly ClassifiedDependency[]>(
    () => detection?.dependencies ?? [],
    [detection]
  );

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
        <span className="text-[10.5px] normal-case tracking-normal text-fg-muted">
          {t('dependencies.privacyNote')}
        </span>
      </header>
      <ul
        className="min-h-0 flex-1 overflow-y-auto divide-y divide-border/60"
        data-testid="dependencies-panel-list"
      >
        {rows.map((row) => (
          <DependencyRow key={row.name} dep={row} isWeb={isWeb} />
        ))}
      </ul>
    </div>
  );
}

function DependencyRow({
  dep,
  isWeb,
}: {
  readonly dep: ClassifiedDependency;
  readonly isWeb: boolean;
}) {
  const { t } = useTranslation();
  const status = dep.status;
  const tooltipKey =
    status === 'needs-desktop'
      ? 'dependencies.install.needsDesktopTooltip'
      : isWeb
        ? 'dependencies.install.webUnavailableTooltip'
        : 'dependencies.install.disabledTooltip';
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
        disabled
        title={t(tooltipKey)}
        aria-label={t('dependencies.install.button')}
        className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-surface/40 px-2 py-1 text-[11px] text-fg-muted opacity-60 cursor-not-allowed"
        data-testid={`dependency-install-${dep.name}`}
      >
        <Download size={11} aria-hidden="true" />
        {t('dependencies.install.button')}
      </button>
    </li>
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
