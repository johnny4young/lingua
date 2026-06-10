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

// -------------------------------------------------------------- Node types
// RL-019 Slice 2 — desktop Node child-spawn IPC. Detection + run.

interface NodeDetectResult {
  installed: boolean;
  version?: string;
  error?: string;
}

type NodeRunKind =
  | 'success'
  | 'error'
  | 'timeout'
  | 'stopped'
  | 'missing-binary';

interface NodeRunInvokeOptions {
  runId?: string;
  timeoutMs?: number;
  filePath?: string;
  userEnv?: Record<string, string>;
  stdin?: string;
  messages?: NativeRunnerMessages;
}

interface NodeRunResult {
  kind: NodeRunKind;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
  timeoutMs: number;
}

// -------------------------------------------------------------- Ruby types
// RL-042 Slice 6 — desktop Ruby child-spawn IPC. Web build does not
// expose `window.lingua.ruby` (the renderer falls through to the
// `@ruby/wasm-wasi` worker instead).

interface RubyDetectResult {
  installed: boolean;
  /** Full `ruby --version` line. */
  version?: string;
  /** Fold A — parsed semver (e.g. `3.3.6`). Absent when parsing fails. */
  semver?: string;
  /** Fold A — parsed platform tuple (e.g. `arm64-darwin23`). */
  platform?: string;
  error?: string;
}

type RubyRunKind =
  | 'success'
  | 'error'
  | 'timeout'
  | 'stopped'
  | 'missing-binary';

interface RubyRunInvokeOptions {
  runId?: string;
  timeoutMs?: number;
  filePath?: string;
  userEnv?: Record<string, string>;
  stdin?: string;
  messages?: NativeRunnerMessages;
}

interface RubyRunResult {
  kind: RubyRunKind;
  stdout: string;
  stderr: string;
  exitCode: number;
  executionTime: number;
  error?: string;
  timeoutMs: number;
}

// RL-026 Slice 3 + Slice 4 — desktop LSP launcher status surface.
// `RustAnalyzerStatus` and `GoplsStatus` share the same discriminated
// union so the renderer and preload can use a single contract; the
// language-specific aliases exist for readability at the IPC handles.
type LspLauncherStatus =
  | { kind: 'unknown' }
  | { kind: 'starting' }
  | { kind: 'running'; version: string }
  | { kind: 'missing'; reason: string }
  | { kind: 'startup-failed'; error: string }
  | { kind: 'degraded'; error: string }
  | { kind: 'stopped' };

type RustAnalyzerStatus = LspLauncherStatus;
type GoplsStatus = LspLauncherStatus;

// Minimal JSON-RPC notification shape used by the LSP bridge. The
// renderer self-filters by `method`; everything off the contract is
// ignored.
interface LspNotification<P = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: P;
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
  relativePath: RelativePath;
}

interface FsIndexedFile {
  name: string;
  /** Path relative to the capability's project root. */
  relativePath: RelativePath;
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
  relativePath: RelativePath;
  matches: FsSearchMatch[];
}

// RL-024 Slice 2 — replace-in-files preview + apply IPC contract.

interface FsReplaceOptions extends FsSearchOptions {
  /** When true, treat `query` as a JavaScript regex (with `g` flag implicit). */
  regex?: boolean;
  /**
   * RL-024 Slice 2 fold C — per-line cooperative cancel for regex
   * preview. If the regex engine spends longer than this on a single
   * line, that file is aborted with `'regex-timeout'` and the panel
   * surfaces a localized notice. Defaults to 50 ms.
   */
  perLineTimeoutMs?: number;
}

interface FsReplaceMatch extends FsSearchMatch {
  /**
   * RL-024 Slice 2 — the preview text after the regex / literal
   * substitution has been applied to the matched line. Includes the
   * same `matchStart` / `matchEnd` window as `preview`. Renderer-side
   * before/after rendering reads from `preview` (before) +
   * `replacedPreview` (after).
   */
  replacedPreview: string;
  /**
   * RL-024 Slice 2 — the substituted text for THIS match only (no
   * surrounding context). Used by Monaco's `executeEdits` path when
   * applying through an open tab.
   */
  replacement: string;
}

interface FsReplaceResult {
  relativePath: RelativePath;
  matches: FsReplaceMatch[];
  /**
   * RL-024 Slice 2 fold C — set when the file was skipped because the
   * cooperative-cancel deadline fired on a line. Renderer surfaces a
   * localized "regex took too long" notice and skips this file in the
   * apply path.
   */
  regexTimedOut?: boolean;
}

