import { contextBridge, ipcRenderer } from 'electron';

const desktopSmokeEnabled =
  process.env.LINGUA_DESKTOP_SMOKE === '1' ||
  process.argv.includes('--lingua-desktop-smoke');

contextBridge.exposeInMainWorld('lingua', {
  platform: process.platform,

  getSystemLanguages: () =>
    ipcRenderer.invoke('app:get-system-languages') as Promise<string[]>,
  getAppInfo: () => ipcRenderer.invoke('app:get-info') as Promise<AppInfo>,
  openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url) as Promise<boolean>,

  deepLinks: {
    consumePending: () =>
      ipcRenderer.invoke('app:consume-pending-deep-link') as Promise<DeepLinkTarget | null>,
    markReady: () => ipcRenderer.send('app:deep-link-renderer-ready'),
    onLink: (callback: (target: DeepLinkTarget) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(data as DeepLinkTarget);
      ipcRenderer.on('app:deep-link', handler);
      return () => ipcRenderer.removeListener('app:deep-link', handler);
    },
  },

  // Go runner IPC
  go: {
    detect: (userEnv?: Record<string, string>) =>
      ipcRenderer.invoke('go:detect', userEnv),
    // RL-011 Slice D: userEnv flows through to the Go subprocess and is
    // merged over the minimal RL-079 host allowlist in main. The
    // renderer-side env-vars store already validated + sanitized the
    // record before handing it off.
    compile: (
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages
    ) => ipcRenderer.invoke('go:compile', sourceCode, userEnv, messages),
  },

  // Rust runner IPC
  rust: {
    detect: (userEnv?: Record<string, string>) =>
      ipcRenderer.invoke('rust:detect', userEnv),
    // RL-011 Slice D — userEnv flows through to rustc + spawn. The
    // renderer-side envVarsStore already sanitized the record; main
    // only adds the RL-079 host allowlist under it.
    run: (
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages
    ) => ipcRenderer.invoke('rust:run', sourceCode, userEnv, messages),
  },

  // RL-042 Slice 6 — desktop Ruby child-spawn IPC. Distinct from the
  // worker-mode WASM runner (@ruby/wasm-wasi); the desktop subprocess
  // path lets the user code see system gems + native performance.
  // Web build's adapter (src/web/adapter.ts) deliberately omits this
  // surface — the renderer falls back to the WASM worker.
  ruby: {
    detect: (userEnv?: Record<string, string>, force?: boolean) =>
      ipcRenderer.invoke('ruby:detect', userEnv, force) as Promise<RubyDetectResult>,
    run: (
      source: string,
      options?: RubyRunInvokeOptions
    ) => ipcRenderer.invoke('ruby:run', source, options) as Promise<RubyRunResult>,
    stop: (runId: string) =>
      ipcRenderer.invoke('ruby:stop', runId) as Promise<{ stopped: boolean }>,
  },

  // RL-019 Slice 2 — desktop Node child-spawn IPC. Distinct from the
  // worker-mode JS runner (which executes inside a sandboxed
  // WebWorker on the renderer side). The Node mode runs the user's
  // code in a real `node` subprocess on the desktop host so full
  // built-ins (`fs`, `path`, `http`, …) are available.
  node: {
    detect: (userEnv?: Record<string, string>, force?: boolean) =>
      ipcRenderer.invoke('node:detect', userEnv, force) as Promise<{
        installed: boolean;
        version?: string;
        error?: string;
      }>,
    run: (
      source: string,
      options?: {
        runId?: string;
        timeoutMs?: number;
        filePath?: string;
        userEnv?: Record<string, string>;
        stdin?: string;
        messages?: NativeRunnerMessages;
      }
    ) =>
      ipcRenderer.invoke('node:run', source, options) as Promise<{
        kind: 'success' | 'error' | 'timeout' | 'stopped' | 'missing-binary';
        stdout: string;
        stderr: string;
        exitCode: number;
        executionTime: number;
        error?: string;
        timeoutMs: number;
      }>,
    stop: (runId: string) =>
      ipcRenderer.invoke('node:stop', runId) as Promise<{ stopped: boolean }>,
  },

  // Formatter IPC — gofmt / rustfmt / python pipe source via stdin
  format: {
    gofmt: (source: string) =>
      ipcRenderer.invoke('format:gofmt', source) as Promise<FormatIpcResult>,
    rustfmt: (source: string) =>
      ipcRenderer.invoke('format:rustfmt', source) as Promise<FormatIpcResult>,
    python: (source: string) =>
      ipcRenderer.invoke('format:python', source) as Promise<FormatIpcResult>,
  },

  // Consent mirror — renderer pushes the telemetry/crash opt-in value so
  // main can read it before creating the window. RL-067 early-crash slice.
  consent: {
    set: (value: 'granted' | 'declined' | 'unset') =>
      ipcRenderer.invoke('consent:set', value) as Promise<
        { ok: true } | { ok: false; reason: string; message?: string }
      >,
  },

  // Env-snapshot bridge (RL-011 Slice B). Intentionally returns an empty
  // record today: host `process.env` stays in main until runner integration
  // lands so secrets never cross into the renderer. The API shape still
  // exists now so Slice C/D can wire against a stable contract later.
  env: {
    snapshot: () =>
      ipcRenderer.invoke('env:snapshot') as Promise<Record<string, string>>,
  },

  // RL-026 Slice 3 + Slice 4 — desktop LSP bridges. The renderer
  // never talks to rust-analyzer or gopls directly; high-level
  // commands go through these handles and notifications stream back
  // via `onNotification` / `onStatusChanged`. Both launchers are
  // owned by main and disposed on `before-quit`.
  lsp: {
    rust: {
      start: () => ipcRenderer.invoke('lsp:rust:start') as Promise<RustAnalyzerStatus>,
      restart: () =>
        ipcRenderer.invoke('lsp:rust:restart') as Promise<RustAnalyzerStatus>,
      stop: () =>
        ipcRenderer.invoke('lsp:rust:stop') as Promise<{ kind: 'stopped' }>,
      status: () =>
        ipcRenderer.invoke('lsp:rust:status') as Promise<RustAnalyzerStatus>,
      request: (method: string, params: unknown) =>
        ipcRenderer.invoke('lsp:rust:request', method, params) as Promise<
          { ok: true; result: unknown } | { ok: false; error: string }
        >,
      notify: (method: string, params: unknown) => {
        ipcRenderer.send('lsp:rust:notify', method, params);
      },
      onNotification: (callback: (notification: LspNotification) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
          callback(data as LspNotification);
        ipcRenderer.on('lsp:rust:notification', handler);
        return () => ipcRenderer.removeListener('lsp:rust:notification', handler);
      },
      onStatusChanged: (callback: (status: RustAnalyzerStatus) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
          callback(data as RustAnalyzerStatus);
        ipcRenderer.on('lsp:rust:status', handler);
        return () => ipcRenderer.removeListener('lsp:rust:status', handler);
      },
    },
    go: {
      start: () => ipcRenderer.invoke('lsp:go:start') as Promise<GoplsStatus>,
      restart: () => ipcRenderer.invoke('lsp:go:restart') as Promise<GoplsStatus>,
      stop: () => ipcRenderer.invoke('lsp:go:stop') as Promise<{ kind: 'stopped' }>,
      status: () => ipcRenderer.invoke('lsp:go:status') as Promise<GoplsStatus>,
      request: (method: string, params: unknown) =>
        ipcRenderer.invoke('lsp:go:request', method, params) as Promise<
          { ok: true; result: unknown } | { ok: false; error: string }
        >,
      notify: (method: string, params: unknown) => {
        ipcRenderer.send('lsp:go:notify', method, params);
      },
      onNotification: (callback: (notification: LspNotification) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
          callback(data as LspNotification);
        ipcRenderer.on('lsp:go:notification', handler);
        return () => ipcRenderer.removeListener('lsp:go:notification', handler);
      },
      onStatusChanged: (callback: (status: GoplsStatus) => void) => {
        const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
          callback(data as GoplsStatus);
        ipcRenderer.on('lsp:go:status', handler);
        return () => ipcRenderer.removeListener('lsp:go:status', handler);
      },
    },
  },

  // App lifecycle IPC
  confirmClose: (dirtyFileNames: string[], language?: string) =>
    ipcRenderer.invoke('app:confirm-close', dirtyFileNames, language) as Promise<number>,
  confirmCloseTab: (fileName: string, language?: string) =>
    ipcRenderer.invoke('app:confirm-close-tab', fileName, language) as Promise<number>,
  onBeforeClose: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('app:before-close', handler);
    return () => ipcRenderer.removeListener('app:before-close', handler);
  },
  forceClose: () => ipcRenderer.send('app:force-close'),

  // File system IPC — RL-077 capability sandbox
  fs: {
    selectDirectory: () => ipcRenderer.invoke('fs:select-directory'),
    selectFile: () => ipcRenderer.invoke('fs:select-file'),
    saveDialog: (defaultName: string, defaultDir?: string) =>
      ipcRenderer.invoke('fs:save-dialog', defaultName, defaultDir),
    reopenRoot: (absolutePath: string) =>
      ipcRenderer.invoke('fs:reopen-root', absolutePath),
    reopenFile: (absolutePath: string) =>
      ipcRenderer.invoke('fs:reopen-file', absolutePath),
    revokeRoot: (rootId: string) =>
      ipcRenderer.invoke('fs:revoke-root', rootId),
    readdir: (rootId: string, relativePath: string) =>
      ipcRenderer.invoke('fs:readdir', rootId, relativePath),
    listAllFiles: (rootId: string, relativePath?: string) =>
      ipcRenderer.invoke('fs:listAllFiles', rootId, relativePath),
    searchInFiles: (
      rootId: string,
      relativePath: string,
      query: string,
      options?: FsSearchOptions
    ) =>
      ipcRenderer.invoke(
        'fs:searchInFiles',
        rootId,
        relativePath,
        query,
        options
      ) as Promise<FsSearchResult[]>,
    // RL-024 Slice 2 — preview + apply replace-in-files.
    replaceInFiles: (
      rootId: string,
      relativePath: string,
      query: string,
      replacement: string,
      options?: FsReplaceOptions
    ) =>
      ipcRenderer.invoke(
        'fs:replaceInFiles',
        rootId,
        relativePath,
        query,
        replacement,
        options
      ) as Promise<FsReplaceResult[]>,
    applyReplaceInFile: (
      rootId: string,
      relativePath: string,
      query: string,
      replacement: string,
      options?: FsReplaceOptions
    ) =>
      ipcRenderer.invoke(
        'fs:applyReplaceInFile',
        rootId,
        relativePath,
        query,
        replacement,
        options
      ) as Promise<FsApplyReplaceResult>,
    stat: (rootId: string, relativePath: string) =>
      ipcRenderer.invoke('fs:stat', rootId, relativePath),
    read: (rootId: string, relativePath: string) =>
      ipcRenderer.invoke('fs:read', rootId, relativePath),
    write: (rootId: string, relativePath: string, content: string) =>
      ipcRenderer.invoke('fs:write', rootId, relativePath, content),
    delete: (
      rootId: string,
      relativePath: string,
      isDirectory?: boolean,
      language?: string
    ) =>
      ipcRenderer.invoke(
        'fs:delete',
        rootId,
        relativePath,
        isDirectory,
        language
      ),
    rename: (rootId: string, relativeOldPath: string, newName: string) =>
      ipcRenderer.invoke('fs:rename', rootId, relativeOldPath, newName),
    mkdir: (rootId: string, relativePath: string) =>
      ipcRenderer.invoke('fs:mkdir', rootId, relativePath),
    touch: (rootId: string, relativePath: string) =>
      ipcRenderer.invoke('fs:touch', rootId, relativePath),
    // RL-024 Slice 1 fold A — surface the entry in the OS file
    // manager (Finder / Explorer / Nautilus). Web build no-ops via
    // the FSA adapter (no underlying absolute path).
    revealInFinder: (rootId: string, relativePath: string) =>
      ipcRenderer.invoke('fs:reveal-in-finder', rootId, relativePath),
    watchStart: (rootId: string, relativePath?: string) =>
      ipcRenderer.invoke('fs:watch-start', rootId, relativePath),
    watchStop: (watchId: string) =>
      ipcRenderer.invoke('fs:watch-stop', watchId),
    onChanged: (
      callback: (event: {
        rootId: string;
        relativePath: string;
        eventType: string;
        filename: string | null;
      }) => void
    ) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(
          data as {
            rootId: string;
            relativePath: string;
            eventType: string;
            filename: string | null;
          }
        );
      ipcRenderer.on('fs:changed', handler);
      return () => ipcRenderer.removeListener('fs:changed', handler);
    },
    // RL-087 — typed watcher-failure subscription. Main emits this
    // when fs.watch() throws on registration (EACCES, EMFILE, etc.).
    onWatcherFailed: (callback: (diagnostic: WatcherDiagnostic) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(data as WatcherDiagnostic);
      ipcRenderer.on('fs:watcher-failed', handler);
      return () => ipcRenderer.removeListener('fs:watcher-failed', handler);
    },
    // RL-087 — informational degraded signal when the watcher reports
    // a sustained burst of null-filename events (Linux inotify
    // overflow). Renderer surfaces a warning-tone notice.
    onWatcherDegraded: (callback: (diagnostic: WatcherDiagnostic) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(data as WatcherDiagnostic);
      ipcRenderer.on('fs:watcher-degraded', handler);
      return () => ipcRenderer.removeListener('fs:watcher-degraded', handler);
    },
  },

  updates: {
    getState: () => ipcRenderer.invoke('updates:get-state'),
    check: () => ipcRenderer.invoke('updates:check'),
    restartToApply: () => ipcRenderer.invoke('updates:restart'),
    onStateChanged: (callback: (state: UpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: unknown) =>
        callback(data as UpdateState);
      ipcRenderer.on('updates:state-changed', handler);
      return () => ipcRenderer.removeListener('updates:state-changed', handler);
    },
  },

  plugins: {
    getInstallDirectory: () => ipcRenderer.invoke('plugins:get-install-directory'),
    list: () => ipcRenderer.invoke('plugins:list'),
  },

  // License bridge (RL-059 Slice 0). Main owns persistence + verification;
  // the renderer mirrors the snapshot into its zustand store and forwards
  // every mutation through here so localStorage stays out of the desktop
  // licensing path.
  license: {
    getState: () => ipcRenderer.invoke('license:get-state') as Promise<LicenseSnapshot>,
    applyToken: (token: string) =>
      ipcRenderer.invoke('license:apply-token', token) as Promise<LicenseApplyResult>,
    clear: () =>
      ipcRenderer.invoke('license:clear') as Promise<LicenseClearResult>,
    revalidate: () =>
      ipcRenderer.invoke('license:revalidate') as Promise<LicenseApplyResult>,
    // RL-061 Slice 3.5 — desktop-side parallel of the web wrapper's
    // `removeDevice`. Renderer's licenseStore desktop branch
    // delegates here when the user clicks Remove on a non-current
    // row in Settings → License or inside the exhausted-devices
    // modal. Returns a flat `snapshot` on success so callers do
    // not need a separate `getState()` round-trip.
    removeDevice: (deviceIdToRemove: string) =>
      ipcRenderer.invoke(
        'license:remove-device',
        deviceIdToRemove
      ) as Promise<LicenseRemoveDeviceResult>,
  },

  desktopSmoke: {
    enabled: desktopSmokeEnabled,
    getConfig: () => ipcRenderer.invoke('desktop-smoke:get-config') as Promise<DesktopSmokeConfig | null>,
    capture: (name: string) => ipcRenderer.invoke('desktop-smoke:capture', name) as Promise<string | null>,
    writeJsonArtifact: (name: string, payload: unknown) =>
      ipcRenderer.invoke('desktop-smoke:write-json-artifact', name, payload) as Promise<string | null>,
    finish: (success: boolean) => ipcRenderer.send('desktop-smoke:finish', success),
    getOfflineBlocks: () =>
      ipcRenderer.invoke('desktop-smoke:get-offline-blocks') as Promise<readonly string[]>,
    getMemorySnapshot: () =>
      ipcRenderer.invoke('desktop-smoke:get-memory-snapshot') as Promise<DesktopSmokeMemorySnapshot>,
  },

  // RL-089 — destructive `replace` policy of the profile-restore
  // flow gates behind a native confirm modal. `merge` and `preserve`
  // skip this round-trip and apply directly.
  profile: {
    confirmReplace: (counts: ProfileConfirmReplaceCounts, language?: string) =>
      ipcRenderer.invoke('profile:confirm-replace', counts, language) as Promise<number>,
  },

  // RL-090 — recovery surface in Settings → Account.
  recovery: {
    confirmReset: (scope: RecoveryResetScope, language?: string) =>
      ipcRenderer.invoke('recovery:confirm-reset', scope, language) as Promise<number>,
    revealFolder: () =>
      ipcRenderer.invoke('recovery:reveal-folder') as Promise<RecoveryRevealFolderResult>,
  },

  // RL-025 Slice A + Slice B — JS / TS dependency resolution and
  // installation. Slice A's `resolveJs` is read-only; Slice B adds
  // `installJs` (spawn via main with `shell: false`),
  // `cancelInstallJs` (SIGTERM → SIGKILL keyed by runId), and
  // `onInstallLogJs` (streams subprocess stdout / stderr lines back
  // for the panel's log surface).
  dependencies: {
    resolveJs: (specifiers: readonly string[], filePath?: string) =>
      ipcRenderer.invoke(
        'dependencies:js:resolve',
        specifiers,
        filePath
      ) as Promise<DependencyResolveResult>,
    installJs: (
      runId: string,
      specifiers: readonly string[],
      filePath: string
    ) =>
      ipcRenderer.invoke(
        'dependencies:js:install',
        runId,
        specifiers,
        filePath
      ) as Promise<DependencyInstallResult>,
    cancelInstallJs: (runId: string) =>
      ipcRenderer.invoke('dependencies:js:install:cancel', runId) as Promise<{
        cancelled: boolean;
      }>,
    onInstallLogJs: (handler: (event: DependencyInstallLogEvent) => void) => {
      const listener = (_: unknown, payload: DependencyInstallLogEvent) =>
        handler(payload);
      ipcRenderer.on('dependencies:js:install:log', listener);
      return () => {
        ipcRenderer.removeListener('dependencies:js:install:log', listener);
      };
    },
  },

  // RL-102 Slice 1 — Git read-only layer. Three channels:
  //   - detect: probe binary + repo root + branch for a folder
  //   - status: per-file porcelain status bucket
  //   - diff: paired strings for Monaco's diff editor
  // Web build uses a no-op stub registered below (preload/web.ts);
  // this implementation runs in Electron preload only.
  git: {
    detect: (folderPath?: string) =>
      ipcRenderer.invoke('git:detect', folderPath) as Promise<GitDetectResult>,
    status: (repoRoot: string, filePath: string) =>
      ipcRenderer.invoke(
        'git:status',
        repoRoot,
        filePath
      ) as Promise<GitFileStatus>,
    diff: (repoRoot: string, filePath: string) =>
      ipcRenderer.invoke(
        'git:diff',
        repoRoot,
        filePath
      ) as Promise<GitFileDiff>,
  },
});
