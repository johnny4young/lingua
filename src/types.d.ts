/// <reference types="vite/client" />

declare const __LINGUA_CHANGELOG_JSON__: string;

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

declare module 'js-yaml' {
  export function load(source: string): unknown;
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

interface NativeRunnerMessages {
  compileOutputTruncated?: string;
  stdoutTruncated?: string;
  stderrTruncated?: string;
}

// ---------------------------------------------------------- Formatter types

type FormatIpcResult =
  | { available: false; reason: 'binary-missing' | 'web-unavailable'; error: string }
  | { available: true; success: true; formatted: string }
  | { available: true; success: false; error: string };

// ------------------------------------------------------- File system types

interface FsDirEntry {
  name: string;
  isDirectory: boolean;
  /** Path relative to the capability's project root. */
  relativePath: string;
}

interface FsIndexedFile {
  name: string;
  /** Path relative to the capability's project root. */
  relativePath: string;
}

interface FsSearchOptions {
  caseSensitive?: boolean;
  /** Maximum matches returned per file. Defaults to 20. */
  maxMatchesPerFile?: number;
  /** Hard cap on total matches across the search. Defaults to 500. */
  maxTotalMatches?: number;
  /** Skip files larger than this (bytes). Defaults to 1,000,000. */
  maxFileSize?: number;
  /** Abort once this many files have been opened. Defaults to 5,000. */
  maxFilesScanned?: number;
}

interface FsSearchMatch {
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

interface FsSearchResult {
  /** Path relative to the capability's project root. */
  relativePath: string;
  matches: FsSearchMatch[];
}

interface FsStatResult {
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  mtime: string;
  ctime: string;
}

interface FsChangedEvent {
  /** Capability id of the project root the watcher belongs to. */
  rootId: string;
  /** Path of the changed entry, relative to the capability's project root. */
  relativePath: string;
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

// -------------------------------------------------------------- App info

interface AppInfo {
  productName: string;
  version: string;
  buildDate: string | null;
  licenseType: string;
  repositoryUrl: string | null;
  websiteUrl: string | null;
  licenseUrl: string | null;
}

// ------------------------------------------------------------- Deep links

type DeepLinkTarget =
  | { kind: 'open-file'; filePath: string; rawUrl: string }
  | { kind: 'open-snippet'; snippetId: string; rawUrl: string }
  | { kind: 'new-file'; language: string; rawUrl: string };

// -------------------------------------------------------- Desktop smoke

interface DesktopSmokeConfig {
  enabled: boolean;
  artifactDir: string | null;
  /**
   * RL-083 Slice 1 — true when the smoke harness is running with
   * `LINGUA_DESKTOP_SMOKE_OFFLINE=1`. The renderer adds a final
   * synthetic case that asserts no remote URL was attempted.
   */
  offline?: boolean;
  /**
   * RL-080 Slice 3 — true when the smoke harness is running against
   * a packaged release artifact (`Lingua.app`) instead of the Vite
   * dev server. The renderer narrows SMOKE_CASES to a 2-case subset
   * (javascript + python) so the release gate stays under ~2 minutes
   * while still exercising the renderer load path and the vendored
   * Pyodide runtime end-to-end.
   */
  packagedSubset?: boolean;
}

// -------------------------------------------------------------- License types

interface LicensePayloadShape {
  productId: string;
  tier: 'free' | 'pro' | 'pro_lifetime' | 'team';
  issuedTo: string;
  issuedAt: string;
  supportWindowEndsAt: string;
  entitlements: readonly string[];
}

interface LicenseVerificationOk {
  ok: true;
  payload: LicensePayloadShape;
  state: 'active' | 'grace';
  supportWindowEndsAt: number;
}

type LicenseStatus =
  | { kind: 'free' }
  | { kind: 'invalid'; reason: string; message?: string }
  | { kind: 'active'; verification: LicenseVerificationOk }
  | { kind: 'grace'; verification: LicenseVerificationOk };

// RL-061 Slice 3.5 — server-derived fields shipped from main to
// renderer via the IPC bridge so the desktop branch of `licenseStore`
// can render the Devices section under the same gate the web build
// already passes (`serverSync === 'synced'` + non-null `devices` +
// `deviceLimit`). Persistence shape unchanged: nothing here goes to
// disk — devices belong on the server, the boot revalidate
// re-fetches them.
interface LicenseServerDevice {
  id: string;
  deviceId: string;
  deviceName: string;
  os: string;
  surface: 'desktop' | 'web';
  activatedAt: number;
  lastSeenAt: number;
}

interface LicenseServerDevicesBucket {
  desktop: LicenseServerDevice[];
  web: LicenseServerDevice[];
}

interface LicenseServerDeviceLimit {
  desktop: number;
  web: number;
}

type LicenseServerSyncState = 'synced' | 'unreachable' | 'disabled';

interface LicenseSnapshot {
  token: string | null;
  status: LicenseStatus;
  deviceId: string;
  lastVerifiedAt: number | null;
  serverSync: LicenseServerSyncState;
  devices: LicenseServerDevicesBucket | null;
  deviceLimit: LicenseServerDeviceLimit | null;
}

type LicenseApplyResult =
  | { ok: true; status: LicenseStatus; snapshot: LicenseSnapshot }
  | { ok: false; reason: string; message?: string };

type LicenseClearResult =
  | { ok: true; snapshot: LicenseSnapshot }
  | { ok: false; reason: string; message?: string };

type LicenseRemoveDeviceResult =
  | { ok: true; removed: boolean; snapshot: LicenseSnapshot }
  | { ok: false; reason: string; message?: string; issues?: string[] };

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

interface LinguaAPI {
  platform: string;

