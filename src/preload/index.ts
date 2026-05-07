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
  },
});
