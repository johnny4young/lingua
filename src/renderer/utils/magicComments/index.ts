/**
 * Magic comment transformation for inline expression evaluation.
 *
 * Three variants:
 *
 *   - **Arrow `//=>` (JS / TS) and `#=>` (Python)** — ad-hoc inline
 *     peek; the line's prefix code IS the expression. The line gets
 *     replaced with a `__mc(line, value)` call.
 *
 *   - **`// @watch <expr>` (JS / TS) and `# @watch <expr>` (Python)** —
 *     implementation A *pinned* watch on an explicit expression. The
 *     line's prefix code is PRESERVED so the original statement still
 *     runs; the transform appends a `__mc(line, value)` call on the
 *     watched expression. Renderer tags the resulting `LineResult`
 *     with `type: 'watch'` (vs `'magic'` for arrows) so the panel can
 *     render a pin icon + sticky semantics.
 *
 *   - **Auto-log (JS / TS source pass)** — opt-in
 *     whole-buffer pass. Every TOP-LEVEL bare expression statement
 *     is replaced with a `__mc(line, value)` capture so the expression
 *     executes once and its value surfaces inline without the user
 *     typing a `//=>`. The detector yields a sparse line list; the
 *     transform consumes it and emits `kind: 'autoLog'` in the side
 *     table the runner reads. Magic arrow / watch lines win over
 *     auto-log on the same line (the detector explicitly excludes
 *     them).
 *
 * Python Scratchpad auto-log uses CPython's AST inside the Pyodide worker and
 * funnels into the same `__mc` result channel. Explicit Python arrows/watches
 * remain owned by this source transform.
 */

export {
  extractTimeoutMagicComment,
  lineTimingRequestedByMagicComment,
  originSuppressedByMagicComment,
} from './directives';
export { detectJSAutoLogLines, transformJSAutoLog } from './jsAutoLog';
export { detectJSMagicComments, transformJSMagicComments } from './jsDetect';
export { detectJSStatementStartLines, transformJSLineTiming } from './jsLineTiming';
// `MagicCommentTransformOptions` stays internal to ./kinds: it is the
// option bag of `magicCommentKindsByLine` and has never had a consumer
// outside this folder. Re-exporting it here would be dead surface.
export { magicCommentKindsByLine } from './kinds';
export { detectPythonMagicComments, transformPythonMagicComments } from './python';
export type {
  MagicCommentDirective,
  MagicCommentKind,
  MagicCommentLine,
} from './types';
