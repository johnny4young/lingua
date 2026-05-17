import { Search, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '../../stores/editorStore';
import { IconButton } from '../ui/chrome';
import { LicenseBadge } from '../Toolbar/LicenseBadge';
import { cn } from '../../utils/cn';

interface AppChromeProps {
  onOpenSettings?: () => void;
  onOpenPalette?: () => void;
}

/**
 * RL-093 Slice 3 — Signal-Slate v2 chrome row above the main toolbar.
 * Three-column grid: traffic-light spacer + sidebar handle (left, ~120px
 * on macOS for the native window controls), app mark + active filename
 * + unsaved dot + LicenseBadge (centre), search + settings (right). The
 * row itself is the OS drag region; interactive children opt out via
 * `no-drag`.
 */
export function AppChrome({ onOpenSettings, onOpenPalette }: AppChromeProps) {
  const { t } = useTranslation();
  const activeTab = useEditorStore((state) => {
    const tab = state.tabs.find((item) => item.id === state.activeTabId);
    return tab ?? null;
  });
  const isWebBuild =
    typeof window !== 'undefined' && window.lingua?.platform === 'web';
  const filename = activeTab?.name ?? t('chrome.filename.untitled');
  const isDirty = activeTab?.isDirty === true;

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
      <div className="flex min-w-0 flex-1 items-center justify-center gap-2 text-[11.5px] font-mono">
        <span
          aria-label={t('chrome.mark.aria')}
          className="inline-flex h-3 w-3 items-center justify-center rounded-[3px] bg-primary text-[8px] font-bold text-background"
        >
          L
        </span>
        <span className="text-fg-muted" aria-hidden="true">
          {t('chrome.appName').toLowerCase()}
        </span>
        <span className="text-fg-subtle" aria-hidden="true">·</span>
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
            className="inline-flex items-center gap-1 rounded-[2px] border border-border-strong/70 px-1 py-px font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-warning"
          >
            <span
              aria-hidden="true"
              className="inline-block h-1.5 w-1.5 rounded-full bg-warning"
            />
            {t('chrome.unsaved.label')}
          </span>
        ) : null}
        <LicenseBadge onClick={onOpenSettings} />
      </div>
      <div className="flex min-w-[80px] items-center justify-end gap-1 pl-2">
        <IconButton
          data-testid="app-chrome-search"
          onClick={onOpenPalette}
          tooltip={t('chrome.search.tooltip')}
          aria-label={t('chrome.search.aria')}
          tooltipSide="bottom"
          className="size-7"
        >
          <Search size={13} aria-hidden="true" />
        </IconButton>
        <IconButton
          data-testid="app-chrome-settings"
          onClick={onOpenSettings}
          tooltip={t('chrome.settings.tooltip')}
          aria-label={t('chrome.settings.aria')}
          tooltipSide="bottom"
          className="size-7"
        >
          <Settings size={13} aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  );
}
