/**
 * RL-044 Slice 2a — Sub-slice F clickable error stacks.
 *
 * Pure, no-DOM, no-React module that converts a runtime error's
 * `stack` string (Node / browser JS) or a Python traceback into a
 * uniform `ClickableStackFrame[]` shape the renderer can map to
 * clickable UI rows.
 *
 * Design choices:
 *   - **Conservative parsers.** Best-effort. Anything we can't parse
 *     stays as a `text`-only frame (no `file` / `line` / `column`)
 *     so the renderer paints it as a non-clickable span. We never
 *     throw on malformed input.
 *   - **No source-map resolution.** Whatever the worker reports
 *     literally is what we keep. Source-map resolution is RL-027
 *     lane crossover; not in this slice.
 *   - **Pure shared module.** Used by JS worker + Python worker +
 *     renderer + tests. No imports from renderer-only code.
 */

export interface ClickableStackFrame {
  /** Raw source line (e.g. `at fn (file.ts:12:5)`). Always present. */
  text: string;
  /** Resolved file path. Absent when the parser can't extract one. */
  file?: string;
  /** 1-based line number. Absent when the parser can't extract one. */
  line?: number;
  /** 1-based column number. Absent when the parser can't extract one. */
  column?: number;
  /**
   * Optional function name (best-effort). Useful for the renderer's
   * "Open in tab" affordance label, but not load-bearing.
   */
  fnName?: string;
}

// ---------------------------------------------------------------------------
// JavaScript / TypeScript stack parsing
// ---------------------------------------------------------------------------

/**
 * Two stack shapes V8 + JavaScriptCore produce in the wild:
 *
 *   1. `    at fnName (file:line:column)`         (V8 with name)
 *   2. `    at file:line:column`                  (V8 without name)
 *
 * SpiderMonkey uses `fnName@file:line:column` (slightly different
 * shape). We accept all three. Anything else is preserved as
 * `text`-only.
 *
 * The first line of `Error.stack` is conventionally the error
 * message (e.g. `Error: boom`). We never treat that as a frame; the
 * regexes only fire on lines that look like stack entries.
 */
const V8_WITH_NAME = /^\s*at\s+(?<fn>.+?)\s+\((?<file>.+?):(?<line>\d+):(?<col>\d+)\)\s*$/;
const V8_WITHOUT_NAME = /^\s*at\s+(?<file>.+?):(?<line>\d+):(?<col>\d+)\s*$/;
const SPIDERMONKEY = /^\s*(?<fn>.*?)@(?<file>.+?):(?<line>\d+):(?<col>\d+)\s*$/;

/**
 * RL-044 Slice 2b-β-α Prerequisite fix — eval-internal heuristic.
 *
 * In Lingua, user code runs inside an AsyncFunction inside the Web
 * Worker, so V8 produces frames like:
 *   `at inner (eval at <anonymous> (http://.../js-worker.ts?worker_file:614:16), <anonymous>:36:26)`
 *
 * The greedy/lazy regex captures `file` as
 * `eval at <anonymous> (http://.../js-worker.ts?worker_file:614:16), <anonymous>`
 * — a garbage path no editor can open. Marking these frames as
 * "clickable" produces broken Open-in-editor affordances.
 *
 * Detect the eval-internal pattern and re-classify those frames as
 * text-only (preserve the function name + line:col in the visible
 * text for context; the renderer paints them as non-clickable spans).
 */
function isEvalInternalFile(file: string | undefined): boolean {
  if (typeof file !== 'string' || file.length === 0) return true;
  if (file.includes('eval at ')) return true;
  if (file.includes('<anonymous>')) return true;
  // Internal worker URLs — useful to no editor jump.
  if (file.includes('worker_file')) return true;
  return false;
}