type FsApplyReplaceReason =
  | 'no-matches'
  | 'read-error'
  | 'write-error'
  | 'binary'
  | 'too-large'
  // 'regex-timeout' is reserved for renderer-synthesized state: when
  // the preview path flags a file with `regexTimedOut: true`, the
  // renderer maps it to this reason in the apply summary so the UI
  // can route both signals through the same toast. The IPC handler
  // never returns this value — `fs:applyReplaceInFile` has no per-line
  // deadline of its own; if you reach the apply step the regex has
  // already been validated against the entire file by the preview pass.
  | 'regex-timeout'
  | 'invalid-regex'
  | 'unsupported';

interface FsApplyReplaceResult {
  ok: boolean;
  /** Number of substitutions written to disk on success. */
  replaced: number;
  reason?: FsApplyReplaceReason;
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
  rootId: RootId;
  /** Path of the changed entry, relative to the capability's project root. */
  relativePath: RelativePath;
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
   * Epoch milliseconds captured by the smoke launcher immediately
   * before spawning Electron. Present only when the harness controls
   * the process launch, so packaged/local runs can estimate cold-start
   * time to the renderer smoke hook.
   */
  launchedAtMs?: number;
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

type DesktopSmokeMemorySnapshot =
  | {
      ok: true;
      capturedAt: string;
      process: {
        rssBytes: number;
        heapTotalBytes: number;
        heapUsedBytes: number;
        externalBytes: number;
        arrayBuffersBytes: number;
      };
      chromium: Array<{
        type: string;
        pid: number;
        workingSetSizeBytes: number;
        peakWorkingSetSizeBytes: number;
        privateBytes: number;
      }>;
    }
  | {
      ok: false;
      reason: 'smoke-disabled' | 'unsupported';
    };

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
//
// RL-084 — single source of truth lives in `src/shared/plugins/manifest.ts`
// alongside the validator + the bundled-runtime allowlist. The ambient
// type aliases below keep existing call sites compiling without an
// explicit import; new code is encouraged to import directly from the
// shared module.

type PluginInstallStatus = import('./shared/plugins/manifest').PluginInstallStatus;
type InstalledPluginManifest = import('./shared/plugins/manifest').InstalledPluginManifest;
type InstalledPluginRecord = import('./shared/plugins/manifest').InstalledPluginRecord;

// ---------------------------------------------------------- Watcher types
//
// RL-087 — single source of truth lives in
// `src/shared/fs/watcherDiagnostic.ts`. Ambient aliases keep existing
// call sites compiling without explicit imports.

type WatcherFailureKind = import('./shared/fs/watcherDiagnostic').WatcherFailureKind;
type WatcherDiagnostic = import('./shared/fs/watcherDiagnostic').WatcherDiagnostic;
type PluginDiagnostic = import('./shared/plugins/manifest').PluginDiagnostic;

// --------------------------------------------------------- Branded fs ids
//
// RL-132 / AUDIT-12 — branded `string` ids so a `WatchId` / `RelativePath`
// can never be swapped in where a `RootId` is expected at the IPC seam.
// Single source of truth: `src/shared/fs/brandedIds.ts`. Aliasing them
// here makes the renderer see branded types on `window.lingua.fs` without
// importing from `src/main/*`. Compile-time only — every brand erases to
// `string` over the structured-clone wire.

type RootId = import('./shared/fs/brandedIds').RootId;
type WatchId = import('./shared/fs/brandedIds').WatchId;
type RelativePath = import('./shared/fs/brandedIds').RelativePath;

// ----------------------------------------------------------- Profile types
//
// RL-089 — single source of truth lives in `src/shared/profile/profile.ts`.
// Ambient aliases keep call sites compiling without explicit imports.

type LinguaProfile = import('./shared/profile/profile').LinguaProfile;
type ProfileImportPolicy = import('./shared/profile/profile').ProfileImportPolicy;
type ProfileImportError = import('./shared/profile/profile').ProfileImportError;
type ProfileParseResult = import('./shared/profile/profile').ProfileParseResult;
interface ProfileConfirmReplaceCounts {
  snippets: number;
  envVars: number;
}

// ---------------------------------------------------------- Recovery types
//
// RL-090 — error boundaries + recovery UX. The renderer-side helpers
// live in `src/renderer/utils/safeBoot.ts` and
// `src/renderer/utils/redactedErrorReport.ts`. Ambient aliases keep
// the IPC + web-stub call sites compiling without explicit imports.

type RecoveryResetScope = 'settings' | 'snippets' | 'envVars' | 'session' | 'factory';
type RecoveryRevealFolderResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported' | 'open-failed'; message?: string };

// RL-025 Slice A — JS/TS dependency resolver IPC contract. Closed
// status set; the renderer maps these to its broader
// `DependencyStatus` enum in `src/shared/dependencies/types.ts`.
type DependencyResolveStatus = 'installed' | 'detected' | 'invalid';
interface DependencyResolveResult {
  statuses: Record<string, DependencyResolveStatus>;
  /** Absolute path of the resolved cwd, or null when no cwd was discoverable (e.g. unsaved tab on web stub). */
  cwd: string | null;
  /**
   * RL-025 Slice B — whether the resolved cwd contains a
   * `package.json`. Renderer-side guard for the Install button so
   * we refuse to spawn `npm install` in a directory that would be
   * silently turned into a project by the install.
   */
  hasPackageJson: boolean | null;
}

// RL-025 Slice B — install batch IPC contract. Closed-enum outcome
// and failure reason mirrored in
// `src/shared/dependencies/types.ts` and validated by the closed-enum
// telemetry redactor.
type DependencyInstallResultStatus =
  | 'installed'
  | 'failed'
  | 'cancelled'
  | 'skipped-preflight';
type DependencyInstallOutcome =
  | 'success'
  | 'partial'
  | 'failed'
  | 'cancelled'
  | 'timed-out';
type DependencyInstallFailureReason =
  | 'invalid-specifier'
  | 'no-package-json'
  | 'binary-missing'
  | 'exit-nonzero'
  | 'timeout'
  | 'cancelled'
  | 'unsupported-wheel'
  | 'unknown';
interface DependencyInstallResult {
  statuses: Record<string, DependencyInstallResultStatus>;
  outcome: DependencyInstallOutcome;
  failureReason: DependencyInstallFailureReason | null;
  cwd: string | null;
  exitCode: number;
}
type DependencyInstallLogStream = 'stdout' | 'stderr';
interface DependencyInstallLogEvent {
  runId: string;
  stream: DependencyInstallLogStream;
  chunk: string;
}

// RL-102 Slice 1 — Git read-only layer IPC contracts. Three shapes
// mirrored verbatim in `src/main/git.ts`. The renderer reads them
// off `window.lingua.git.*` (Electron preload) or treats the bridge
// as absent on web (graceful degradation — pill + panel are hidden).
interface GitDetectResult {
  installed: boolean;
  /** `git --version` output, e.g. `git version 2.45.2`. */
  version?: string;
  /** Absolute path of the repo root (a parent of the opened folder). */
  repoRoot?: string;
  /** Current branch name, e.g. `main`. Absent on detached HEAD. */
  branch?: string;
  /** Diagnostic message when `installed === false`. */
  error?: string;
}
type GitFileStatusKind = 'clean' | 'modified' | 'untracked' | 'unknown';
interface GitFileStatus {
  status: GitFileStatusKind;
  insertions?: number;
  deletions?: number;
}
interface GitFileDiff {
  originalContent: string;
  modifiedContent: string;
  truncated: boolean;
}

// RL-102 Slice 2 — head-watch + reveal payload contracts. Mirrored
// verbatim from `src/main/git.ts` so the renderer can consume them
// off `window.lingua.git.onHeadChanged` without an extra import.
interface GitHeadChangePayload {
  repoRoot: string;
  /** `null` means detached HEAD and clears a previously-known branch. */
  branch?: string | null;
  commit?: string;
  /** `false` for the initial summary emit; `true` when the branch
   *  has changed since the last cached summary. Watcher uses this
   *  to gate `git.head_changed` telemetry (no-op fires suppressed). */
  branchChanged: boolean;
}
interface GitHeadWatcherFailurePayload {
  repoRoot: string;
  /** `'give-up'` after the backoff schedule exhausts;
   *  `'resolve-error'` when the initial HEAD path resolve fails. */
  reason: 'give-up' | 'resolve-error';
}

// --------------------------------------------------------------- Main API

type FsBlockedPathFamily =
  | 'system'
  | 'credentials'
  | 'app-data'
  | 'browser-profile'
  | 'lingua-data';

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

