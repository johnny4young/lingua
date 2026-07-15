/**
 * RL-019 Slice 3 — Browser preview runtime.
 *
 * Routes JS / TS user code through an iframe-isolated DOM context.
 * The iframe is owned by `<BrowserPreviewPanel>` (the React surface
 * that mounts in the bottom panel); this runner consumes its
 * element ref via `getActiveBrowserPreviewIframe()` and writes the
 * full HTML payload into `srcdoc`.
 *
 * Privacy / security posture (see RUNTIME_MODES_ADR.md § Decision 5
 * + the CSP audit section):
 *
 *   - Iframe `sandbox` attribute carries `allow-scripts` only — no
 *     `allow-same-origin`. The iframe sees its origin as `null`,
 *     `document.cookie` is empty + ignored, `localStorage` /
 *     `sessionStorage` throw on access. Our app origin stays
 *     unreachable from user code.
 *   - Strict CSP inside the srcdoc forbids any network fetch.
 *   - `parent.postMessage` is the only escape hatch back, gated on
 *     the `__lingua` discriminator + the per-run UUID.
 *
 * Lifecycle:
 *
 *   1. `execute()` mints a fresh `runId` (UUID), checks for a
 *      registered iframe ref, and ensures the Browser preview tab
 *      is the active bottom-panel tab.
 *   2. The renderer builds the srcdoc with `buildPreviewDocument`,
 *      installs a `message` listener gated on (origin === 'null'
 *      OR origin === window.origin) + runId, then assigns
 *      `iframe.srcdoc`.
 *   3. The bridge IIFE fires a `ready` message, runs user code,
 *      then fires `done`. Console messages + uncaught errors +
 *      promise rejections stream in between.
 *   4. Parent-owned `setTimeout` clears `srcdoc` on timeout
 *      (effectively terminating user code).
 *   5. On `done` OR timeout OR stop(): resolve the promise with
 *      the canonical ExecutionResult shape and detach the listener.
 */

