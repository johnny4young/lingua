/**
 * RL — single typed source of truth for the Electron IPC boundary.
 *
 * Before this file the preload↔main seam was stringly-typed: preload
 * called `ipcRenderer.invoke('fs:read', …) as Promise<string>` and main
 * registered `ipcMain.handle('fs:read', …)` independently, so a renamed
 * channel or a drifted payload only failed at RUNTIME — `tsc` never saw
 * that what main returned matched what preload cast to.
 *
 * `IpcInvokeContract` maps every request/response channel to its argument
 * tuple and result type. The typed helpers built on top of it
 * (`typedInvoke` in preload, `typedHandle` in main — see
 * `src/preload/ipcTyped.ts` and `src/main/ipc/typedHandle.ts`) bind BOTH
 * ends to this one map, so:
 *   - a typo in a channel name is a compile error (not a key of the map),
 *   - a handler whose return type drifts from what the caller expects is
 *     a compile error, and
 *   - `tests/shared/ipcContract.test.ts` asserts every registered handler
 *     has a contract entry and vice versa (name-level drift guard).
 *
 * Result/arg types reference the ambient globals declared in
 * `src/types.d.ts`; this file is environment-agnostic (no electron / react
 * imports) so it is safe to import from preload, main, and tests alike.
 *
 * Push channels (main → renderer streams via `webContents.send` /
 * `ipcRenderer.on`) are enumerated separately in `IpcPushContract` — they
 * are fire-and-forget events, not request/response, so they carry only a
 * payload type.
 */

export interface IpcInvokeContract {
  // ---------------------------------------------------------------- app
  'app:get-system-languages': { args: []; result: string[] };
  'app:get-info': { args: []; result: AppInfo };
  'app:open-external': { args: [url: string]; result: boolean };
  'app:consume-pending-deep-link': {
    args: [];
    result: DeepLinkTarget | null;
  };
  'app:confirm-close': {
    args: [dirtyFileNames: string[], language?: string];
    result: number;
  };
  'app:confirm-close-tab': {
    args: [fileName: string, language?: string];
    result: number;
  };

  // ------------------------------------------------------------- go runner
  'go:detect': {
    args: [userEnv?: Record<string, string>];
    result: GoDetectResult;
  };
  'go:compile': {
    args: [
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages,
    ];
    result: GoCompileResult;
  };

  // ----------------------------------------------------------- rust runner
  'rust:detect': {
    args: [userEnv?: Record<string, string>];
    result: RustDetectResult;
  };
  'rust:run': {
    args: [
      sourceCode: string,
      userEnv?: Record<string, string>,
      messages?: NativeRunnerMessages,
    ];
    result: RustRunResult;
  };

  // ----------------------------------------------------------- ruby runner
  'ruby:detect': {
    args: [userEnv?: Record<string, string>, force?: boolean];
    result: RubyDetectResult;
  };
  'ruby:run': {
    args: [source: string, options?: RubyRunInvokeOptions];
    result: RubyRunResult;
  };
  'ruby:stop': { args: [runId: string]; result: { stopped: boolean } };
  // F-7 — interactive stdin for a live Ruby run.
  'ruby:stdin-write': { args: [runId: string, data: string]; result: { written: boolean } };
  'ruby:stdin-close': { args: [runId: string]; result: { closed: boolean } };

  // ----------------------------------------------------------- node runner
  'node:detect': {
    args: [userEnv?: Record<string, string>, force?: boolean];
    result: NodeDetectResult;
  };
  'node:run': {
    args: [source: string, options?: NodeRunInvokeOptions];
    result: NodeRunResult;
  };
  'node:stop': { args: [runId: string]; result: { stopped: boolean } };
  // F-7 — interactive stdin for a live Node run.
  'node:stdin-write': { args: [runId: string, data: string]; result: { written: boolean } };
  'node:stdin-close': { args: [runId: string]; result: { closed: boolean } };

  // ------------------------------------------------- Deno / Bun runners (F-4)
  'deno:detect': {
    args: [userEnv?: Record<string, string>, force?: boolean];
    result: AltJsDetectResult;
  };
  'deno:run': { args: [source: string, options?: AltJsRunInvokeOptions]; result: AltJsRunResult };
  'deno:stop': { args: [runId: string]; result: { stopped: boolean } };
  'bun:detect': {
    args: [userEnv?: Record<string, string>, force?: boolean];
    result: AltJsDetectResult;
  };
  'bun:run': { args: [source: string, options?: AltJsRunInvokeOptions]; result: AltJsRunResult };
  'bun:stop': { args: [runId: string]; result: { stopped: boolean } };

