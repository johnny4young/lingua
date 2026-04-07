/// <reference types="vite/client" />

declare module 'electron-squirrel-startup' {
  const started: boolean;
  export default started;
}

declare module 'fengari' {
  export interface FengariLuaState {
    readonly __brand: unique symbol;
  }

  export interface FengariLuaApi {
    LUA_OK: number;
    LUA_MULTRET: number;
    LUA_TNIL: number;
    LUA_TBOOLEAN: number;
    LUA_TNUMBER: number;
    LUA_TSTRING: number;
    lua_close: (state: FengariLuaState) => void;
    lua_gettop: (state: FengariLuaState) => number;
    lua_type: (state: FengariLuaState, index: number) => number;
    lua_toboolean: (state: FengariLuaState, index: number) => boolean | number;
    lua_isinteger: (state: FengariLuaState, index: number) => boolean;
    lua_tointeger: (state: FengariLuaState, index: number) => number;
    lua_tonumber: (state: FengariLuaState, index: number) => number;
    lua_tojsstring: (state: FengariLuaState, index: number) => string | null;
    lua_pop: (state: FengariLuaState, count: number) => void;
    lua_pcall: (
      state: FengariLuaState,
      nargs: number,
      nresults: number,
      errfunc: number
    ) => number;
    lua_pushjsfunction: (
      state: FengariLuaState,
      fn: (state: FengariLuaState) => number
    ) => void;
    lua_setglobal: (state: FengariLuaState, name: Uint8Array) => void;
  }

  export interface FengariLauxlibApi {
    luaL_newstate: () => FengariLuaState | null;
    luaL_loadstring: (state: FengariLuaState, source: Uint8Array) => number;
    luaL_tolstring: (state: FengariLuaState, index: number) => void;
  }

  export interface FengariLualibApi {
    luaL_openlibs: (state: FengariLuaState) => void;
  }

  export const lua: FengariLuaApi;
  export const lauxlib: FengariLauxlibApi;
  export const lualib: FengariLualibApi;
  export function to_luastring(value: string, cache?: boolean): Uint8Array;
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

// ------------------------------------------------------------ Updater types

type UpdateStatus =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloaded'
  | 'error';

interface UpdateState {
  status: UpdateStatus;
  supported: boolean;
  enabled: boolean;
  message: string;
  releaseName?: string;
  releaseNotes?: string;
  updateURL?: string;
  lastCheckedAt?: string;
}

// ------------------------------------------------------------- Plugin types

type PluginInstallStatus =
  | 'loaded'
  | 'disabled'
  | 'invalid'
  | 'incompatible'
  | 'unavailable';

interface InstalledPluginManifest {
  pluginId: string;
  apiVersion: 1;
  enabled?: boolean;
  minAppVersion?: string;
  maxAppVersion?: string;
}

interface InstalledPluginRecord {
  pluginId: string;
  manifestPath: string;
  installDirectory: string;
  apiVersion: number | null;
  enabled: boolean;
  status: PluginInstallStatus;
  message: string;
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

  updates: {
    getState: () => Promise<UpdateState>;
    check: () => Promise<UpdateState>;
    restartToApply: () => Promise<boolean>;
    onStateChanged: (callback: (state: UpdateState) => void) => () => void;
  };

  plugins: {
    getInstallDirectory: () => Promise<string | null>;
    list: () => Promise<InstalledPluginRecord[]>;
  };
}

// Augment Window with RunLang API
interface Window {
  runlang: RunLangAPI;
}

interface MonacoEnvironmentShape {
  getWorker: (workerId: string, label: string) => Worker;
}

declare global {
  var MonacoEnvironment: MonacoEnvironmentShape;
}
