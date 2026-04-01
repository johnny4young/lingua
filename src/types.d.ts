declare module 'electron-squirrel-startup' {
  const started: boolean;
  export default started;
}

// ---------------------------------------------------------------- Go types

interface GoDetectResult {
  installed: boolean;
  version?: string;
  goRoot?: string;
  error?: string;
}

interface GoCompileResult {
  success: boolean;
  wasmBytes?: number[];
  wasmExecJs?: string;
  error?: string;
  goVersion?: string;
}

// -------------------------------------------------------------- Rust types

interface RustDetectResult {
  installed: boolean;
  version?: string;
  error?: string;
}

interface RustRunResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
}

// ------------------------------------------------------- File system types

interface FsDirEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

interface FsStatResult {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  mtime: string;
  ctime: string;
}

interface FsChangedEvent {
  dirPath: string;
  eventType: string;
  filename: string | null;
}

// --------------------------------------------------------------- Main API

interface RunLangAPI {
  platform: string;

  go: {
    detect: () => Promise<GoDetectResult>;
    compile: (sourceCode: string) => Promise<GoCompileResult>;
  };

  rust: {
    detect: () => Promise<RustDetectResult>;
    run: (sourceCode: string) => Promise<RustRunResult>;
  };

  fs: {
    selectDirectory: () => Promise<string | null>;
    selectFile: () => Promise<string | null>;
    readdir: (dirPath: string) => Promise<FsDirEntry[]>;
    stat: (filePath: string) => Promise<FsStatResult>;
    read: (filePath: string) => Promise<string>;
    write: (filePath: string, content: string) => Promise<boolean>;
    delete: (filePath: string, isDirectory?: boolean) => Promise<boolean>;
    rename: (oldPath: string, newName: string) => Promise<string>;
    mkdir: (dirPath: string) => Promise<boolean>;
    touch: (filePath: string) => Promise<boolean>;
    watchStart: (dirPath: string) => Promise<string>;
    watchStop: (watchId: string) => Promise<boolean>;
    onChanged: (callback: (event: FsChangedEvent) => void) => () => void;
  };
}

// Augment Window with RunLang API
interface Window {
  runlang: RunLangAPI;
}