  // ------------------------------------------------------------- formatters
  'format:gofmt': { args: [source: string]; result: FormatIpcResult };
  'format:rustfmt': { args: [source: string]; result: FormatIpcResult };
  'format:python': { args: [source: string]; result: FormatIpcResult };

  // ---------------------------------------------------------------- consent
  'consent:set': {
    args: [value: 'granted' | 'declined' | 'unset'];
    result: { ok: true } | { ok: false; reason: string; message?: string };
  };

  // -------------------------------------------------------------------- env
  'env:snapshot': { args: []; result: Record<string, string> };

  // -------------------------------------------------------------- lsp: rust
  'lsp:rust:start': { args: []; result: RustAnalyzerStatus };
  'lsp:rust:restart': { args: []; result: RustAnalyzerStatus };
  'lsp:rust:stop': { args: []; result: { kind: 'stopped' } };
  'lsp:rust:status': { args: []; result: RustAnalyzerStatus };
  'lsp:rust:request': {
    args: [method: string, params: unknown];
    result: { ok: true; result: unknown } | { ok: false; error: string };
  };

  // ---------------------------------------------------------------- lsp: go
  'lsp:go:start': { args: []; result: GoplsStatus };
  'lsp:go:restart': { args: []; result: GoplsStatus };
  'lsp:go:stop': { args: []; result: { kind: 'stopped' } };
  'lsp:go:status': { args: []; result: GoplsStatus };
  'lsp:go:request': {
    args: [method: string, params: unknown];
    result: { ok: true; result: unknown } | { ok: false; error: string };
  };

