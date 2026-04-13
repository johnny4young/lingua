export type BuiltInLanguage =
  | 'javascript'
  | 'typescript'
  | 'go'
  | 'python'
  | 'rust';

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

export interface EditorState {
  tabs: FileTab[];
  activeTabId: string | null;
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
  /** Close a tab with dirty-check prompt. Returns true if closed. */
  closeTab: (id: string) => Promise<boolean>;
  /** Duplicate the active tab into a new unsaved tab. */
  duplicateActiveTab: () => void;
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
  showLineNumbers: boolean;
  wordWrap: boolean;
  minimap: boolean;
  layoutPreset: LayoutPreset;
  loopProtection: boolean;
  maxLoopIterations: number;
  hideUndefined: boolean;
  restoreSession: boolean;
  setTheme: (theme: 'dark' | 'light') => void;
  setEditorTheme: (theme: string) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  toggleLineNumbers: () => void;
  toggleWordWrap: () => void;
  toggleMinimap: () => void;
  setLayoutPreset: (preset: LayoutPreset) => void;
  toggleLoopProtection: () => void;
  setMaxLoopIterations: (max: number) => void;
  toggleHideUndefined: () => void;
  toggleRestoreSession: () => void;
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
  stack?: string;
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
