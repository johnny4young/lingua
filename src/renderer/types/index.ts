export type Language = 'javascript' | 'typescript' | 'go' | 'python' | 'rust';

export interface FileTab {
  id: string;
  name: string;
  language: Language;
  content: string;
  isDirty: boolean;
}

export interface EditorState {
  tabs: FileTab[];
  activeTabId: string | null;
  addTab: (tab: Omit<FileTab, 'isDirty'>) => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateContent: (id: string, content: string) => void;
  markSaved: (id: string) => void;
}

export interface ConsoleEntry {
  id: string;
  type: 'log' | 'warn' | 'error' | 'info' | 'result';
  content: string;
  timestamp: number;
  line?: number;
}

export interface ConsoleState {
  entries: ConsoleEntry[];
  addEntry: (entry: Omit<ConsoleEntry, 'id' | 'timestamp'>) => void;
  clear: () => void;
}

export interface SettingsState {
  theme: 'dark' | 'light';
  editorTheme: string;
  fontSize: number;
  fontFamily: string;
  showLineNumbers: boolean;
  wordWrap: boolean;
  minimap: boolean;
  setTheme: (theme: 'dark' | 'light') => void;
  setEditorTheme: (theme: string) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: string) => void;
  toggleLineNumbers: () => void;
  toggleWordWrap: () => void;
  toggleMinimap: () => void;
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

export interface ExecutionResult {
  stdout: ConsoleOutput[];
  stderr: ConsoleOutput[];
  result?: unknown;
  executionTime: number;
  error?: ExecutionError;
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
  | { type: 'console'; method: ConsoleOutput['type']; args: string[] }
  | { type: 'result'; value?: unknown }
  | { type: 'error'; error: ExecutionError }
  | { type: 'done'; executionTime: number }
  | { type: 'loading'; stage: string }
  | { type: 'ready' };
