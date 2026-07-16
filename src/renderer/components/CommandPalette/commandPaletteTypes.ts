import type { DeveloperUtilityId } from '../../data/developerUtilities';
import type { ExecutionHistoryEntry } from '../../stores/executionHistoryStore';

export interface CommandPaletteProps {
  /**
   * RL-113 — `recent` renders the Cmd+; recent-commands stack (last 8
   * executed action ids, numbered 1-8, no free-text search) instead of
   * the full searchable launcher. Defaults to `all`.
   */
  variant?: 'all' | 'recent';
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenWhatsNew: () => void;
  onStartGuidedTour: () => void;
  onOpenSnippets: () => void;
  onOpenProjectSearch?: () => void;
  onOpenProjectReplace?: () => void;
  onOpenHttpWorkspace?: () => void;
  onOpenSqlWorkspace?: () => void;
  onOpenGoToSymbol?: () => void;
  onOpenDeveloperUtility?: (id: DeveloperUtilityId) => void;
  onOpenKeyboardShortcuts?: () => void;
  /**
   * RL-028 fourth slice — fires the "Re-run last execution" palette
   * action. Owned by the AppChrome layer so the palette doesn't have
   * to know about runner internals.
   */
  onRerunLast?: () => void;
  /**
   * RL-103 Slice 1 fold C — fires the "New project from template…"
   * palette action. The handler typically focuses the Welcome screen
   * (or opens it) so the user picks a card.
   */
  onNewProjectFromTemplate?: () => void;
  /**
   * RL-028 sixth slice trailer — fires when the user activates a
   * per-entry "Replay {language} run …" palette action. The handler
   * dispatches `replayHistoryEntry(entry, ...)` so the run does not
   * append another history entry.
   */
  onReplayEntry?: (entry: ExecutionHistoryEntry) => void;
  /**
   * RL-037 Vim slice — fires the "Toggle Vim mode" palette action.
   * Optional; when omitted the command is hidden.
   */
  onToggleVimMode?: () => void;
  /**
   * RL-094 Slice 2 — fires the "Import capsule from JSON" palette
   * action. Caller (App.tsx) opens the `capsule-import` AppOverlay.
   * Optional; when omitted the action hides so the model stays
   * honest about wired surfaces.
   */
  onOpenCapsuleImport?: () => void;
  onBrowseCapsules?: () => void;
  onExportProjectBundle?: () => void;
  onImportProjectBundle?: () => void;
  onOpenImportOverlay?: () => void;
  /**
   * RL-039 Slice B fold A — opens the Recipes overlay (`Mod+Alt+L`).
   */
  onOpenRecipes?: () => void;
  /**
   * RL-043 Slice A fold A — creates a fresh notebook tab (`Mod+Alt+N`).
   */
  onNewNotebook?: () => void;
  /**
   * RL-043 Slice E fold E — export the active notebook as `.linguanb`.
   */
  onExportActiveNotebookLinguanb?: () => void;
}
