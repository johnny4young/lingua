export type AppOverlay =
  | 'none'
  | 'settings'
  | 'palette'
  // RL-113 — Cmd+; recent-commands stack (the palette's `recent` variant).
  | 'recent-commands'
  | 'quick-open'
  | 'search'
  | 'replace'
  | 'go-to-symbol'
  | 'snippets'
  | 'whats-new'
  | 'keyboard-shortcuts'
  | 'project-templates'
  | 'capsule-import'
  | 'capsule-list'
  | 'import-preview'
  | 'project-bundle-import';

/** Callbacks owned by App and dispatched by the global shortcut catalog. */
export interface UseGlobalShortcutsOptions {
  isRunning: boolean;
  run: () => void | Promise<void>;
  stop: () => void;
  saveActiveTab: () => void | Promise<void>;
  saveActiveTabAs: () => void | Promise<void>;
  openFileFromDisk: () => void | Promise<void>;
  closeActiveTab: () => void | Promise<void>;
  toggleSidebar: () => void;
  toggleConsole: () => void;
  overlay: AppOverlay;
  toggleOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
  openDeveloperUtilities: () => void;
  closeOverlay: () => void;
  toggleHttpWorkspace: () => void;
  toggleSqlWorkspace: () => void;
  openUtilityPipelines: () => void;
  openImportOverlay: () => void;
  exportProjectBundle: () => void;
  openRecipesOverlay: () => void;
  openNewNotebook: () => void;
  cycleRuntimeMode: () => void;
  cycleWorkflowMode: () => void;
  toggleRecentRunsPopover: () => void;
  toggleCompareWithSnapshot: () => void;
  toggleVariableInspector: () => void;
  toggleStdinPanel: () => void;
  resetFloatingPositions: () => void;
  toggleVariableInspectorSurface: () => void;
  exportLatestCapsule: () => void;
  copyShareLink: () => void;
  replayOnboarding: () => void;
  showDependenciesPanel: () => void;
}

export type ShortcutHandler = (event: KeyboardEvent) => void;
