import { lazy, Suspense } from 'react';
import { claimCapsuleListSurface } from './CapsuleList/capsuleListSurface';
import { replayHistoryEntry } from '../utils/replayHistoryEntry';
import type { DeveloperUtilityId } from '../data/developerUtilityCatalog';
import { openHttpWorkspaceTab, openSqlWorkspaceTab } from '../runtime/openWorkspaceTab';
import { loadActiveNotebookExporter } from '../runtime/exportActiveNotebookLoader';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import { trackEvent } from '../utils/telemetry';
import type { AppOverlay } from '../hooks/useGlobalShortcuts';
import { requestSettingsTarget } from './Settings/pendingSettingsTab';

/**
 * Every overlay is conditionally rendered, so none of them is needed to paint
 * the app — yet importing them here statically put all of them, plus what they
 * drag along (Settings sections, the 77 KiB changelog, the Postman importer),
 * into the boot payload. `<AppOverlays>` is mounted unconditionally by `App`,
 * which is what makes a static import here so expensive.
 *
 * `fallback={null}` matches `AppLayout`: an overlay the user just asked for
 * appears a frame or two later instead of flashing a spinner over the
 * workspace.
 */
const CommandPalette = lazy(async () => ({
  default: (await import('./CommandPalette/CommandPalette')).CommandPalette,
}));
const GoToSymbol = lazy(async () => ({
  default: (await import('./GoToSymbol/GoToSymbol')).GoToSymbol,
}));
const ProjectSearch = lazy(async () => ({
  default: (await import('./ProjectSearch/ProjectSearch')).ProjectSearch,
}));
const ProjectReplace = lazy(async () => ({
  default: (await import('./ProjectReplace/ProjectReplace')).ProjectReplace,
}));
const QuickOpen = lazy(async () => ({
  default: (await import('./QuickOpen/QuickOpen')).QuickOpen,
}));
const KeyboardShortcutsModal = lazy(async () => ({
  default: (await import('./KeyboardShortcuts/KeyboardShortcutsModal')).KeyboardShortcutsModal,
}));
const SnippetsModal = lazy(async () => ({
  default: (await import('./Snippets')).SnippetsModal,
}));
const ProjectTemplatesOverlay = lazy(async () => ({
  default: (await import('./Welcome/ProjectTemplatesOverlay')).ProjectTemplatesOverlay,
}));
const ProjectTestsOverlay = lazy(async () => ({
  default: (await import('./ProjectTests/ProjectTestsOverlay')).ProjectTestsOverlay,
}));
const CapsuleImportOverlay = lazy(async () => ({
  default: (await import('./CapsuleImport')).CapsuleImportOverlay,
}));
const ProjectBundleImportOverlay = lazy(async () => ({
  default: (await import('./ProjectBundle/ProjectBundleImportOverlay')).ProjectBundleImportOverlay,
}));
const CapsuleListOverlay = lazy(async () => ({
  default: (await import('./CapsuleList')).CapsuleListOverlay,
}));
const ImportPreviewOverlay = lazy(async () => ({
  default: (await import('./ImportPreview/ImportPreviewOverlay')).ImportPreviewOverlay,
}));
const RecipesOverlay = lazy(async () => ({
  default: (await import('./Recipes/RecipesOverlay')).RecipesOverlay,
}));
const SettingsModal = lazy(async () => ({
  default: (await import('./Settings/SettingsModal')).SettingsModal,
}));
const WhatsNewOverlay = lazy(async () => ({
  default: (await import('./Settings/WhatsNewOverlay')).WhatsNewOverlay,
}));

/**
 * Keep the common no-notebook path synchronous and cheap. The exporter reads
 * notebook state and owns serialization, disk/download handling, and
 * telemetry, so it is requested only when the active tab can use it.
 */
async function exportActiveNotebookFromPalette(): Promise<void> {
  const tab = getActiveTab(useEditorStore.getState());
  if (!tab || tab.kind !== 'notebook') {
    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      messageKey: 'notebook.notice.exportNoActiveNotebook',
      priority: 'high',
    });
    return;
  }

  try {
    const { exportActiveNotebookAsLinguanb } = await loadActiveNotebookExporter();
    exportActiveNotebookAsLinguanb();
  } catch (error) {
    console.error('[notebook-export] Failed to load exporter', error);
    useUIStore.getState().pushStatusNotice({
      tone: 'error',
      messageKey: 'notebook.notice.exportFailed',
    });
  }
}

/**
 * internal — the single-slot overlay layer, extracted verbatim from
 * `AppChrome` in `App.tsx`. Renders whichever overlay the `AppOverlay` union
 * selects.
 * `AppChrome` keeps ownership of the overlay STATE + the open/close/toggle
 * controls and the always-mounted chrome (status banner, consent modal, etc.);
 * this component is purely the conditional render fan-out, driven by props.
 */
export interface AppOverlaysProps {
  overlay: AppOverlay;
  openOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
  closeOverlay: () => void;
  onStartGuidedTour: () => void;
  onOpenDeveloperUtility: (utilityId?: DeveloperUtilityId) => void;
  run: () => void | Promise<void>;
  isRunning: boolean;
  exportProjectBundle: () => void | Promise<void>;
}

