/** Minimal declarations for the exact pinned Monaco internals exercised by the patch guards. */
declare module 'monaco-editor/esm/vs/base/common/async.js' {
  export class Delayer<T> {
    constructor(defaultDelay: number);
    trigger(task: () => T | Promise<T>, delay?: number): Promise<T>;
    dispose(): void;
  }
}
declare module 'monaco-editor/esm/vs/base/common/errors.js' {
  export const errorHandler: { unexpectedErrorHandler: (error: unknown) => void };
  export function onUnexpectedError(error: unknown): void;
}
declare module 'monaco-editor/esm/vs/language/typescript/languageFeatures.js' {
  export class DiagnosticsAdapter {
    constructor(
      libFiles: { fetchLibFilesIfNecessary(uris: unknown[]): Promise<void> },
      defaults: {
        getDiagnosticsOptions(): object;
        onDidChange(listener: () => void): { dispose(): void };
        onDidExtraLibsChange(listener: () => void): { dispose(): void };
      },
      selector: string,
      worker: (...uris: unknown[]) => Promise<unknown>
    );
    dispose(): void;
  }
}