  getSystemLanguages: () => Promise<string[]>;
  getAppInfo: () => Promise<AppInfo>;
  openExternal: (url: string) => Promise<boolean>;

  confirmClose: (dirtyFileNames: string[], language?: string) => Promise<number>;
  confirmCloseTab: (fileName: string, language?: string) => Promise<number>;
  onBeforeClose: (callback: () => void) => () => void;
  forceClose: () => void;

  go: {
    detect: (userEnv?: Record<string, string>) => Promise<GoDetectResult>;
    compile: (
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages
    ) => Promise<GoCompileResult>;
  };

  rust: {
    detect: (userEnv?: Record<string, string>) => Promise<RustDetectResult>;
    run: (
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages
    ) => Promise<RustRunResult>;
  };

  format: {
    gofmt: (source: string) => Promise<FormatIpcResult>;
    rustfmt: (source: string) => Promise<FormatIpcResult>;
    python: (source: string) => Promise<FormatIpcResult>;
  };

  consent: {
    set: (
      value: 'granted' | 'declined' | 'unset'
    ) => Promise<
      { ok: true } | { ok: false; reason: string; message?: string }
    >;
  };

  env: {
    snapshot: () => Promise<Record<string, string>>;
  };

  fs: {
    /**
     * RL-077 capability-based sandbox: pickers mint an opaque `rootId`
     * tied to the directory the user explicitly approved. Subsequent
     * filesystem operations supply `{ rootId, relativePath }` instead
     * of absolute paths so a compromised renderer cannot operate on a
     * path main has not authorized.
     */
    selectDirectory: () => Promise<
      | { canceled: false; rootId: string; rootPath: string }
      | { canceled: true }
    >;
    selectFile: () => Promise<
      | {
          canceled: false;
          rootId: string;
          rootPath: string;
          fileRelativePath: string;
          fileName: string;
          content: string;
        }
      | { canceled: true }
    >;
    saveDialog: (
      defaultName: string,
      defaultDir?: string
    ) => Promise<
      | {
          canceled: false;
          rootId: string;
          rootPath: string;
          fileRelativePath: string;
        }
      | { canceled: true }
    >;
    /**
     * Re-mint a capability for an absolute root path the user
     * previously approved (used by the project-store rehydrate flow
     * and the session-store tab restore so users do not re-pick on
     * every relaunch).
     */
    reopenRoot: (
      absolutePath: string
    ) => Promise<
      | { ok: true; rootId: string; rootPath: string }
      | { ok: false; error: 'blocked' | 'not-found' | 'not-a-directory' }
    >;
    revokeRoot: (rootId: string) => Promise<boolean>;
    readdir: (rootId: string, relativePath: string) => Promise<FsDirEntry[]>;
    listAllFiles: (
      rootId: string,
      relativePath?: string
    ) => Promise<FsIndexedFile[]>;
    searchInFiles: (
      rootId: string,
      relativePath: string,
      query: string,
      options?: FsSearchOptions
    ) => Promise<FsSearchResult[]>;
    stat: (rootId: string, relativePath: string) => Promise<FsStatResult>;
    read: (rootId: string, relativePath: string) => Promise<string>;
    write: (
      rootId: string,
      relativePath: string,
      content: string
    ) => Promise<boolean>;
    delete: (
      rootId: string,
      relativePath: string,
      isDirectory?: boolean,
      language?: string
    ) => Promise<boolean>;
    rename: (
      rootId: string,
      relativeOldPath: string,
      newName: string
    ) => Promise<string>;
    mkdir: (rootId: string, relativePath: string) => Promise<boolean>;
    touch: (rootId: string, relativePath: string) => Promise<boolean>;
    watchStart: (rootId: string, relativePath?: string) => Promise<string>;
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

  license?: {
    getState: () => Promise<LicenseSnapshot>;
    applyToken: (token: string) => Promise<LicenseApplyResult>;
    clear: () => Promise<LicenseClearResult>;
    revalidate: () => Promise<LicenseApplyResult>;
    removeDevice: (deviceIdToRemove: string) => Promise<LicenseRemoveDeviceResult>;
  };

  deepLinks: {
    consumePending: () => Promise<DeepLinkTarget | null>;
    markReady: () => void;
    onLink: (callback: (target: DeepLinkTarget) => void) => () => void;
  };

  desktopSmoke?: {
    enabled: boolean;
    getConfig: () => Promise<DesktopSmokeConfig | null>;
    capture: (name: string) => Promise<string | null>;
    writeJsonArtifact: (name: string, payload: unknown) => Promise<string | null>;
    finish: (success: boolean) => void;
    /**
     * RL-083 Slice 1 — list of URLs the offline-mode webRequest
     * filter cancelled during the smoke run. Empty when offline mode
     * is off or no requests were attempted.
     */
    getOfflineBlocks: () => Promise<readonly string[]>;
  };
}

// Augment Window with Lingua API
interface Window {
  lingua: LinguaAPI;
}

interface MonacoEnvironmentShape {
  getWorker: (workerId: string, label: string) => Worker;
}

declare global {
  var MonacoEnvironment: MonacoEnvironmentShape;
}

declare const __LINGUA_BUILD_DATE__: string | undefined;
declare const __LINGUA_WEBSITE_URL__: string | undefined;
declare const __LINGUA_LICENSE_PUBLIC_KEY_JWK__: string | undefined;
declare const __LINGUA_LICENSE_SERVER_URL__: string | undefined;
declare const __LINGUA_PYODIDE_INDEX_URL__: string | null | undefined;