  // RL-019 Slice 2 — desktop Node child-spawn IPC. Worker-mode JS
  // does not use this bridge; only `runtimeMode === 'node'` tabs.
  // Optional because the web build's adapter (src/web/adapter.ts)
  // deliberately omits this surface — Node mode is desktop-only.
  // Callers MUST check `window.lingua.node` before invoking.
  node?: {
    detect: (
      userEnv?: Record<string, string>,
      force?: boolean
    ) => Promise<NodeDetectResult>;
    run: (
      source: string,
      options?: NodeRunInvokeOptions
    ) => Promise<NodeRunResult>;
    stop: (runId: string) => Promise<{ stopped: boolean }>;
  };

  // RL-042 Slice 6 — desktop Ruby child-spawn IPC. Optional because
  // the web build's adapter (src/web/adapter.ts) deliberately omits
  // this surface — the renderer falls back to the @ruby/wasm-wasi
  // worker instead. Callers MUST check `window.lingua.ruby` before
  // invoking, same as `window.lingua.node`.
  ruby?: {
    detect: (
      userEnv?: Record<string, string>,
      force?: boolean
    ) => Promise<RubyDetectResult>;
    run: (
      source: string,
      options?: RubyRunInvokeOptions
    ) => Promise<RubyRunResult>;
    stop: (runId: string) => Promise<{ stopped: boolean }>;
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

  // RL-026 Slice 3 (Rust) + Slice 4 (Go) — desktop LSP bridges.
  lsp: {
    rust: {
      start: () => Promise<RustAnalyzerStatus>;
      restart: () => Promise<RustAnalyzerStatus>;
      stop: () => Promise<{ kind: 'stopped' }>;
      status: () => Promise<RustAnalyzerStatus>;
      request: (
        method: string,
        params: unknown
      ) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
      notify: (method: string, params: unknown) => void;
      onNotification: (callback: (notification: LspNotification) => void) => () => void;
      onStatusChanged: (callback: (status: RustAnalyzerStatus) => void) => () => void;
    };
    go: {
      start: () => Promise<GoplsStatus>;
      restart: () => Promise<GoplsStatus>;
      stop: () => Promise<{ kind: 'stopped' }>;
      status: () => Promise<GoplsStatus>;
      request: (
        method: string,
        params: unknown
      ) => Promise<{ ok: true; result: unknown } | { ok: false; error: string }>;
      notify: (method: string, params: unknown) => void;
      onNotification: (callback: (notification: LspNotification) => void) => () => void;
      onStatusChanged: (callback: (status: GoplsStatus) => void) => () => void;
    };
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
      | { canceled: false; rootId: RootId; rootPath: string }
      | { canceled: true; blockedFamily?: FsBlockedPathFamily }
    >;
    selectFile: () => Promise<
      | {
          canceled: false;
          rootId: RootId;
          rootPath: string;
          fileRelativePath: RelativePath;
          fileName: string;
          content: string;
        }
      | { canceled: true; blockedFamily?: FsBlockedPathFamily }
    >;
    saveDialog: (
      defaultName: string,
      defaultDir?: string
    ) => Promise<
      | {
          canceled: false;
          rootId: RootId;
          rootPath: string;
          fileRelativePath: RelativePath;
        }
      | { canceled: true; blockedFamily?: FsBlockedPathFamily }
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
      | { ok: true; rootId: RootId; rootPath: string }
      | {
          ok: false;
          error: 'blocked' | 'not-found' | 'not-a-directory' | 'not-approved';
        }
    >;
    reopenFile: (
      absolutePath: string
    ) => Promise<
      | {
          ok: true;
          rootId: RootId;
          rootPath: string;
          fileRelativePath: RelativePath;
        }
      | {
          ok: false;
          error: 'blocked' | 'not-found' | 'not-a-file' | 'not-approved';
        }
    >;
    /**
     * RL-137 / AUDIT-17 — classify a path against the filesystem denylist so a
     * blocked reopen/pick can be surfaced with an actionable, localized notice.
     * `family` mirrors `BLOCKED_PATH_FAMILIES` in `src/main/ipc/permissions.ts`;
     * `null` means the path is allowed. The web build always returns `null`.
     */
    classifyBlockedPath: (
      absolutePath: string
    ) => Promise<{
      family:
        | FsBlockedPathFamily
        | null;
    }>;
    revokeRoot: (rootId: RootId) => Promise<boolean>;
    readdir: (rootId: RootId, relativePath: RelativePath) => Promise<FsDirEntry[]>;
    listAllFiles: (
      rootId: RootId,
      relativePath?: RelativePath
    ) => Promise<FsIndexedFile[]>;
    searchInFiles: (
      rootId: RootId,
      relativePath: RelativePath,
      query: string,
      options?: FsSearchOptions
    ) => Promise<FsSearchResult[]>;
    /**
     * RL-024 Slice 2 — preview replace-in-files. Walks the project
     * the same way as `searchInFiles`, but each match also carries
     * a per-match `replacement` + `replacedPreview` so the renderer
     * can render before/after diffs without re-deriving regex
     * backrefs.
     */
    replaceInFiles: (
      rootId: RootId,
      relativePath: RelativePath,
      query: string,
      replacement: string,
      options?: FsReplaceOptions
    ) => Promise<FsReplaceResult[]>;
    /**
     * RL-024 Slice 2 — atomically apply the substitution to a
     * single file. Writes to a tmpfile in the same directory then
     * renames over the original (Windows AV retry x3). Returns
     * `{ ok, replaced, reason? }` with a closed-enum reason for
     * the failure path.
     */
    applyReplaceInFile: (
      rootId: RootId,
      relativePath: RelativePath,
      query: string,
      replacement: string,
      options?: FsReplaceOptions
    ) => Promise<FsApplyReplaceResult>;
    stat: (rootId: RootId, relativePath: RelativePath) => Promise<FsStatResult>;
    read: (rootId: RootId, relativePath: RelativePath) => Promise<string>;
    write: (
      rootId: RootId,
      relativePath: RelativePath,
      content: string
    ) => Promise<boolean>;
    delete: (
      rootId: RootId,
      relativePath: RelativePath,
      isDirectory?: boolean,
      language?: string
    ) => Promise<boolean>;
    rename: (
      rootId: RootId,
      relativeOldPath: RelativePath,
      newName: string
    ) => Promise<RelativePath>;
    mkdir: (rootId: RootId, relativePath: RelativePath) => Promise<boolean>;
    touch: (rootId: RootId, relativePath: RelativePath) => Promise<boolean>;
    /**
     * RL-024 Slice 1 fold A — open the OS file manager with the
     * entry selected. Desktop: `shell.showItemInFolder`. Web build:
     * no-op (no underlying absolute path).
     */
    revealInFinder: (rootId: RootId, relativePath: RelativePath) => Promise<boolean>;
    /**
     * RL-024 Slice 3 — pack every visible file under the capability
     * root into a `.zip` bundle (with a `lingua-bundle.json` manifest)
     * and write it to a user-chosen path. Desktop-only; the web stub
     * resolves `{ ok: false, reason: 'write-failed' }` since the web
     * export goes through a Blob download instead. `opts.entryFile` /
     * `opts.languageHint` are stamped into the manifest so a re-import
     * can restore the active tab + language.
     */
    exportBundle: (
      rootId: RootId,
      opts?: { entryFile?: string; languageHint?: string }
    ) => Promise<
      | { ok: true; fileCount: number; byteLength: number }
      | { canceled: true }
      | { ok: false; reason: 'empty' | 'too-many-files' | 'write-failed' }
    >;
    /**
     * RL-024 Slice 3 — extract a `.zip` bundle (raw bytes from the
     * renderer) into a user-chosen empty folder, after authoritative
     * zip-slip / zip-bomb / cap re-validation in main. Returns the new
     * root path so the renderer adopts it via `openProject(rootPath)`.
     * The reject `reason` is a closed enum mirroring
     * `BUNDLE_REJECT_REASONS` plus the two write-time outcomes.
     */
    importBundle: (
      zipBytes: Uint8Array
    ) => Promise<
      | { ok: true; rootPath: string; fileCount: number; entryFile?: string }
      | { canceled: true }
      | {
          ok: false;
          reason:
            | 'empty'
            | 'entry-too-large'
            | 'malformed-zip'
            | 'no-files'
            | 'path-traversal'
            | 'too-large'
            | 'too-many-files'
            | 'zip-bomb'
            | 'non-empty-dir'
            | 'write-failed';
        }
    >;
    /**
     * RL-087 — returns either the `watchId` string on success or a
     * tagged-union `{ ok: false, diagnostic }` shape when fs.watch
     * registration fails (EACCES, EMFILE, ENOSPC, ENOENT). Callers
     * should branch on the response shape. The diagnostic is also
     * pushed via `onWatcherFailed` so passive subscribers update
     * without polling the return value.
     */
    watchStart: (
      rootId: RootId,
      relativePath?: RelativePath
    ) => Promise<WatchId | { ok: false; diagnostic: WatcherDiagnostic }>;
    watchStop: (watchId: WatchId) => Promise<boolean>;
    onChanged: (callback: (event: FsChangedEvent) => void) => () => void;
    /**
     * RL-087 — push subscription for typed watcher failures. Main emits
     * one `WatcherDiagnostic` per failed `fs.watch()` registration.
     */
    onWatcherFailed: (callback: (diagnostic: WatcherDiagnostic) => void) => () => void;
    /**
     * RL-087 — informational push when the watcher reports a sustained
     * burst of null-filename events (Linux inotify overflow, etc.).
     * Renderer surfaces a warning-tone notice; not an error.
     */
    onWatcherDegraded: (callback: (diagnostic: WatcherDiagnostic) => void) => () => void;
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
    getMemorySnapshot: () => Promise<DesktopSmokeMemorySnapshot>;
  };

  /**
   * RL-089 — destructive `replace` policy of the profile-restore flow
   * gates behind a native confirm modal. Returns 0 to confirm, 1 to
   * cancel (matches `app:confirm-close` convention). The web stub
   * resolves to 1 (cancel) so the renderer preserves current data and
   * surfaces an explicit cancellation notice.
   */
  profile: {
    confirmReplace: (
      counts: ProfileConfirmReplaceCounts,
      language?: string
    ) => Promise<number>;
  };

  /**
   * RL-090 — recovery surface (Settings → Account → Recovery).
   * `confirmReset` returns 0 (Reset) or 1 (Cancel). `revealFolder`
   * opens the OS file browser at the userData path so a user with
   * a corrupted persisted state can wipe files manually. Web stubs
   * both to safe no-ops.
   */
  recovery: {
    confirmReset: (
      scope: RecoveryResetScope,
      language?: string
    ) => Promise<number>;
    revealFolder: () => Promise<RecoveryRevealFolderResult>;
  };

  /**
   * RL-025 Slice A + Slice B — JS/TS dependency resolution and
   * installation. Slice C will extend this surface with
   * `installPython` (Pyodide `micropip`) on web.
   */
  dependencies: {
    resolveJs: (
      specifiers: readonly string[],
      filePath?: string
    ) => Promise<DependencyResolveResult>;
    installJs: (
      runId: string,
      specifiers: readonly string[],
      filePath: string
    ) => Promise<DependencyInstallResult>;
    cancelInstallJs: (runId: string) => Promise<{ cancelled: boolean }>;
    onInstallLogJs: (
      handler: (event: DependencyInstallLogEvent) => void
    ) => () => void;
  };

  /**
   * RL-102 Slice 1 — Git read-only layer. Desktop-only; on web the
   * `git` key is absent and the renderer hides the pill + panel.
   *   - `detect` resolves binary + repo root + branch for a folder.
   *   - `status` returns the per-file porcelain status bucket.
   *   - `diff` returns paired strings for Monaco's diff editor.
   * Slice 2+ will add `add`/`commit`/`branch` write surfaces behind
   * an explicit gate.
   */
  git?: {
    detect: (folderPath?: string) => Promise<GitDetectResult>;
    status: (repoRoot: string, filePath: string) => Promise<GitFileStatus>;
    diff: (repoRoot: string, filePath: string) => Promise<GitFileDiff>;
    // RL-102 Slice 2 — Reveal repo root in OS file manager. Returns
    // false when the OS refused the open or the path vanished.
    reveal: (repoRoot: string) => Promise<boolean>;
    // RL-102 Slice 2 — start / stop a `.git/HEAD` watcher for the
    // given repoRoot. Main streams `git:on-head-changed` events to
    // the renderer; the renderer subscribes via `onHeadChanged`.
    watchHead: (repoRoot: string) => Promise<{ ok: boolean }>;
    unwatchHead: (repoRoot: string) => Promise<{ ok: boolean }>;
    onHeadChanged: (
      handler: (payload: GitHeadChangePayload) => void
    ) => () => void;
    onHeadWatcherFailed: (
      handler: (payload: GitHeadWatcherFailurePayload) => void
    ) => () => void;
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
declare const __LINGUA_DUCKDB_MVP_WASM_URL__: string | null | undefined;
declare const __LINGUA_RUBY_WASM_URL__: string | null | undefined;
declare const __LINGUA_PYODIDE_INDEX_URL__: string | null | undefined;
declare const __LINGUA_E2E_HOOKS__: boolean | undefined;
