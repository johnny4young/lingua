export type AppLanguage = 'system' | 'en' | 'es';

export type BuiltInLanguage =
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'python'
  | 'rust'
  | 'json'
  | 'yaml'
  | 'dotenv'
  | 'toml'
  | 'ini'
  | 'csv';

/**
 * Language ids used across the editor.
 * Plugins may introduce additional string identifiers beyond the built-ins.
 */
export type Language = BuiltInLanguage | (string & {});

export interface FileTab {
  id: string;
  name: string;
  language: Language;
  content: string;
  isDirty: boolean;
  /** Absolute path on disk. Undefined for in-memory (unsaved) files. */
  filePath?: string;
}

/**
 * Either `filePath` OR `tabId` pins the request to a target tab:
 *
 *   - `filePath` mode — used by Project Search and future open-from-link
 *     flows. The reveal is queued BEFORE the tab exists; CodeEditor applies
 *     it when the tab with that file path becomes active.
 *   - `tabId` mode — used by same-tab surfaces such as Go to Symbol, where
 *     the target tab is already mounted but may be unsaved (no filePath).
 *
 * When both are supplied, `tabId` wins since it's the tighter identity.
 */
export interface EditorRevealRequest {
  filePath?: string;
  tabId?: string;
  line: number;
  column?: number;
}

export interface EditorState {
  tabs: FileTab[];
  activeTabId: string | null;
  /**
   * Pending request to scroll the editor to a specific line/column once the
   * target file becomes the active tab. `null` when no reveal is queued.
   */
  pendingReveal: EditorRevealRequest | null;
  addTab: (tab: Omit<FileTab, 'isDirty'>) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
  /** Open a file from disk. If already open, activates that tab. */
  openFile: (filePath: string, name: string, language: Language) => Promise<void>;
  /** Open a native file picker and open the selected file in a new tab. */
  openFileFromDisk: () => Promise<void>;
  /** Save the active tab's content to disk (only if it has a filePath). */
  saveActiveTab: () => Promise<void>;
  /** Show a Save As dialog and save the active tab to the chosen path. */
  saveActiveTabAs: () => Promise<void>;
  /**
   * Persist a specific tab, optionally forcing a Save As dialog even when the
   * tab already has a file path. Returns false when the user cancels Save As.
   */
  saveTabById: (id: string, forceSaveAs?: boolean) => Promise<boolean>;
  /** Close a tab with dirty-check prompt. Returns true if closed. */
  closeTab: (id: string) => Promise<boolean>;
  /** Duplicate the active tab into a new unsaved tab. */
  duplicateActiveTab: () => void;
  /**
   * Queue a scroll + caret move that the CodeEditor applies once the target
   * file is the active tab. Latest request wins so rapid clicks in Project
   * Search do not leave the editor ping-ponging between positions.
   */
  requestReveal: (target: EditorRevealRequest) => void;
  /** Clear any pending reveal. The CodeEditor calls this after applying it. */
  clearPendingReveal: () => void;
}

export type ConsoleEntryType = 'log' | 'warn' | 'error' | 'info' | 'result';

export interface ConsoleEntry {
  id: string;
  type: ConsoleEntryType;
  content: string;
  timestamp: number;
  line?: number;
  /** Execution time in ms — shown as a badge when set (only on the last entry) */
  executionTime?: number;
}

export interface ConsoleState {
  entries: ConsoleEntry[];
  /** Which entry types are currently visible */
  activeFilters: Set<ConsoleEntryType>;
  showTimestamps: boolean;
  addEntry: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => void;
  clear: () => void;
  toggleFilter: (type: ConsoleEntryType) => void;
  toggleTimestamps: () => void;
}

export type LayoutPreset = 'horizontal' | 'vertical' | 'editor-only';

export interface SettingsState {
  theme: 'dark' | 'light';
  editorTheme: string;
  fontSize: number;
  fontFamily: string;
  fontLigatures: boolean;
  showLineNumbers: boolean;
  wordWrap: boolean;
  minimap: boolean;
  layoutPreset: LayoutPreset;
  loopProtection: boolean;
  maxLoopIterations: number;
  hideUndefined: boolean;
  restoreSession: boolean;
  formatOnSave: boolean;
  language: AppLanguage;
  lastSeenVersion: string | null;
  hasCompletedTour: boolean;
  setTheme: (theme: 'dark' | 'light') => void;
  setEditorTheme: (theme: string) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  toggleFontLigatures: () => void;
  toggleLineNumbers: () => void;
  toggleWordWrap: () => void;
  toggleMinimap: () => void;
  setLayoutPreset: (preset: LayoutPreset) => void;
  toggleLoopProtection: () => void;
  setMaxLoopIterations: (max: number) => void;
  toggleHideUndefined: () => void;
  toggleRestoreSession: () => void;
  toggleFormatOnSave: () => void;
  /**
   * Apply a theme preset (editor theme, shell theme, typography, layout)
   * loaded from an exported JSON document. Non-theme settings (loop
   * protection, session restore, format-on-save, ...) are intentionally
   * left untouched so preset sharing doesn't override safety preferences.
   */
  applyThemePreset: (preset: {
    theme: 'dark' | 'light';
    editorTheme: string;
    fontFamily: string;
    fontSize: number;
    fontLigatures: boolean;
    layoutPreset: LayoutPreset;
  }) => void;
  setLanguage: (language: AppLanguage) => void;
  setLastSeenVersion: (version: string | null) => void;
  setHasCompletedTour: (value: boolean) => void;
}

// --- Runner Types ---

export interface ExecutionContext {
  timeout?: number;
  env?: Record<string, string>;
}

export interface ExecutionError {
  message: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  stack?: string;
}

export interface EditorDiagnostic {
  message: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  severity: 'error' | 'warning' | 'info';
  source?: string;
}

export interface MagicCommentResult {
  line: number;
  value: string;
}

export interface ExecutionResult {
  stdout: ConsoleOutput[];
  stderr: ConsoleOutput[];
  result?: unknown;
  executionTime: number;
  error?: ExecutionError;
  magicResults?: MagicCommentResult[];
}

export interface ConsoleOutput {
  type: 'log' | 'warn' | 'error' | 'info';
  args: string[];
  line?: number;
}

export interface LanguageRunner {
  id: string;
  name: string;
  language: Language;
  extensions: string[];
  init(): Promise<void>;
  execute(code: string, context?: ExecutionContext): Promise<ExecutionResult>;
  stop(): void;
  isReady(): boolean;
}

/** Messages sent from the main thread to the worker */
export type WorkerRequest =
  | { type: 'execute'; code: string; timeout: number }
  | { type: 'stop' };

/** Messages sent from the worker to the main thread */
export type WorkerResponse =
  | { type: 'console'; method: ConsoleOutput['type']; args: string[]; line?: number }
  | { type: 'result'; value?: unknown }
  | { type: 'error'; error: ExecutionError }
  | { type: 'done'; executionTime: number }
  | { type: 'loading'; stage: string }
  | { type: 'ready' }
  | { type: 'magic-comment'; line: number; value: string };