  // --------------------------------------------------------------------- fs
  'fs:select-directory': {
    args: [];
    result:
      | { canceled: false; rootId: RootId; rootPath: string }
      | { canceled: true; blockedFamily?: FsBlockedPathFamily };
  };
  'fs:select-file': {
    args: [];
    result:
      | {
          canceled: false;
          rootId: RootId;
          rootPath: string;
          fileRelativePath: RelativePath;
          fileName: string;
          content: string;
        }
      | { canceled: true; blockedFamily?: FsBlockedPathFamily };
  };
  'fs:save-dialog': {
    args: [defaultName: string, defaultDir?: string];
    result:
      | {
          canceled: false;
          rootId: RootId;
          rootPath: string;
          fileRelativePath: RelativePath;
        }
      | { canceled: true; blockedFamily?: FsBlockedPathFamily };
  };
  'fs:reopen-root': {
    args: [absolutePath: string];
    result:
      | { ok: true; rootId: RootId; rootPath: string }
      | {
          ok: false;
          error: 'blocked' | 'not-found' | 'not-a-directory' | 'not-approved';
        };
  };
  'fs:reopen-file': {
    args: [absolutePath: string];
    result:
      | {
          ok: true;
          rootId: RootId;
          rootPath: string;
          fileRelativePath: RelativePath;
        }
      | {
          ok: false;
          error: 'blocked' | 'not-found' | 'not-a-file' | 'not-approved';
        };
  };
  'fs:classify-blocked-path': {
    args: [absolutePath: string];
    result: { family: FsBlockedPathFamily | null };
  };
  'fs:revoke-root': { args: [rootId: string]; result: boolean };
  'fs:readdir': {
    args: [rootId: string, relativePath: string];
    result: FsDirEntry[];
  };
  'fs:listAllFiles': {
    args: [rootId: string, relativePath?: string];
    result: FsIndexedFile[];
  };
  'fs:searchInFiles': {
    args: [
      rootId: string,
      relativePath: string,
      query: string,
      options?: FsSearchOptions,
    ];
    result: FsSearchResult[];
  };
  'fs:replaceInFiles': {
    args: [
      rootId: string,
      relativePath: string,
      query: string,
      replacement: string,
      options?: FsReplaceOptions,
    ];
    result: FsReplaceResult[];
  };
  'fs:applyReplaceInFile': {
    args: [
      rootId: string,
      relativePath: string,
      query: string,
      replacement: string,
      options?: FsReplaceOptions,
    ];
    result: FsApplyReplaceResult;
  };
  'fs:stat': {
    args: [rootId: string, relativePath: string];
    result: FsStatResult;
  };
  'fs:read': { args: [rootId: string, relativePath: string]; result: string };
  'fs:write': {
    args: [rootId: string, relativePath: string, content: string];
    result: boolean;
  };
  'fs:delete': {
    args: [
      rootId: string,
      relativePath: string,
      isDirectory?: boolean,
      language?: string,
    ];
    result: boolean;
  };
  'fs:rename': {
    args: [rootId: string, relativeOldPath: string, newName: string];
    result: RelativePath;
  };
  'fs:mkdir': { args: [rootId: string, relativePath: string]; result: boolean };
  'fs:touch': { args: [rootId: string, relativePath: string]; result: boolean };
  'fs:reveal-in-finder': {
    args: [rootId: string, relativePath: string];
    result: boolean;
  };
  'fs:exportBundle': {
    args: [rootId: string, opts?: { entryFile?: string; languageHint?: string }];
    result:
      | { ok: true; fileCount: number; byteLength: number }
      | { canceled: true }
      | { ok: false; reason: 'empty' | 'too-many-files' | 'write-failed' };
  };
  'fs:importBundle': {
    args: [zipBytes: Uint8Array];
    result:
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
        };
  };
  'fs:watch-start': {
    args: [rootId: string, relativePath?: string];
    result: WatchId | { ok: false; diagnostic: WatcherDiagnostic };
  };
  'fs:watch-stop': { args: [watchId: string]; result: boolean };

  // ---------------------------------------------------------------- updates
  'updates:get-state': { args: []; result: UpdateState };
  'updates:check': { args: []; result: UpdateState };
  'updates:restart': { args: []; result: boolean };

  // ---------------------------------------------------------------- plugins
  'plugins:get-install-directory': { args: []; result: string | null };
  'plugins:list': { args: []; result: InstalledPluginRecord[] };

  // ---------------------------------------------------------------- license
  'license:get-state': { args: []; result: LicenseSnapshot };
  'license:apply-token': {
    args: [token: string];
    result: LicenseApplyResult;
  };
  'license:clear': { args: []; result: LicenseClearResult };
  'license:revalidate': { args: []; result: LicenseApplyResult };
  'license:remove-device': {
    args: [deviceIdToRemove: string];
    result: LicenseRemoveDeviceResult;
  };

  // ----------------------------------------------------------- desktop smoke
  'desktop-smoke:get-config': { args: []; result: DesktopSmokeConfig | null };
  'desktop-smoke:capture': {
    args: [name: string];
    result: string | null;
  };
  'desktop-smoke:write-json-artifact': {
    args: [name: string, payload: unknown];
    result: string | null;
  };
  'desktop-smoke:get-offline-blocks': {
    args: [];
    result: readonly string[];
  };
  'desktop-smoke:get-memory-snapshot': {
    args: [];
    result: DesktopSmokeMemorySnapshot;
  };

  // ---------------------------------------------------------------- profile
  'profile:confirm-replace': {
    args: [counts: ProfileConfirmReplaceCounts, language?: string];
    result: number;
  };

  // --------------------------------------------------------------- recovery
  'recovery:confirm-reset': {
    args: [scope: RecoveryResetScope, language?: string];
    result: number;
  };
  'recovery:reveal-folder': {
    args: [];
    result: RecoveryRevealFolderResult;
  };

  // ------------------------------------------------------------ dependencies
  'dependencies:js:resolve': {
    args: [specifiers: readonly string[], filePath?: string];
    result: DependencyResolveResult;
  };
  'dependencies:js:install': {
    args: [runId: string, specifiers: readonly string[], filePath: string];
    result: DependencyInstallResult;
  };
  'dependencies:js:install:cancel': {
    args: [runId: string];
    result: { cancelled: boolean };
  };
  // F-1 — Go / Rust / Ruby install (go get / cargo add / bundle add).
  'dependencies:native:install': {
    args: [language: NativePackageLanguage, specifiers: readonly string[], filePath: string];
    result: NativeInstallResult;
  };

  // -------------------------------------------------------------------- git
  'git:detect': { args: [folderPath?: string]; result: GitDetectResult };
  'git:status': {
    args: [repoRoot: string, filePath: string];
    result: GitFileStatus;
  };
  'git:diff': {
    args: [repoRoot: string, filePath: string];
    result: GitFileDiff;
  };
  'git:reveal': { args: [repoRoot: string]; result: boolean };
  'git:watch-head': { args: [repoRoot: string]; result: { ok: boolean } };
  'git:unwatch-head': { args: [repoRoot: string]; result: { ok: boolean } };
}

/**
 * Main → renderer push channels (`webContents.send` / `ipcRenderer.on`).
 * Fire-and-forget event streams — each entry is just the payload type the
 * renderer receives.
 */
