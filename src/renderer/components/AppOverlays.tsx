import { lazy, Suspense } from 'react';
import { CommandPalette } from './CommandPalette/CommandPalette';
import { GoToSymbol } from './GoToSymbol/GoToSymbol';
import { ProjectSearch } from './ProjectSearch/ProjectSearch';
import { ProjectReplace } from './ProjectReplace/ProjectReplace';
import { QuickOpen } from './QuickOpen/QuickOpen';
import { KeyboardShortcutsModal } from './KeyboardShortcuts/KeyboardShortcutsModal';
import { SnippetsModal } from './Snippets';
import { ProjectTemplatesOverlay } from './Welcome/ProjectTemplatesOverlay';
import { CapsuleImportOverlay } from './CapsuleImport';
import { ProjectBundleImportOverlay } from './ProjectBundle/ProjectBundleImportOverlay';
import { CapsuleListOverlay } from './CapsuleList';
import { claimCapsuleListSurface } from './CapsuleList/capsuleListSurface';
import { ImportPreviewOverlay } from './ImportPreview/ImportPreviewOverlay';
import { RecipesOverlay } from './Recipes/RecipesOverlay';
import { SettingsModal } from './Settings/SettingsModal';
import { WhatsNewSection } from './Settings/WhatsNewSection';
import { replayHistoryEntry } from '../utils/replayHistoryEntry';
import { CHANGELOG_ENTRIES } from '../data/changelog';
import { type DeveloperUtilityId } from '../data/developerUtilities';
import {
  openHttpWorkspaceTab,
  openSqlWorkspaceTab,
} from '../runtime/openWorkspaceTab';
import { useRecipeStore } from '../stores/recipeStore';
import { useEditorStore } from '../stores/editorStore';
import { useSettingsStore } from '../stores/settingsStore';
import { trackEvent } from '../utils/telemetry';
import type { AppOverlay } from '../hooks/useGlobalShortcuts';

const DeveloperUtilitiesModal = lazy(async () => {
  const module = await import('./DeveloperUtilities');
  return { default: module.DeveloperUtilitiesModal };
});

/**
 * RL-039 Slice B — Recipes overlay mount. Visibility flag lives on
 * `useRecipeStore.overlayOpen` instead of the single-slot `AppOverlay`
 * union so the overlay can co-exist with a recipe-bound tab being
 * active (the user opens a second recipe while the first tab keeps
 * its binding).
 */
function RecipesOverlayMount() {
  const overlayOpen = useRecipeStore((s) => s.overlayOpen);
  const closeOverlay = useRecipeStore((s) => s.closeOverlay);
  if (!overlayOpen) return null;
  return <RecipesOverlay onClose={closeOverlay} />;
}

/**
 * RL-131 (AUDIT-11) — the single-slot overlay layer, extracted verbatim from
 * `AppChrome` in `App.tsx`. Renders whichever overlay the `AppOverlay` union
 * selects (plus the recipe overlay, which has its own `useRecipeStore` flag).
 * `AppChrome` keeps ownership of the overlay STATE + the open/close/toggle
 * controls and the always-mounted chrome (status banner, consent modal, etc.);
 * this component is purely the conditional render fan-out, driven by props.
 */
export interface AppOverlaysProps {
  overlay: AppOverlay;
  openOverlay: (
    overlay: Exclude<AppOverlay, 'none'>,
    utilityId?: DeveloperUtilityId
  ) => void;
  closeOverlay: () => void;
  onStartGuidedTour: () => void;
  onOpenDeveloperUtility: (utilityId?: DeveloperUtilityId) => void;
  selectedUtilityId: DeveloperUtilityId;
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
  selectedUtilityId,
  run,
  isRunning,
  exportProjectBundle,
}: AppOverlaysProps) {
  return (
    <>
      {overlay === 'quick-open' && <QuickOpen onClose={closeOverlay} />}
      {overlay === 'search' && <ProjectSearch onClose={closeOverlay} />}
      {overlay === 'replace' && <ProjectReplace onClose={closeOverlay} />}
      {overlay === 'go-to-symbol' && <GoToSymbol onClose={closeOverlay} />}
      {overlay === 'palette' && (
        <CommandPalette
          onClose={closeOverlay}
          onOpenSettings={() => openOverlay('settings')}
          onOpenWhatsNew={() => openOverlay('whats-new')}
          onStartGuidedTour={onStartGuidedTour}
          onOpenSnippets={() => openOverlay('snippets')}
          onOpenProjectSearch={() => openOverlay('search')}
          onOpenProjectReplace={() => openOverlay('replace')}
          onOpenHttpWorkspace={() => {
            // RL-097 Slice 1 → MOV.02 (FASE 3) — palette opens or
            // focuses the full-screen HTTP workspace tab (no dock
            // panel). Same create-or-focus path as Mod+Shift+K.
            openHttpWorkspaceTab();
          }}
          onOpenSqlWorkspace={() => {
            // RL-097 Slice 2 → MOV.02 (FASE 3) — palette opens or
            // focuses the full-screen SQL workspace tab. Mirror of
            // `onOpenHttpWorkspace`.
            openSqlWorkspaceTab();
          }}
          onOpenGoToSymbol={() => openOverlay('go-to-symbol')}
          onOpenDeveloperUtility={(utilityId) => onOpenDeveloperUtility(utilityId)}
          onOpenKeyboardShortcuts={() => openOverlay('keyboard-shortcuts')}
          onRerunLast={() => void run()}
          onReplayEntry={(entry) => {
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
          onOpenRecipes={() => useRecipeStore.getState().openOverlay()}
          onNewNotebook={() => useEditorStore.getState().addNotebookTab()}
          onToggleVimMode={() => useSettingsStore.getState().toggleVimMode()}
        />
      )}
      {overlay === 'project-templates' && (
        <ProjectTemplatesOverlay onClose={closeOverlay} />
      )}
      {overlay === 'capsule-import' && (
        <CapsuleImportOverlay onClose={closeOverlay} />
      )}
      {overlay === 'capsule-list' && (
        <CapsuleListOverlay onClose={closeOverlay} />
      )}
      {overlay === 'import-preview' && (
        <ImportPreviewOverlay onClose={closeOverlay} />
      )}
      {overlay === 'project-bundle-import' && (
        <ProjectBundleImportOverlay onClose={closeOverlay} />
      )}
      {/* RL-039 Slice B — Recipes overlay. Visibility flag lives on
          `useRecipeStore` (not the AppOverlay union) so the overlay
          can co-exist with a recipe-bound tab being active. */}
      <RecipesOverlayMount />
      {overlay === 'settings' && (
        <SettingsModal
          onClose={closeOverlay}
          onOpenWhatsNew={() => openOverlay('whats-new')}
          onStartGuidedTour={onStartGuidedTour}
          onOpenKeyboardShortcuts={() => openOverlay('keyboard-shortcuts')}
        />
      )}
      {overlay === 'whats-new' && (
        <WhatsNewSection entries={CHANGELOG_ENTRIES} onClose={closeOverlay} />
      )}
      {overlay === 'snippets' && <SnippetsModal onClose={closeOverlay} />}
      {overlay === 'utilities' && (
        <Suspense fallback={null}>
          <DeveloperUtilitiesModal
            key={selectedUtilityId}
            onClose={closeOverlay}
            initialUtilityId={selectedUtilityId}
          />
        </Suspense>
      )}
      {overlay === 'keyboard-shortcuts' && (
        <KeyboardShortcutsModal onClose={closeOverlay} />
      )}
    </>
  );
}