import i18next from 'i18next';
import type {
  ConsoleOutput,
  ExecutionContext,
  ExecutionError,
  ExecutionResult,
  LanguageRunner,
} from '../types';
import {
  BRIDGE_DISCRIMINATOR,
  buildPreviewDocument,
  isBridgeMessage,
  type BridgeMessage,
} from '../components/BrowserPreview/iframeBridge';
import { getActiveBrowserPreviewIframe, activateBrowserPreviewTab } from '../runtime/browserPreviewBridge';
import { useSettingsStore } from '../stores/settingsStore';
import {
  resolveTimeoutMs,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';
import {
  appendCappedConsole,
  capStderrIfOverflowing,
  runnerStoppedResult,
  runnerTimeoutResult,
  type TranslateFn,
} from './limits';

// RL-020 Slice 7 — the literal DEFAULT_TIMEOUT is gone; the browser
// preview runner inherits the host tab's JS / TS preset on every
// call to `execute()`. The JS host is canonical: when the user
// renames the tab to TS or HTML/CSS, the runner is dispatched per
// language and the JS preset is the right reference.

const t: TranslateFn = (key, options) =>
  i18next.t(key, options ?? {}) as string;

export interface BrowserPreviewSiblingSources {
  /** Sibling `.css` tab content (Fold A multi-file seed). */
  css?: string;
  /** Sibling `.html` tab content (Fold A — sets initial body markup). */
  html?: string;
}

export class BrowserPreviewRunner implements LanguageRunner {
  id = 'browser-preview';
  name = 'Browser preview';
  language = 'javascript' as const;
  extensions = ['.js', '.mjs', '.ts'];

  private ready = false;
  private currentRunId: string | null = null;
  private cancelInFlight: (() => void) | null = null;
  private siblingSources: BrowserPreviewSiblingSources | null = null;
  // Keep only the serializable document. Retaining the iframe would pin a
  // detached BrowserPreviewPanel for the renderer session and would prevent a
  // remounted panel from recovering the last successful preview.
  private lastSuccessfulSrcdoc: string | null = null;

  async init(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Fold A wiring — the runner manager calls this BEFORE
   * `execute()` so the iframe srcdoc can splice sibling CSS /
   * HTML. Optional; missing or null clears the seed.
   */
  setSiblingSources(sources: BrowserPreviewSiblingSources | null): void {
    this.siblingSources = sources;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    // RL-020 Slice 7 — browser preview inherits the JS preset (the
    // canonical host language for the iframe). When the host tab is
    // TS, the preset under `'typescript'` wins because the runner is
    // already dispatched per language.
    const settingsSnapshot = useSettingsStore.getState();
    const callerOverrode = typeof context?.timeout === 'number';
    const presetForLanguage: RuntimeTimeoutPreset | undefined =
      settingsSnapshot.runtimeTimeoutPresetByLanguage?.['javascript'];
    const timeout = callerOverrode
      ? (context!.timeout as number)
      : resolveTimeoutMs('javascript', presetForLanguage);
    const timeoutPreset: RuntimeTimeoutPreset | 'override' = callerOverrode
      ? 'override'
      : presetForLanguage ?? 'normal';
    const stdout: ConsoleOutput[] = [];
    const stderr: ConsoleOutput[] = [];
    let droppedStdout = 0;
    let droppedStderr = 0;
    let stderrByteTruncated = false;
    let executionError: ExecutionError | undefined;

    const iframe = getActiveBrowserPreviewIframe();
    if (!iframe) {
      // Panel not mounted (e.g., user runs from the palette before
      // the bottom panel ever opens). Surface a clear error rather
      // than silently hanging.
      return {
        stdout,
        stderr: [
          {
            type: 'error',
            args: [t('browserPreview.error.panelMissing')],
          },
        ],
        result: undefined,
        executionTime: 0,
        error: {
          message: t('browserPreview.error.panelMissing'),
        },
        // RL-020 Slice 7 — panel-missing counts as `'error'`.
        kind: 'error',
      };
    }

    // Bring the Browser preview tab to the front so the iframe is
    // visible while user code runs. No-op if it's already active.
    activateBrowserPreviewTab();

    // Stop any previous in-flight run before starting a new one.
    this.stop();

    const runId = crypto.randomUUID();
    this.currentRunId = runId;
    const doc = buildPreviewDocument({
      runId,
      userCode: code,
      siblingCss: this.siblingSources?.css,
      siblingHtml: this.siblingSources?.html,
    });

    return new Promise<ExecutionResult>((resolve) => {
      let resolved = false;
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      // Capture the wall-clock start so the `done` branch reports
      // actual elapsed time, not the timeout budget. The clock starts
      // just before the listener attaches; the `srcdoc` assignment +
      // bridge installation cost is what we want to measure.
      const startMs = Date.now();

      const clearDeadline = () => {
        if (timeoutHandle !== null) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      const detachListener = () => {
        window.removeEventListener('message', handleMessage);
      };

      const restoreLastSuccessfulDocument = (clearWhenDisabled = false) => {
        const preserve = context?.preserveBrowserPreviewOnFailure === true;
        if (!preserve && !clearWhenDisabled) return;
        try {
          iframe.srcdoc = preserve ? (this.lastSuccessfulSrcdoc ?? '') : '';
        } catch {
          /* iframe may be detached; ignore */
        }
      };

      const finish = (value: ExecutionResult) => {
        if (resolved) return;
        resolved = true;
        clearDeadline();
        detachListener();
        if (this.currentRunId === runId) this.currentRunId = null;
        if (this.cancelInFlight === cancel) this.cancelInFlight = null;
        resolve(value);
      };

      const cancel = () => {
        // Manual stop keeps the legacy blanking behavior. A superseded silent
        // refresh restores the last successful document instead, so rapid
        // edits never flash an empty preview between accepted runs.
        restoreLastSuccessfulDocument(true);
        finish(runnerStoppedResult(t, { stdout, stderr }));
      };
      this.cancelInFlight = cancel;

      const handleMessage = (event: MessageEvent) => {
        // Origin guard: sandboxed iframe without `allow-same-origin`
        // posts as `null`. In test or future allow-origin contexts,
        // accept the parent origin too. Everything else is rejected.
        const expectedOrigins = new Set<string>(['null']);
        if (typeof window !== 'undefined' && window.location?.origin) {
          expectedOrigins.add(window.location.origin);
        }
        if (event.origin && !expectedOrigins.has(event.origin)) return;
        if (!isBridgeMessage(event.data)) return;
        const message = event.data as BridgeMessage;
        // Anti-spoof: only process messages from the active runId.
        if (message.runId !== runId) return;
        if (this.currentRunId !== runId) return;

        switch (message.type) {
          case 'ready':
            // Bridge installed; user code about to run. No-op for
            // now — the runner's start time is `execute()` entry.
            break;
          case 'console': {
            const output: ConsoleOutput = {
              type: message.method,
              args: message.args,
            };
            if (message.method === 'error') {
              if (!stderrByteTruncated) {
                droppedStderr = appendCappedConsole(stderr, output, droppedStderr, t);
                stderrByteTruncated = capStderrIfOverflowing(stderr, t);
              }
            } else {
              droppedStdout = appendCappedConsole(stdout, output, droppedStdout, t);
            }
            context?.onConsole?.(output);
            break;
          }
          case 'error': {
            const error: ConsoleOutput = {
              type: 'error',
              args: [message.stack ?? message.message],
            };
            if (!stderrByteTruncated) {
              droppedStderr = appendCappedConsole(stderr, error, droppedStderr, t);
              stderrByteTruncated = capStderrIfOverflowing(stderr, t);
            }
            executionError = {
              message: message.message,
              line: message.lineno,
              column: message.colno,
              stack: message.stack,
            };
            context?.onConsole?.(error);
            break;
          }
          case 'unhandledrejection': {
            const error: ConsoleOutput = {
              type: 'error',
              args: [message.message],
            };
            if (!stderrByteTruncated) {
              droppedStderr = appendCappedConsole(stderr, error, droppedStderr, t);
              stderrByteTruncated = capStderrIfOverflowing(stderr, t);
            }
            executionError = executionError ?? { message: message.message };
            context?.onConsole?.(error);
            break;
          }
          case 'done': {
            if (executionError) {
              restoreLastSuccessfulDocument();
            } else {
              this.lastSuccessfulSrcdoc = doc;
            }
            finish({
              stdout,
              stderr,
              result: undefined,
              executionTime: Date.now() - startMs,
              error: executionError,
              kind: executionError ? 'error' : 'success',
              timeoutPreset,
              timeoutMs: timeout,
            });
            break;
          }
        }
      };

      window.addEventListener('message', handleMessage);

      timeoutHandle = setTimeout(() => {
        restoreLastSuccessfulDocument(true);
        finish(runnerTimeoutResult(timeout, t, { stdout, stderr }, timeoutPreset));
      }, timeout);

      // Build the srcdoc and assign it. The iframe `load` event
      // does NOT need to be awaited — the bridge IIFE will fire
      // its `ready` message once it has installed listeners, and
      // user code follows naturally.
      try {
        iframe.srcdoc = doc;
      } catch (assignError) {
        restoreLastSuccessfulDocument();
        finish({
          stdout,
          stderr: [
            {
              type: 'error',
              args: [
                assignError instanceof Error
                  ? assignError.message
                  : 'Failed to load browser preview document.',
              ],
            },
          ],
          result: undefined,
          executionTime: 0,
          error: {
            message:
              assignError instanceof Error
                ? assignError.message
                : 'Failed to load browser preview document.',
          },
          kind: 'error',
          timeoutPreset,
          timeoutMs: timeout,
        });
      }
    });
  }

  stop(): void {
    if (this.cancelInFlight) {
      const cancel = this.cancelInFlight;
      this.cancelInFlight = null;
      cancel();
    }
    this.currentRunId = null;
  }
}

// Re-export the discriminator + types so callers can build their
// own protocol-aware tests without re-importing from the bridge
// directly.
export { BRIDGE_DISCRIMINATOR };
export type { BridgeMessage };
