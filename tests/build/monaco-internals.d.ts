/** Minimal declarations for the exact pinned Monaco internals exercised by the patch guard. */
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