export interface IpcPushContract {
  'app:deep-link': DeepLinkTarget;
  'app:before-close': void;
  'lsp:rust:notification': LspNotification;
  'lsp:rust:status': RustAnalyzerStatus;
  'lsp:go:notification': LspNotification;
  'lsp:go:status': GoplsStatus;
  'fs:changed': FsChangedEvent;
  'fs:watcher-failed': WatcherDiagnostic;
  'fs:watcher-degraded': WatcherDiagnostic;
  'updates:state-changed': UpdateState;
  'dependencies:js:install:log': DependencyInstallLogEvent;
  // F-7 — live stdout/stderr chunks from an interactive Node/Ruby run,
  // streamed as they arrive (keyed by runId) so the console REPL can echo
  // output before the process exits.
  'runtime:output-chunk': RuntimeOutputChunk;
  'git:on-head-changed': GitHeadChangePayload;
  'git:on-head-watcher-failed': GitHeadWatcherFailurePayload;
}

/** Renderer → main fire-and-forget sends (`ipcRenderer.send`). */
export interface IpcSendContract {
  'app:deep-link-renderer-ready': [];
  'app:force-close': [];
  'lsp:rust:notify': [method: string, params: unknown];
  'lsp:go:notify': [method: string, params: unknown];
  'desktop-smoke:finish': [success: boolean];
}

export type IpcInvokeChannel = keyof IpcInvokeContract;
export type IpcInvokeArgs<C extends IpcInvokeChannel> =
  IpcInvokeContract[C]['args'];
export type IpcInvokeResult<C extends IpcInvokeChannel> =
  IpcInvokeContract[C]['result'];

export type IpcPushChannel = keyof IpcPushContract;
export type IpcPushPayload<C extends IpcPushChannel> = IpcPushContract[C];

export type IpcSendChannel = keyof IpcSendContract;
export type IpcSendArgs<C extends IpcSendChannel> = IpcSendContract[C];

/**
 * Runtime list of every invoke channel — kept in lockstep with
 * `IpcInvokeContract` by `tests/shared/ipcContract.test.ts`, which fails if
 * the type has a key this array is missing (or vice versa). Used by the
 * handler-coverage drift guard.
 */
export const IPC_INVOKE_CHANNELS = [
  'app:get-system-languages',
  'app:get-info',
  'app:open-external',
  'app:consume-pending-deep-link',
  'app:confirm-close',
  'app:confirm-close-tab',
  'go:detect',
  'go:compile',
  'rust:detect',
  'rust:run',
  'ruby:detect',
  'ruby:run',
  'ruby:stop',
  'ruby:stdin-write',
  'ruby:stdin-close',
  'node:detect',
  'node:run',
  'node:stop',
  'node:stdin-write',
  'node:stdin-close',
  'deno:detect',
  'deno:run',
  'deno:stop',
  'bun:detect',
  'bun:run',
  'bun:stop',
  'format:gofmt',
  'format:rustfmt',
  'format:python',
  'consent:set',
  'env:snapshot',
  'lsp:rust:start',
  'lsp:rust:restart',
  'lsp:rust:stop',
  'lsp:rust:status',
  'lsp:rust:request',
  'lsp:go:start',
  'lsp:go:restart',
  'lsp:go:stop',
  'lsp:go:status',
  'lsp:go:request',
  'fs:select-directory',
  'fs:select-file',
  'fs:save-dialog',
  'fs:reopen-root',
  'fs:reopen-file',
  'fs:classify-blocked-path',
  'fs:revoke-root',
  'fs:readdir',
  'fs:listAllFiles',
  'fs:searchInFiles',
  'fs:replaceInFiles',
  'fs:applyReplaceInFile',
  'fs:stat',
  'fs:read',
  'fs:write',
  'fs:delete',
  'fs:rename',
  'fs:mkdir',
  'fs:touch',
  'fs:reveal-in-finder',
  'fs:exportBundle',
  'fs:importBundle',
  'fs:watch-start',
  'fs:watch-stop',
  'updates:get-state',
  'updates:check',
  'updates:restart',
  'plugins:get-install-directory',
  'plugins:list',
  'license:get-state',
  'license:apply-token',
  'license:clear',
  'license:revalidate',
  'license:remove-device',
  'desktop-smoke:get-config',
  'desktop-smoke:capture',
  'desktop-smoke:write-json-artifact',
  'desktop-smoke:get-offline-blocks',
  'desktop-smoke:get-memory-snapshot',
  'profile:confirm-replace',
  'recovery:confirm-reset',
  'recovery:reveal-folder',
  'dependencies:js:resolve',
  'dependencies:js:install',
  'dependencies:js:install:cancel',
  'dependencies:native:install',
  'git:detect',
  'git:status',
  'git:diff',
  'git:reveal',
  'git:watch-head',
  'git:unwatch-head',
] as const satisfies readonly IpcInvokeChannel[];