export function parseJsErrorStack(stack: string | undefined): ClickableStackFrame[] {
  if (!stack || typeof stack !== 'string') return [];
  const lines = stack.split('\n');
  const frames: ClickableStackFrame[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (raw.trim().length === 0) continue;
    const v8Named = raw.match(V8_WITH_NAME);
    if (v8Named?.groups) {
      const lineNum = Number.parseInt(v8Named.groups.line ?? '', 10);
      const colNum = Number.parseInt(v8Named.groups.col ?? '', 10);
      if (isEvalInternalFile(v8Named.groups.file)) {
        // Keep the function name in the text so the user still sees
        // which user function the frame belongs to.
        frames.push({
          text: raw.trim(),
          fnName: v8Named.groups.fn,
        });
        continue;
      }
      frames.push({
        text: raw.trim(),
        fnName: v8Named.groups.fn,
        file: v8Named.groups.file,
        line: Number.isFinite(lineNum) ? lineNum : undefined,
        column: Number.isFinite(colNum) ? colNum : undefined,
      });
      continue;
    }
    const v8Bare = raw.match(V8_WITHOUT_NAME);
    if (v8Bare?.groups) {
      const lineNum = Number.parseInt(v8Bare.groups.line ?? '', 10);
      const colNum = Number.parseInt(v8Bare.groups.col ?? '', 10);
      if (isEvalInternalFile(v8Bare.groups.file)) {
        frames.push({ text: raw.trim() });
        continue;
      }
      frames.push({
        text: raw.trim(),
        file: v8Bare.groups.file,
        line: Number.isFinite(lineNum) ? lineNum : undefined,
        column: Number.isFinite(colNum) ? colNum : undefined,
      });
      continue;
    }
    const sm = raw.match(SPIDERMONKEY);
    if (sm?.groups) {
      const lineNum = Number.parseInt(sm.groups.line ?? '', 10);
      const colNum = Number.parseInt(sm.groups.col ?? '', 10);
      if (isEvalInternalFile(sm.groups.file)) {
        frames.push({
          text: raw.trim(),
          fnName: sm.groups.fn?.length ? sm.groups.fn : undefined,
        });
        continue;
      }
      frames.push({
        text: raw.trim(),
        fnName: sm.groups.fn?.length ? sm.groups.fn : undefined,
        file: sm.groups.file,
        line: Number.isFinite(lineNum) ? lineNum : undefined,
        column: Number.isFinite(colNum) ? colNum : undefined,
      });
      continue;
    }
    // Header line (e.g. `Error: boom`), eval frame, anonymous frame,
    // or anything else we don't recognise. Keep the literal text so
    // the renderer paints it as a non-clickable span.
    frames.push({ text: raw.trim() });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Python traceback parsing
// ---------------------------------------------------------------------------

/**
 * Python traceback shape:
 *
 *   Traceback (most recent call last):
 *     File "<path>", line <N>, in <fn>
 *       <source line>
 *   <ExceptionType>: <message>
 *
 * We extract the `File`-prefixed lines. The source-line below each
 * `File` line is kept as a continuation `text`-only frame so the
 * renderer can render the visual hint, but it stays non-clickable.
 */
const PYTHON_FILE_LINE =
  /^\s*File\s+"(?<file>.+?)",\s+line\s+(?<line>\d+)(?:,\s+in\s+(?<fn>.+))?\s*$/;

export function parsePythonTraceback(text: string | undefined): ClickableStackFrame[] {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split('\n');
  const frames: ClickableStackFrame[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] ?? '';
    if (raw.trim().length === 0) continue;
    const match = raw.match(PYTHON_FILE_LINE);
    if (match?.groups) {
      const lineNum = Number.parseInt(match.groups.line ?? '', 10);
      frames.push({
        text: raw.trim(),
        file: match.groups.file,
        line: Number.isFinite(lineNum) ? lineNum : undefined,
        fnName: match.groups.fn,
      });
      // Pull the source line that conventionally follows. Only when it
      // is non-empty AND not another `File` line — otherwise it gets
      // its own frame on the next iteration.
      const nextRaw = lines[i + 1] ?? '';
      const nextIsAnotherFile = nextRaw.match(PYTHON_FILE_LINE) !== null;
      if (nextRaw.trim().length > 0 && !nextIsAnotherFile) {
        frames.push({ text: nextRaw.trim() });
        i += 1; // Consumed the source line.
      }
      continue;
    }
    frames.push({ text: raw.trim() });
  }
  return frames;
}

// ---------------------------------------------------------------------------
// Convenience predicate
// ---------------------------------------------------------------------------

/**
 * `true` when the frame carries enough information for the renderer
 * to render it as a clickable button. `false` keeps it as plain text.
 */
export function isClickable(frame: ClickableStackFrame): boolean {
  return (
    typeof frame.file === 'string' && frame.file.length > 0 && typeof frame.line === 'number'
  );
}
