import { Download } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveTab } from '../../hooks/useActiveTab';
import { useUpdateStore } from '../../stores/updateStore';
import { LicenseBadge } from '../Toolbar/LicenseBadge';
import { cn } from '../../utils/cn';
import { emitCommand } from '../../stores/commandBus';

interface AppChromeProps {
  onOpenSettings?: () => void;
}

/**
 * RL-093 Slice 3 — Signal-Slate v2 chrome row above the main toolbar.
 * Three-column grid: traffic-light spacer + sidebar handle (left, ~120px
 * on macOS for the native window controls), app mark + active filename
 * + unsaved dot + LicenseBadge (centre). The command icons live in the
 * floating toolbar/pill so the chrome row remains a quiet window title. The
 * row itself is the OS drag region; interactive children opt out via
 * `no-drag`.
 */
export function AppChrome({ onOpenSettings }: AppChromeProps) {
  const { t } = useTranslation();
  const activeTab = useActiveTab();
  const isWebBuild = typeof window !== 'undefined' && window.lingua?.platform === 'web';
  const filename = activeTab?.name ?? t('chrome.filename.untitled');
  const isDirty = activeTab?.isDirty === true;

  // UX Sweep T5 — the license badge opens Settings AND lands on the
  // Account/License tab (it used to dump the user on General). Two rAFs let
  // SettingsModal mount, paint, and run the effect that registers its
  // command listener before the request fires; emitting earlier can
  // race the mount and be lost.
  const handleOpenLicenseSettings = useCallback(() => {
    onOpenSettings?.();
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        emitCommand('settings.navigate', { tab: 'account' });
      });
    });
  }, [onOpenSettings]);

  return (
    <div
      data-testid="app-chrome"
      data-tour-id="app-chrome"
      className={cn(
        'toolbar-drag-region surface-header relative z-20 flex h-9 shrink-0 items-center justify-between gap-2',
        isWebBuild ? 'px-3' : 'pr-3'
      )}
    >
      <div
        className={cn(
          'flex min-w-[80px] items-center gap-2 text-fg-subtle',
          isWebBuild ? 'pl-0' : 'pl-[78px]'
        )}
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-caption font-mono">
        <span
          aria-label={t('chrome.mark.aria')}
          className="inline-flex h-3 w-3 items-center justify-center rounded-sm bg-primary text-nano font-bold text-background"
        >
          L
        </span>
        <span className="text-fg-muted" aria-hidden="true">
          {t('chrome.appName').toLowerCase()}
        </span>
        <span className="text-fg-subtle" aria-hidden="true">
          ·
        </span>
        <span
          data-testid="app-chrome-filename"
          className="max-w-[260px] truncate font-mono text-fg-base"
          title={filename}
        >
          {filename}
        </span>
        {isDirty ? (
          <span
            data-testid="app-chrome-unsaved"
            aria-label={t('chrome.unsaved.aria')}
            className="inline-flex items-center gap-1 rounded-sm border border-border-strong/70 px-1 py-px font-mono text-micro font-bold uppercase tracking-[0.12em] text-warning"
          >
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-warning" />
            {t('chrome.unsaved.label')}
          </span>
        ) : null}
        <LicenseBadge onClick={handleOpenLicenseSettings} />
        <UpdateReadyChip onClick={onOpenSettings} />
      </div>
      <div className="w-[166px] shrink-0" aria-hidden="true" />
    </div>
  );
}

/**
 * Discoverable badge next to LicenseBadge that surfaces a pending
 * downloaded update. Mirrors the unsaved-dot visual shape so the
 * affordance reads consistently with the rest of the chrome.
 * Visible only on `status === 'downloaded'`; clicking routes the
 * user into Settings → Updates where they can hit Restart.
 */
function UpdateReadyChip({ onClick }: { onClick?: () => void }) {
  const { t } = useTranslation();
  const status = useUpdateStore(state => state.status);
  if (status !== 'downloaded') return null;
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="app-chrome-update-ready"
      aria-label={t('updates.chip.ready')}
      title={t('updates.chip.ready')}
      className="inline-flex items-center gap-1 rounded-sm border border-success/70 px-1 py-px font-mono text-micro font-bold uppercase text-success hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40"
    >
      <Download size={9} aria-hidden="true" />
      {t('updates.chip.ready')}
    </button>
  );
}
