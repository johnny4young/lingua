import { useEffect, useRef, type ReactNode } from 'react';
import { Group, Panel, useDefaultLayout } from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import { useWidthTier } from '../../hooks/useWidthTier';
import { useWorkspaceSqlStore } from '../../stores/workspaceSqlStore';
import { toggleSqlExplorer, useSqlExplorerDrawerStore } from '../../stores/sqlExplorerDrawerStore';
import { OverlayBackdrop } from '../ui/chrome';
import { ResizeHandle } from '../ui/ResizeHandle';
import { SqlExplorerRail } from './SqlExplorerRail';

/** At or above this width the Explorer sits beside the editor; below it, a rail that opens a drawer. */
const SIDE_BY_SIDE_WIDTHS = [640] as const;

interface SqlExplorerLayoutProps {
  explorer: ReactNode;
  main: ReactNode;
  /** The import file input; `inputOnly` while the Explorer and its Import button are off screen. */
  importInput: (inputOnly: boolean) => ReactNode;
  onCreate: () => void;
  onImport: () => void;
  onShowHistory: () => void;
  isImportBusy: boolean;
}

/** The Explorer beside the editor, folded to its rail (Cmd/Ctrl+B), or under 640 px a rail and a drawer. */
export function SqlExplorerLayout({ explorer, main, importInput, onCreate, onImport, onShowHistory, isImportBusy }: SqlExplorerLayoutProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sidebarLayout = useDefaultLayout({
    id: 'lingua-sql-workspace-sidebar-layout',
    panelIds: ['sql-explorer-pane', 'sql-main-pane'],
    storage: localStorage,
  });
  const compact = useWidthTier(rootRef, SIDE_BY_SIDE_WIDTHS, SIDE_BY_SIDE_WIDTHS.length) === 0;
  const folded = useWorkspaceSqlStore((state) => state.explorerFolded);
  // Guards the first render, before the effect below tells the store.
  const drawerOpen = useSqlExplorerDrawerStore((state) => state.open) && compact;
  const shown = compact ? drawerOpen : !folded;

  useEffect(() => {
    useSqlExplorerDrawerStore.getState().setCompact(compact);
  }, [compact]);
  useEffect(() => () => useSqlExplorerDrawerStore.getState().setCompact(false), []);
  // On the window: Escape right after opening lands before focus moves into the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      useSqlExplorerDrawerStore.getState().setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen]);

  return (
    <div ref={rootRef} data-testid="sql-workspace-body" data-compact={compact ? 'true' : undefined} className="flex min-h-0 flex-1">
      {compact || folded ? (
        <>
          {shown ? null : importInput(true)}
          <SqlExplorerRail
            onUnfold={toggleSqlExplorer}
            onCreate={onCreate}
            onImport={onImport}
            onShowHistory={() => {
              onShowHistory();
              toggleSqlExplorer();
            }}
            isImportBusy={isImportBusy}
          />
          <div className="min-w-0 flex-1">{main}</div>
        </>
      ) : (
        <Group
          orientation="horizontal"
          defaultLayout={sidebarLayout.defaultLayout}
          onLayoutChanged={sidebarLayout.onLayoutChanged}
          resizeTargetMinimumSize={{ coarse: 24, fine: 24 }}
          className="min-h-0 flex-1"
        >
          <Panel id="sql-explorer-pane" defaultSize="22%" minSize={200}>
            <div className="h-full border-r border-border-subtle">{explorer}</div>
          </Panel>
          <ResizeHandle orientation="vertical" />
          <Panel id="sql-main-pane" minSize={360}>
            {main}
          </Panel>
        </Group>
      )}
      {drawerOpen ? (
        <OverlayBackdrop
          portal
          align="top"
          onClose={() => useSqlExplorerDrawerStore.getState().setOpen(false)}
          className="scrim justify-start p-2 pt-18 sm:p-3 sm:pt-20"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={t('sqlWorkspace.explorer.label')}
            data-testid="sql-explorer-drawer"
            className="relative h-full w-[min(24rem,calc(100vw-1rem))] max-w-full overflow-hidden rounded-xl border border-border-default"
          >
            {explorer}
          </div>
        </OverlayBackdrop>
      ) : null}
    </div>
  );
}