export function AppOverlays({
  overlay,
  openOverlay,
  closeOverlay,
  onStartGuidedTour,
  onOpenDeveloperUtility,
  run,
  isRunning,
  exportProjectBundle,
}: AppOverlaysProps) {
  return (
    <Suspense fallback={null}>
      {overlay === 'quick-open' && <QuickOpen onClose={closeOverlay} />}
      {overlay === 'search' && <ProjectSearch onClose={closeOverlay} />}
      {overlay === 'replace' && <ProjectReplace onClose={closeOverlay} />}
      {overlay === 'go-to-symbol' && <GoToSymbol onClose={closeOverlay} />}
      {(overlay === 'palette' || overlay === 'recent-commands') && (
        <CommandPalette
          key={overlay}
          // internal — Cmd+; renders the same palette pre-scoped to the
          // per-session recent-commands stack (numbered 1-8, no search).
          variant={overlay === 'recent-commands' ? 'recent' : 'all'}
          onClose={closeOverlay}
          onOpenSettings={() => openOverlay('settings')}
          onOpenWhatsNew={() => openOverlay('whats-new')}
          onStartGuidedTour={onStartGuidedTour}
          onOpenSnippets={() => openOverlay('snippets')}
          onOpenProjectSearch={() => openOverlay('search')}
          onOpenProjectReplace={() => openOverlay('replace')}
          onOpenHttpWorkspace={() => {
            // implementation → MOV.02 (FASE 3) — palette opens or
            // focuses the full-screen HTTP workspace tab (no dock
            // panel). Same create-or-focus path as Mod+Shift+K.
            openHttpWorkspaceTab();
          }}
          onOpenSqlWorkspace={() => {
            // implementation → MOV.02 (FASE 3) — palette opens or
            // focuses the full-screen SQL workspace tab. Mirror of
            // `onOpenHttpWorkspace`.
            openSqlWorkspaceTab();
          }}
          onOpenGoToSymbol={() => openOverlay('go-to-symbol')}
          onOpenDeveloperUtility={utilityId => onOpenDeveloperUtility(utilityId)}
          onOpenKeyboardShortcuts={() => openOverlay('keyboard-shortcuts')}
          onRunActiveTab={() => void run()}
          onOpenProject={() => useProjectStore.getState().openProject()}
          onOpenProjectTests={() => openOverlay('project-tests')}
          onOpenProjectTerminal={
            useProjectStore.getState().currentProject && window.lingua?.projectTerminal
              ? () => useUIStore.getState().openBottomPanel('project-terminal')
              : undefined
          }
          onApplyLicense={() =>
            requestSettingsTarget('account', 'license-token-input', () => openOverlay('settings'))
          }
          onRerunLast={() => void run()}
          onReplayEntry={entry => {
            // Gate telemetry on the actual replay dispatch so a refused
            // call (already-running, no-snapshot, open-failed) does
            // not inflate adoption counts. Same pattern in the pill +
            // popover surfaces; centralizing here would require an
            // extra closure layer for marginal gain.
            const dispatched = replayHistoryEntry(entry, { isRunning, run });
            if (dispatched) {
              void trackEvent('runtime.history_replay', {
                language: entry.language,
                status: entry.status,
                surface: 'palette',
              });
            }
          }}
          onNewProjectFromTemplate={() => openOverlay('project-templates')}
          onOpenCapsuleImport={() => openOverlay('capsule-import')}
          onBrowseCapsules={() => {
            claimCapsuleListSurface('palette');
            openOverlay('capsule-list');
          }}
          onExportProjectBundle={() => void exportProjectBundle()}
          onImportProjectBundle={() => openOverlay('project-bundle-import')}
          onOpenImportOverlay={() => openOverlay('import-preview')}
          onOpenRecipes={() => openOverlay('recipes')}
          onNewNotebook={() => useEditorStore.getState().addNotebookTab()}
          onExportActiveNotebookLinguanb={() => void exportActiveNotebookFromPalette()}
          onToggleVimMode={() => useSettingsStore.getState().toggleVimMode()}
        />
      )}
      {overlay === 'project-templates' && <ProjectTemplatesOverlay onClose={closeOverlay} />}
      {overlay === 'project-tests' && <ProjectTestsOverlay onClose={closeOverlay} />}
      {overlay === 'capsule-import' && <CapsuleImportOverlay onClose={closeOverlay} />}
      {overlay === 'capsule-list' && <CapsuleListOverlay onClose={closeOverlay} />}
      {overlay === 'import-preview' && <ImportPreviewOverlay onClose={closeOverlay} />}
      {overlay === 'project-bundle-import' && <ProjectBundleImportOverlay onClose={closeOverlay} />}
      {overlay === 'recipes' && <RecipesOverlay onClose={closeOverlay} />}
      {overlay === 'settings' && (
        <SettingsModal
          onClose={closeOverlay}
          onOpenWhatsNew={() => openOverlay('whats-new')}
          onStartGuidedTour={onStartGuidedTour}
          onOpenKeyboardShortcuts={() => openOverlay('keyboard-shortcuts')}
        />
      )}
      {overlay === 'whats-new' && <WhatsNewOverlay onClose={closeOverlay} />}
      {overlay === 'snippets' && <SnippetsModal onClose={closeOverlay} />}
      {overlay === 'keyboard-shortcuts' && <KeyboardShortcutsModal onClose={closeOverlay} />}
    </Suspense>
  );
}
