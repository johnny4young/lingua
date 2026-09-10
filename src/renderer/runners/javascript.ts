import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
} from '../types/execution';
import {
  transformJSMagicComments,
  detectJSMagicComments,
  detectJSAutoLogLines,
  detectJSStatementStartLines,
  lineTimingRequestedByMagicComment,
  transformJSAutoLog,
  transformJSLineTiming,
} from '../utils/magicComments';
import { buildMagicLineMaps, markAutoLogLines } from './magicLineMap';
import { WorkerRunnerShell } from './workerRunnerShell';
import { injectJSLoopProtection } from '../utils/loopProtection';
import { useSettingsStore } from '../stores/settingsStore';
import {
  resolveTimeoutMs,
  type RuntimeTimeoutPreset,
} from '../../shared/runtimeTimeoutPresets';
import { useDebuggerStore } from '../stores/debuggerStore';
import { instrumentForDebugger } from '../runtime/debuggerInstrument';
import {
  appendScopeCapture,
  collectTopLevelScopeNames,
} from '../utils/scopeCapture';

// implementation — the literal `DEFAULT_TIMEOUT` is gone; the
// runner reads the per-language preset from settings every time
// `execute()` is called so a Settings change picks up on the very
// next run without restarting the worker.


export class JavaScriptRunner implements LanguageRunner {
  id = 'javascript';
  name = 'JavaScript';
  language = 'javascript' as const;
  extensions = ['.js', '.mjs'];

  private ready = false;

  /**
   * Worker boot, the message pump, the kill timer and `stop()` all live in the
   * shell, shared with the TypeScript runner. This runner keeps only the
   * transform pipeline above it.
   */
  private readonly shell = new WorkerRunnerShell();

  async init(): Promise<void> {
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    // implementation — origin capture is baseline; no runtime opt-out.
    const sourceMappingEnabled = true;

    // internal debugger refinement — debug mode is now an explicit UI
    // intent. Normal Run ignores breakpoints so gutter marks do not
    // silently change execution semantics; Debug instruments the source
    // and auto-disables loop protection only when an enabled breakpoint
    // exists in the active tab.
    const settings = useSettingsStore.getState();
    // implementation — resolve the run-time deadline from the
    // per-language preset whenever the caller did NOT pass an
    // explicit timeout. Caller overrides (one-shot extended,
    // magic-comment `// @timeout`) keep the original number and
    // the pill tooltip drops the preset name via the `'override'`
    // sentinel.
    const callerOverrode = typeof context?.timeout === 'number';
    const presetForLanguage: RuntimeTimeoutPreset | undefined =
      settings.runtimeTimeoutPresetByLanguage?.['javascript'];
    const timeout = callerOverrode
      ? (context!.timeout as number)
      : resolveTimeoutMs('javascript', presetForLanguage);
    const timeoutPreset: RuntimeTimeoutPreset | 'override' = callerOverrode
      ? 'override'
      : presetForLanguage ?? 'normal';
    // implementation — debugger is baseline; the Settings master toggle is gone.
    const debuggerSettings = true;
    const debugStore = useDebuggerStore.getState();
    const tabBreakpoints = context?.tabId
      ? debugStore.breakpointsForTab(context.tabId).filter((bp) => bp.enabled)
      : [];
    const debug = context?.debug === true && debuggerSettings && tabBreakpoints.length > 0;

    // implementation — loop protection is baseline (the runtime kill switch
    // against `while(true)` cannot be user-tunable on a code editor).
    const { maxLoopIterations } = settings;
    const protectedCode = !debug
      ? injectJSLoopProtection(code, maxLoopIterations)
      : code;

    // Transform magic comments before execution
    const magicEntries = detectJSMagicComments(protectedCode);
    const hasMagic = magicEntries.length > 0;
    const magicTransformed = hasMagic ? transformJSMagicComments(protectedCode) : protectedCode;
    // The worker postMessage protocol stays kind-agnostic, so the
    // variant and the rich-output directive of each line travel in
    // side-tables consulted at result-stitching time below.
    const { kindByLine: magicKindByLine, directiveByLine: magicDirectiveByLine } =
      buildMagicLineMaps(magicEntries);
    // implementation — opt-in auto-log pass after the magic-comment
    // transform. The detector excludes lines already claimed by an
    // arrow / watch (magic-comment precedence is preserved), and the
    // transform replaces each bare expression with a single
    // `__mc(line, value)` capture so side effects do not run twice.
    // Debug runs deliberately
    // SKIP the auto-log transform — pause / step semantics already
    // produce a richer view of the program state, and silent
    // injections under a paused frame would surprise the user.
    let codeWithAutoLog = magicTransformed;
    if (context?.autoLog === true && !debug) {
      const magicLines = new Set<number>(magicEntries.map((entry) => entry.line));
      const autoLogLines = detectJSAutoLogLines(protectedCode, magicLines);
      if (autoLogLines.length > 0) {
        codeWithAutoLog = transformJSAutoLog(magicTransformed, autoLogLines);
        markAutoLogLines(magicKindByLine, autoLogLines);
      }
    }

    // implementation — per-statement timing markers, AFTER auto-log
    // (the transformed capture lines are still single top-level
    // statements) and BEFORE scope capture so the appended capture code
    // is never attributed to a user statement. Enabled by the Settings
    // toggle (context.lineTiming) OR a `// @time` directive in the
    // buffer; debug runs never instrument — pause/step already owns
    // that view.
    let codeWithTiming = codeWithAutoLog;
    if (
      !debug &&
      (context?.lineTiming === true ||
        lineTimingRequestedByMagicComment(this.language, protectedCode))
    ) {
      const statementLines = detectJSStatementStartLines(codeWithAutoLog);
      if (statementLines.length > 0) {
        codeWithTiming = transformJSLineTiming(codeWithAutoLog, statementLines);
      }
    }

    let codeWithScopeCapture = codeWithTiming;
    if (context?.captureScope === true && !debug) {
      codeWithScopeCapture = appendScopeCapture(
        codeWithTiming,
        collectTopLevelScopeNames(codeWithTiming)
      );
    }

    let transformedCode = codeWithScopeCapture;
    let sourceLineMap: Record<number, number> | undefined;
    if (debug) {
      try {
        const instrumented = instrumentForDebugger(codeWithAutoLog, {
          filename: context?.tabId ?? 'user-code.js',
        });
        transformedCode = instrumented.code;
        sourceLineMap = instrumented.sourceLineMap;
      } catch {
        // Instrumentation failure should NOT block a run — fall back
        // to executing the un-instrumented source so the user still
        // sees runtime errors instead of an opaque "instrumentation
        // failed" screen.
        transformedCode = codeWithAutoLog;
      }
    }

    // Everything past the transform — worker boot, kill timer, message pump,
    // result assembly — is the shell shared with the TypeScript runner.
    return this.shell.run({
      code: transformedCode,
      language: 'javascript',
      timeout,
      timeoutPreset,
      debug,
      breakpoints: tabBreakpoints,
      watches: debug ? debugStore.watches.map(w => w.expression) : [],
      sourceLineMap,
      sourceMappingEnabled,
      magicKindByLine,
      magicDirectiveByLine,
      captureStructuredResult: context?.captureStructuredResult === true,
      context,
    });
  }

  stop(): void {
    this.shell.stop();
  }
}
