import i18next from 'i18next';
import type {
  LanguageRunner,
  ExecutionContext,
  ExecutionResult,
  ExecutionError,
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
import { buildGeneratedSourceLineMap } from '../utils/sourceLineMap';
import { runnerStoppedResult, type TranslateFn } from './limits';
import { loadEsbuild } from './esbuildLoader';

// implementation — the literal DEFAULT_TIMEOUT is gone; the runner
// resolves the deadline from the per-language Settings preset on
// every call to `execute()`.

const t: TranslateFn = (key, options) =>
  i18next.t(key, options ?? {}) as string;

export class TypeScriptRunner implements LanguageRunner {
  id = 'typescript';
  name = 'TypeScript';
  language = 'typescript' as const;
  extensions = ['.ts', '.tsx'];

  private ready = false;
  /**
   * TypeScript has an async transpile phase before the worker starts. This
   * token invalidates stale transpiles when Run/Stop is pressed while esbuild
   * is still resolving — the one piece of worker lifecycle the shell cannot
   * own, because the shell has no async step of its own.
   */
  private executionGeneration = 0;

  /** Worker boot, message pump and result assembly, shared with the JS runner. */
  private readonly shell = new WorkerRunnerShell();

  async init(): Promise<void> {
    // Lazy-loads + initializes esbuild-wasm exactly once across all
    // runners (see esbuildLoader.ts) so the chunk stays off the boot path.
    await loadEsbuild();
    this.ready = true;
  }

  isReady(): boolean {
    return this.ready;
  }

  /**
   * Transpile TypeScript to JavaScript using esbuild-wasm.
   *
   * implementation note — when `withMap` is true we ask esbuild for an
   * external source map. Debug runs compose it with the debugger
   * instrumenter map; normal worker runs use it to report console
   * output on the original TS line instead of the post-transpile JS line.
   */
  private async transpile(
    code: string,
    withMap = false
  ): Promise<{ js: string; map?: string; error?: ExecutionError }> {
    try {
      const esbuild = await loadEsbuild();
      const result = await esbuild.transform(code, {
        loader: 'tsx',
        target: 'es2022',
        format: 'esm',
        sourcemap: withMap ? 'external' : false,
      });

      if (result.warnings.length > 0) {
        // Warnings are not fatal; just log them
        for (const w of result.warnings) {
          console.warn(`[esbuild] ${w.text}`);
        }
      }

      return { js: result.code, map: withMap ? result.map : undefined };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // Try to parse esbuild error for line/column info
      const lineMatch = message.match(/(\d+):(\d+)/);
      const lineValue = lineMatch?.[1];
      const columnValue = lineMatch?.[2];
      return {
        js: '',
        error: {
          message: `TypeScript transpilation error: ${message}`,
          line: lineValue ? parseInt(lineValue, 10) : undefined,
          column: columnValue ? parseInt(columnValue, 10) : undefined,
        },
      };
    }
  }

  async execute(code: string, context?: ExecutionContext): Promise<ExecutionResult> {
    // internal debugger refinement — debug mode resolution mirrors the JS
    // runner: only an explicit Debug action attaches the pause protocol.
    const sourceMappingEnabled = true;
    const settings = useSettingsStore.getState();
    // implementation — resolve timeout from the per-language preset
    // unless the caller passed an explicit override.
    const callerOverrode = typeof context?.timeout === 'number';
    const presetForLanguage: RuntimeTimeoutPreset | undefined =
      settings.runtimeTimeoutPresetByLanguage?.['typescript'];
    const timeout = callerOverrode
      ? (context!.timeout as number)
      : resolveTimeoutMs('typescript', presetForLanguage);
    const timeoutPreset: RuntimeTimeoutPreset | 'override' = callerOverrode
      ? 'override'
      : presetForLanguage ?? 'normal';
    const debuggerSettings = true;
    const debugStore = useDebuggerStore.getState();
    const tabBreakpoints = context?.tabId
      ? debugStore.breakpointsForTab(context.tabId).filter((bp) => bp.enabled)
      : [];
    const debug = context?.debug === true && debuggerSettings && tabBreakpoints.length > 0;

    // Step 1: Apply loop protection unless debug mode is active.
    const { maxLoopIterations } = settings;
    const processedCode = !debug
      ? injectJSLoopProtection(code, maxLoopIterations)
      : code;

    // Step 1b: Transform magic comments before transpilation
    // (esbuild would strip the //=> comments during transpilation)
    const magicEntries = detectJSMagicComments(processedCode);
    const hasMagic = magicEntries.length > 0;
    const magicTransformed = hasMagic
      ? transformJSMagicComments(processedCode)
      : processedCode;
    // implementation — per-line kind side-table keyed by the
    // PRE-transpile line number (which is what `__mc` carries into
    // the worker; the transpile pass preserves that argument as-is).
    const { kindByLine: magicKindByLine, directiveByLine: magicDirectiveByLine } =
      buildMagicLineMaps(magicEntries);
    // implementation — opt-in auto-log pass before transpile. The
    // detector reads the PRE-transpile source (TypeScript syntax) so
    // a TypeScript-only construct like a type-only `as` cast does
    // not throw the bracket scanner off; esbuild strips the type
    // annotations downstream while preserving `__mc(line, …)` calls
    // verbatim, which carry the original line number.
    let codeForTranspile = magicTransformed;
    if (context?.autoLog === true && !debug) {
      const magicLines = new Set<number>(magicEntries.map((entry) => entry.line));
      const autoLogLines = detectJSAutoLogLines(processedCode, magicLines);
      if (autoLogLines.length > 0) {
        codeForTranspile = transformJSAutoLog(magicTransformed, autoLogLines);
        markAutoLogLines(magicKindByLine, autoLogLines);
      }
    }

    // implementation — timing markers BEFORE transpile, mirroring the
    // auto-log strategy: the line number is baked into the call
    // argument, so esbuild's line shifts downstream cannot corrupt the
    // attribution. Debug runs never instrument.
    let codeWithTiming = codeForTranspile;
    if (
      !debug &&
      (context?.lineTiming === true ||
        lineTimingRequestedByMagicComment(this.language, processedCode))
    ) {
      const statementLines = detectJSStatementStartLines(codeForTranspile);
      if (statementLines.length > 0) {
        codeWithTiming = transformJSLineTiming(codeForTranspile, statementLines);
      }
    }

    this.stop();
    const executionGeneration = ++this.executionGeneration;

    // Step 2: Transpile TS -> JS. Transpile happens BEFORE the parent
    // kill timer arms; an esbuild parse error reports immediately and
    // never spawns a worker. Request a source map for TS coordinate
    // repair: debug composes it with the instrumenter map, while normal
    // runs pass a generated-line map into the worker for console output.
    const { js, map: tsMap, error: transpileError } =
      await this.transpile(codeWithTiming, true);

    if (executionGeneration !== this.executionGeneration) {
      return runnerStoppedResult(t, { stdout: [], stderr: [] });
    }

    if (transpileError) {
      return {
        stdout: [],
        stderr: [],
        result: undefined,
        executionTime: 0,
        error: transpileError,
        // implementation — transpile failures count as `'error'` so
        // the result-panel pill surfaces a clear failure variant.
        kind: 'error',
      };
    }

    // implementation — instrument the transpiled JS when debug is on.
    // implementation note — pass the esbuild TS→JS map so the instrumenter
    // can compose it with its own JS→JS map and emit yields that fire
    // on the user's TS line numbers (which is what the breakpoint store
    // already keeps).
    const jsWithScopeCapture =
      context?.captureScope === true && !debug
        ? appendScopeCapture(js, collectTopLevelScopeNames(js))
        : js;

    let instrumented = jsWithScopeCapture;
    let sourceLineMap: Record<number, number> | undefined;
    if (debug) {
      try {
        const result = instrumentForDebugger(js, {
          filename: context?.tabId ?? 'user-code.js',
          inputMap: tsMap,
        });
        instrumented = result.code;
        sourceLineMap = result.sourceLineMap;
      } catch {
        instrumented = js;
      }
    } else if (sourceMappingEnabled) {
      const generatedLineMap = buildGeneratedSourceLineMap(
        jsWithScopeCapture,
        tsMap,
      );
      sourceLineMap =
        Object.keys(generatedLineMap).length > 0 ? generatedLineMap : undefined;
    }

    // Step 3: Execute the transpiled JS using the same JS worker
    // Step 3: hand the transpiled JS to the shell shared with the JavaScript
    // runner — same worker, same message pump, same result assembly.
    return this.shell.run({
      code: instrumented,
      language: 'typescript',
      timeout,
      timeoutPreset,
      debug,
      breakpoints: tabBreakpoints,
      watches: debug ? debugStore.watches.map(w => w.expression) : [],
      sourceLineMap,
      sourceMappingEnabled,
      magicKindByLine,
      magicDirectiveByLine,
      // Notebook cells transpile TypeScript themselves and run through the
      // JavaScript runner, so this path never captures a structured result.
      captureStructuredResult: false,
      context,
    });
  }

  /**
   * Bump the generation before delegating: a stop during the async transpile
   * must abort that run before it ever boots a worker. The shell has no async
   * step of its own, so the counter stays here rather than moving into it.
   */
  stop(): void {
    this.executionGeneration += 1;
    this.shell.stop();
  }
}
