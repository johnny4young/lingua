import { contextBridge } from 'electron';
import { typedInvoke, typedOn, typedSend } from './ipcTyped';

const desktopSmokeEnabled =
  process.env.LINGUA_DESKTOP_SMOKE === '1' ||
  process.argv.includes('--lingua-desktop-smoke');

contextBridge.exposeInMainWorld('lingua', {
  platform: process.platform,

  getSystemLanguages: () => typedInvoke('app:get-system-languages'),
  getAppInfo: () => typedInvoke('app:get-info'),
  openExternal: (url: string) => typedInvoke('app:open-external', url),

  deepLinks: {
    consumePending: () => typedInvoke('app:consume-pending-deep-link'),
    markReady: () => typedSend('app:deep-link-renderer-ready'),
    onLink: (callback: (target: DeepLinkTarget) => void) =>
      typedOn('app:deep-link', callback),
  },

  // Go runner IPC
  go: {
    detect: (userEnv?: Record<string, string>) =>
      typedInvoke('go:detect', userEnv),
    // RL-011 Slice D: userEnv flows through to the Go subprocess and is
    // merged over the minimal RL-079 host allowlist in main. The
    // renderer-side env-vars store already validated + sanitized the
    // record before handing it off.
    compile: (
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages
    ) => typedInvoke('go:compile', sourceCode, userEnv, messages),
  },

  // Rust runner IPC
  rust: {
    detect: (userEnv?: Record<string, string>) =>
      typedInvoke('rust:detect', userEnv),
    // RL-011 Slice D — userEnv flows through to rustc + spawn. The
    // renderer-side envVarsStore already sanitized the record; main
    // only adds the RL-079 host allowlist under it.
    run: (
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages
    ) => typedInvoke('rust:run', sourceCode, userEnv, messages),
  },

  // RL-042 Slice 6 — desktop Ruby child-spawn IPC. Distinct from the
  // worker-mode WASM runner (@ruby/wasm-wasi); the desktop subprocess
  // path lets the user code see system gems + native performance.
  // Web build's adapter (src/web/adapter.ts) deliberately omits this
  // surface — the renderer falls back to the WASM worker.
  ruby: {
    detect: (userEnv?: Record<string, string>, force?: boolean) =>
      typedInvoke('ruby:detect', userEnv, force),
    run: (source: string, options?: RubyRunInvokeOptions) =>
      typedInvoke('ruby:run', source, options),
    stop: (runId: string) => typedInvoke('ruby:stop', runId),
    // F-7 — interactive stdin: stream input to a live run + close it.
    writeStdin: (runId: string, data: string) =>
      typedInvoke('ruby:stdin-write', runId, data),
    closeStdin: (runId: string) => typedInvoke('ruby:stdin-close', runId),
    // F-7 — live output stream (consumers filter by runId).
    onOutput: (handler: (event: RuntimeOutputChunk) => void) =>
      typedOn('runtime:output-chunk', handler),
  },

  // RL-019 Slice 2 — desktop Node child-spawn IPC. Distinct from the
  // worker-mode JS runner (which executes inside a sandboxed
  // WebWorker on the renderer side). The Node mode runs the user's
  // code in a real `node` subprocess on the desktop host so full
  // built-ins (`fs`, `path`, `http`, …) are available.
  node: {
    detect: (userEnv?: Record<string, string>, force?: boolean) =>
      typedInvoke('node:detect', userEnv, force),
    run: (source: string, options?: NodeRunInvokeOptions) =>
      typedInvoke('node:run', source, options),
    stop: (runId: string) => typedInvoke('node:stop', runId),
    // F-7 — interactive stdin: stream input to a live run + close it.
    writeStdin: (runId: string, data: string) =>
      typedInvoke('node:stdin-write', runId, data),
    closeStdin: (runId: string) => typedInvoke('node:stdin-close', runId),
    // F-7 — live output stream (consumers filter by runId).
    onOutput: (handler: (event: RuntimeOutputChunk) => void) =>
      typedOn('runtime:output-chunk', handler),
  },

  // F-4 — desktop Deno child-spawn IPC. Runs TS/JS directly; sandboxed
  // to the temp dir via --allow-read. Web adapter omits this surface.
  deno: {
    detect: (userEnv?: Record<string, string>, force?: boolean) =>
      typedInvoke('deno:detect', userEnv, force),
    run: (source: string, options?: AltJsRunInvokeOptions) =>
      typedInvoke('deno:run', source, options),
    stop: (runId: string) => typedInvoke('deno:stop', runId),
  },

  // F-4 — desktop Bun child-spawn IPC. Same shape as deno.
  bun: {
    detect: (userEnv?: Record<string, string>, force?: boolean) =>
      typedInvoke('bun:detect', userEnv, force),
    run: (source: string, options?: AltJsRunInvokeOptions) =>
      typedInvoke('bun:run', source, options),
    stop: (runId: string) => typedInvoke('bun:stop', runId),
  },

  // Formatter IPC — gofmt / rustfmt / python pipe source via stdin
  format: {
    gofmt: (source: string) => typedInvoke('format:gofmt', source),
    rustfmt: (source: string) => typedInvoke('format:rustfmt', source),
    python: (source: string) => typedInvoke('format:python', source),
  },

  // Consent mirror — renderer pushes the telemetry/crash opt-in value so
  // main can read it before creating the window. RL-067 early-crash slice.
  consent: {
    set: (value: 'granted' | 'declined' | 'unset') =>
      typedInvoke('consent:set', value),
  },

  // Env-snapshot bridge (RL-011 Slice B). Intentionally returns an empty
  // record today: host `process.env` stays in main until runner integration
  // lands so secrets never cross into the renderer. The API shape still
  // exists now so Slice C/D can wire against a stable contract later.
  env: {
    snapshot: () => typedInvoke('env:snapshot'),
  },

  // RL-026 Slice 3 + Slice 4 — desktop LSP bridges. The renderer
  // never talks to rust-analyzer or gopls directly; high-level
  // commands go through these handles and notifications stream back
  // via `onNotification` / `onStatusChanged`. Both launchers are
  // owned by main and disposed on `before-quit`.
  lsp: {
    rust: {
      start: () => typedInvoke('lsp:rust:start'),
      restart: () => typedInvoke('lsp:rust:restart'),
      stop: () => typedInvoke('lsp:rust:stop'),
      status: () => typedInvoke('lsp:rust:status'),
      request: (method: string, params: unknown) =>
        typedInvoke('lsp:rust:request', method, params),
      notify: (method: string, params: unknown) => {
        typedSend('lsp:rust:notify', method, params);
      },
      onNotification: (callback: (notification: LspNotification) => void) =>
        typedOn('lsp:rust:notification', callback),
      onStatusChanged: (callback: (status: RustAnalyzerStatus) => void) =>
        typedOn('lsp:rust:status', callback),
    },
    go: {
      start: () => typedInvoke('lsp:go:start'),
      restart: () => typedInvoke('lsp:go:restart'),
      stop: () => typedInvoke('lsp:go:stop'),
      status: () => typedInvoke('lsp:go:status'),
      request: (method: string, params: unknown) =>
        typedInvoke('lsp:go:request', method, params),
      notify: (method: string, params: unknown) => {
        typedSend('lsp:go:notify', method, params);
      },
      onNotification: (callback: (notification: LspNotification) => void) =>
        typedOn('lsp:go:notification', callback),
      onStatusChanged: (callback: (status: GoplsStatus) => void) =>
        typedOn('lsp:go:status', callback),
    },
  },

  // App lifecycle IPC
  confirmClose: (dirtyFileNames: string[], language?: string) =>
    typedInvoke('app:confirm-close', dirtyFileNames, language),
  confirmCloseTab: (fileName: string, language?: string) =>
    typedInvoke('app:confirm-close-tab', fileName, language),
  onBeforeClose: (callback: () => void) =>
    typedOn('app:before-close', () => callback()),
  forceClose: () => typedSend('app:force-close'),

  // File system IPC — RL-077 capability sandbox. Preload is a narrow typed
  // pass-through; main owns approval checks, capability resolution, and
  // containment validation for every rootId + relativePath pair.
  fs: {
    selectDirectory: () => typedInvoke('fs:select-directory'),
    selectFile: () => typedInvoke('fs:select-file'),
    saveDialog: (defaultName: string, defaultDir?: string) =>
      typedInvoke('fs:save-dialog', defaultName, defaultDir),
    reopenRoot: (absolutePath: string) =>
      typedInvoke('fs:reopen-root', absolutePath),
    reopenFile: (absolutePath: string) =>
      typedInvoke('fs:reopen-file', absolutePath),
    classifyBlockedPath: (absolutePath: string) =>
      typedInvoke('fs:classify-blocked-path', absolutePath),
    revokeRoot: (rootId: string) => typedInvoke('fs:revoke-root', rootId),
    readdir: (rootId: string, relativePath: string) =>
      typedInvoke('fs:readdir', rootId, relativePath),
    listAllFiles: (rootId: string, relativePath?: string) =>
      typedInvoke('fs:listAllFiles', rootId, relativePath),
    searchInFiles: (
      rootId: string,
      relativePath: string,
      query: string,
      options?: FsSearchOptions
    ) => typedInvoke('fs:searchInFiles', rootId, relativePath, query, options),
    // RL-024 Slice 2 — preview + apply replace-in-files.
    replaceInFiles: (
      rootId: string,
      relativePath: string,
      query: string,
      replacement: string,
      options?: FsReplaceOptions
    ) =>
      typedInvoke(
        'fs:replaceInFiles',
        rootId,
        relativePath,
        query,
        replacement,
        options
      ),
    applyReplaceInFile: (
      rootId: string,
      relativePath: string,
      query: string,
      replacement: string,
      options?: FsReplaceOptions
    ) =>
      typedInvoke(
        'fs:applyReplaceInFile',
        rootId,
        relativePath,
        query,
        replacement,
        options
      ),
    stat: (rootId: string, relativePath: string) =>
      typedInvoke('fs:stat', rootId, relativePath),
    read: (rootId: string, relativePath: string) =>
      typedInvoke('fs:read', rootId, relativePath),
    write: (rootId: string, relativePath: string, content: string) =>
      typedInvoke('fs:write', rootId, relativePath, content),
    delete: (
      rootId: string,
      relativePath: string,
      isDirectory?: boolean,
      language?: string
    ) => typedInvoke('fs:delete', rootId, relativePath, isDirectory, language),
    rename: (rootId: string, relativeOldPath: string, newName: string) =>
      typedInvoke('fs:rename', rootId, relativeOldPath, newName),
    mkdir: (rootId: string, relativePath: string) =>
      typedInvoke('fs:mkdir', rootId, relativePath),
    touch: (rootId: string, relativePath: string) =>
      typedInvoke('fs:touch', rootId, relativePath),
    // RL-024 Slice 1 fold A — surface the entry in the OS file
    // manager (Finder / Explorer / Nautilus). Web build no-ops via
    // the FSA adapter (no underlying absolute path).
    revealInFinder: (rootId: string, relativePath: string) =>
      typedInvoke('fs:reveal-in-finder', rootId, relativePath),
    // RL-024 Slice 3 — project zip bundles. Export packs the root into
    // a `.zip` via a save dialog; import extracts renderer-supplied
    // bytes into a chosen folder after authoritative re-validation.
    exportBundle: (
      rootId: string,
      opts?: { entryFile?: string; languageHint?: string }
    ) => typedInvoke('fs:exportBundle', rootId, opts),
    importBundle: (zipBytes: Uint8Array) =>
      typedInvoke('fs:importBundle', zipBytes),
    watchStart: (rootId: string, relativePath?: string) =>
      typedInvoke('fs:watch-start', rootId, relativePath),
    watchStop: (watchId: string) => typedInvoke('fs:watch-stop', watchId),
    onChanged: (
      callback: (event: {
        rootId: string;
        relativePath: string;
        eventType: string;
        filename: string | null;
      }) => void
    ) => typedOn('fs:changed', callback),
    // RL-087 — typed watcher-failure subscription. Main emits this
    // when fs.watch() throws on registration (EACCES, EMFILE, etc.).
    onWatcherFailed: (callback: (diagnostic: WatcherDiagnostic) => void) =>
      typedOn('fs:watcher-failed', callback),
    // RL-087 — informational degraded signal when the watcher reports
    // a sustained burst of null-filename events (Linux inotify
    // overflow). Renderer surfaces a warning-tone notice.
    onWatcherDegraded: (callback: (diagnostic: WatcherDiagnostic) => void) =>
      typedOn('fs:watcher-degraded', callback),
  },

  updates: {
    getState: () => typedInvoke('updates:get-state'),
    check: () => typedInvoke('updates:check'),
    restartToApply: () => typedInvoke('updates:restart'),
    onStateChanged: (callback: (state: UpdateState) => void) =>
      typedOn('updates:state-changed', callback),
  },

  plugins: {
    getInstallDirectory: () => typedInvoke('plugins:get-install-directory'),
    list: () => typedInvoke('plugins:list'),
  },

  // License bridge (RL-059 Slice 0). Main owns persistence + verification;
  // the renderer mirrors the snapshot into its zustand store and forwards
  // every mutation through here so localStorage stays out of the desktop
  // licensing path.
  license: {
    getState: () => typedInvoke('license:get-state'),
    applyToken: (token: string) => typedInvoke('license:apply-token', token),
    clear: () => typedInvoke('license:clear'),
    revalidate: () => typedInvoke('license:revalidate'),
    // RL-061 Slice 3.5 — desktop-side parallel of the web wrapper's
    // `removeDevice`. Renderer's licenseStore desktop branch
    // delegates here when the user clicks Remove on a non-current
    // row in Settings → License or inside the exhausted-devices
    // modal. Returns the shared Result data envelope with a snapshot
    // so callers do not need a separate getState round-trip.
    removeDevice: (deviceIdToRemove: string) =>
      typedInvoke('license:remove-device', deviceIdToRemove),
  },

  desktopSmoke: {
    enabled: desktopSmokeEnabled,
    getConfig: () => typedInvoke('desktop-smoke:get-config'),
    capture: (name: string) => typedInvoke('desktop-smoke:capture', name),
    writeJsonArtifact: (name: string, payload: unknown) =>
      typedInvoke('desktop-smoke:write-json-artifact', name, payload),
    finish: (success: boolean) => typedSend('desktop-smoke:finish', success),
    getOfflineBlocks: () => typedInvoke('desktop-smoke:get-offline-blocks'),
    getMemorySnapshot: () => typedInvoke('desktop-smoke:get-memory-snapshot'),
  },

  // RL-089 — destructive `replace` policy of the profile-restore
  // flow gates behind a native confirm modal. `merge` and `preserve`
  // skip this round-trip and apply directly.
  profile: {
    confirmReplace: (counts: ProfileConfirmReplaceCounts, language?: string) =>
      typedInvoke('profile:confirm-replace', counts, language),
  },

  // RL-090 — recovery surface in Settings → Account.
  recovery: {
    confirmReset: (scope: RecoveryResetScope, language?: string) =>
      typedInvoke('recovery:confirm-reset', scope, language),
    revealFolder: () => typedInvoke('recovery:reveal-folder'),
  },

  // RL-025 Slice A + Slice B — JS / TS dependency resolution and
  // installation. Slice A's `resolveJs` is read-only; Slice B adds
  // `installJs` (spawn via main with `shell: false`),
  // `cancelInstallJs` (SIGTERM → SIGKILL keyed by runId), and
  // `onInstallLogJs` (streams subprocess stdout / stderr lines back
  // for the panel's log surface).
  dependencies: {
    resolveJs: (specifiers: readonly string[], filePath?: string) =>
      typedInvoke('dependencies:js:resolve', specifiers, filePath),
    installJs: (
      runId: string,
      specifiers: readonly string[],
      filePath: string
    ) => typedInvoke('dependencies:js:install', runId, specifiers, filePath),
    cancelInstallJs: (runId: string) =>
      typedInvoke('dependencies:js:install:cancel', runId),
    onInstallLogJs: (handler: (event: DependencyInstallLogEvent) => void) =>
      typedOn('dependencies:js:install:log', handler),
    // F-1 — Go / Rust / Ruby install (go get / cargo add / bundle add).
    installNative: (
      language: NativePackageLanguage,
      specifiers: readonly string[],
      filePath: string
    ) => typedInvoke('dependencies:native:install', language, specifiers, filePath),
  },

  // RL-102 Slice 1 — Git read-only layer. Three channels:
  //   - detect: probe binary + repo root + branch for a folder
  //   - status: per-file porcelain status bucket
  //   - diff: paired strings for Monaco's diff editor
  // Web build uses a no-op stub registered below (preload/web.ts);
  // this implementation runs in Electron preload only.
  git: {
    detect: (folderPath?: string) => typedInvoke('git:detect', folderPath),
    status: (repoRoot: string, filePath: string) =>
      typedInvoke('git:status', repoRoot, filePath),
    diff: (repoRoot: string, filePath: string) =>
      typedInvoke('git:diff', repoRoot, filePath),
    // RL-102 Slice 2 — Reveal repo working tree in the OS file
    // manager. Returns false when the path disappeared between the
    // context-menu open and the click, or when the OS rejected the
    // open. Renderer surfaces a localized notice on false.
    reveal: (repoRoot: string) => typedInvoke('git:reveal', repoRoot),
    // RL-102 Slice 2 — start a `.git/HEAD` watcher for `repoRoot`.
    // Main streams `git:on-head-changed` events to the renderer; the
    // renderer subscribes via `onHeadChanged`. Calling twice for the
    // same repoRoot is a no-op.
    watchHead: (repoRoot: string) => typedInvoke('git:watch-head', repoRoot),
    unwatchHead: (repoRoot: string) =>
      typedInvoke('git:unwatch-head', repoRoot),
    onHeadChanged: (handler: (payload: GitHeadChangePayload) => void) =>
      typedOn('git:on-head-changed', handler),
    onHeadWatcherFailed: (
      handler: (payload: GitHeadWatcherFailurePayload) => void
    ) => typedOn('git:on-head-watcher-failed', handler),
  },
});
