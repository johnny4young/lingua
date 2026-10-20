import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getActiveTab, useEditorStore } from '../../stores/editorStore';
import { cn } from '../../utils/cn';
import { LicenseBadge } from '../Toolbar/LicenseBadge';
import { FloatingActionPill } from '../Toolbar/FloatingActionPill';
import { requestSettingsTab } from '../Settings/pendingSettingsTab';
import { UpdateReadyChip } from './AppChrome';

interface CommandBarProps {
  /** Presenter mode keeps the window title and drops the controls. */
  showControls: boolean;
  onOpenSettings?: () => void;
  onOpenPalette?: () => void;
  onOpenQuickOpen?: () => void;
  onOpenSnippets?: () => void;
  onOpenUtilities?: () => void;
  onOpenRecipes?: () => void;
  utilitiesOpen?: boolean;
}

/**
 * The one 48 px row above the editor: brand and file on the left, the run
 * controls, command icons, license and Settings on the right. The row is the
 * window drag region; controls opt out through the pill's no-drag rule.
 */
export function CommandBar({
  showControls,
  onOpenSettings,
  onOpenPalette,
  onOpenQuickOpen,
  onOpenSnippets,
  onOpenUtilities,
  onOpenRecipes,
  utilitiesOpen,
}: CommandBarProps) {
  const { t } = useTranslation();
  const activeName = useEditorStore(state => getActiveTab(state)?.name);
  const isDirty = useEditorStore(state => getActiveTab(state)?.isDirty === true);
  const platform = typeof window !== 'undefined' ? window.lingua?.platform : undefined;
  const filename = activeName ?? t('chrome.filename.untitled');
  const handleOpenLicenseSettings = useCallback(() => {
    requestSettingsTab('account', onOpenSettings);
  }, [onOpenSettings]);
  const status = (
    <>
      <LicenseBadge onClick={handleOpenLicenseSettings} />
      <UpdateReadyChip onClick={onOpenSettings} />
    </>
  );

  return (
    <header
      data-testid="app-chrome"
      data-tour-id="app-chrome"
      className={cn(
        'command-bar toolbar-drag-region relative z-40 flex h-12 shrink-0 items-center gap-2.5 border-b border-border-subtle bg-bg-panel pr-3',
        // macOS draws the traffic lights inside this row.
        platform === 'darwin' ? 'pl-[84px]' : 'pl-3'
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-label={t('chrome.mark.aria')}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-bold text-fg-on-accent"
        >
          L
        </span>
        <span className="hidden text-[12.5px] font-semibold text-fg-muted min-[1000px]:inline" aria-hidden="true">
          {t('chrome.appName').toLowerCase()}
        </span>
        <span className="hidden text-border-strong min-[1000px]:inline" aria-hidden="true">
          ·
        </span>
        <span
          data-testid="app-chrome-filename"
          className="hidden max-w-[260px] truncate font-mono text-caption text-fg-base min-[760px]:inline"
          title={filename}
        >
          {filename}
        </span>
        {isDirty ? (
          <span
            data-testid="app-chrome-unsaved"
            role="img"
            aria-label={t('chrome.unsaved.aria')}
            className="inline-block size-1.5 shrink-0 rounded-full bg-accent"
          />
        ) : null}
      </div>
      <div className="flex-1" />
      {showControls ? (
        <FloatingActionPill
          docked
          beforeSettings={status}
          onOpenSettings={onOpenSettings}
          onOpenPalette={onOpenPalette}
          onOpenQuickOpen={onOpenQuickOpen}
          onOpenSnippets={onOpenSnippets}
          onOpenUtilities={onOpenUtilities}
          onOpenRecipes={onOpenRecipes}
          utilitiesOpen={utilitiesOpen}
        />
      ) : (
        <div className="flex items-center gap-2">{status}</div>
      )}
    </header>
  );
}
