/**
 * implementation — best-effort `file.ext:N` splitter for the
 * Go and Rust desktop runners.
 *
 * Go and Rust subprocesses emit panic / debug output that includes
 * paths like `runtime.go:42` (panic stack) or `src/main.rs:8`
 * (Rust panic format). When the renderer's `<OutputLineBadge>`
 * chip wants to surface a line origin for those rows, it falls back
 * to `ConsoleOutput.line` — and these runners populate that field
 * via the splitter below.
 *
 * Defensive contract:
 *   - Only looks at the first match in the args text. Multiple
 *     `file:N` references in a single line (rare for panics) keep
 *     the FIRST line number.
 *   - The matched line MUST be a positive integer ≤ 100_000 so a
 *     bogus log like `error.go:0` or `file.rs:-3` does not poison
 *     the chip's `revealLineInCenter` call.
 *   - The path-segment before `:N` MUST end in one of the supported
 *     extensions; a generic `foo:42` (without `.go` / `.rs`) never
 *     fires.
 *   - Returns `undefined` for empty input, non-string args, or
 *     when no match is found. Callers can safely OR-fallback.
 *
 * Performance: a precompiled regex with anchors + a single capture
 * group. The Go / Rust runner-side hot path receives at most ~MAX
 * stdout messages per execution (capped upstream), so the per-line
 * cost is negligible.
 */

// IMPORTANT: the path character class deliberately excludes `.` to
// avoid catastrophic backtracking. A broader draft
// (`[\w./_-]+\.go`) overlapped on `.` and could backtrack heavily on
// long stdout chunks that did not terminate in `.go` / `.rs`.
// Dropping `.` from the path class keeps the regex linear and matches
// the Go / Rust file-naming convention (paths use `/` separators and
// segments use underscores, not dots). The final extension is the
// only `.` accepted, via the literal `\.go` / `\.rs`.
const GO_LINE_RE = /([\w/_-]+\.go):(\d+)/;
const RUST_LINE_RE = /([\w/_-]+\.rs):(\d+)/;

const MAX_REASONABLE_LINE = 100_000;
// Belt-and-suspenders: even with a linear regex, refuse to scan
// anything larger than this. A real panic frame fits comfortably in
// a few hundred chars; anything bigger is either a binary blob or a
// data-style log that doesn't carry source attribution.
const MAX_SCAN_BYTES = 4096;

export type OriginLanguage = 'go' | 'rust';

export interface SplittedOrigin {
  /** The file path captured, useful for the implementation note guard when ConsoleEntry.tabId lands. */
  file: string;
  line: number;
}

export function extractOriginFromGoStdout(text: string): SplittedOrigin | undefined {
  return extractOrigin(text, GO_LINE_RE);
}

export function extractOriginFromRustStdout(text: string): SplittedOrigin | undefined {
  return extractOrigin(text, RUST_LINE_RE);
}

export function extractOrigin(
  text: unknown,
  pattern: RegExp
): SplittedOrigin | undefined {
  if (typeof text !== 'string' || text.length === 0) return undefined;
  // Belt-and-suspenders: cap input length so a degenerate stdout
  // chunk cannot dominate the renderer event loop even if a future
  // regex tweak slips a backtracking risk back in. 4 KiB is generous
  // for a real panic frame (typically < 200 chars).
  const head = text.length > MAX_SCAN_BYTES ? text.slice(0, MAX_SCAN_BYTES) : text;
  const match = head.match(pattern);
  if (!match || !match[1] || !match[2]) return undefined;
  const line = parseInt(match[2], 10);
  if (!Number.isFinite(line) || line <= 0 || line > MAX_REASONABLE_LINE) {
    return undefined;
  }
  return { file: match[1], line };
}

/** Wire-helper used by go.ts / rust.ts when adapting a ConsoleOutput. */
export function enrichConsoleOutputLine(
  language: OriginLanguage,
  existingLine: number | undefined,
  args: readonly unknown[] | undefined
): number | undefined {
  if (typeof existingLine === 'number' && existingLine > 0) return existingLine;
  if (!args || args.length === 0) return undefined;
  const text = args.map((a) => (typeof a === 'string' ? a : '')).join(' ');
  const splitter =
    language === 'go' ? extractOriginFromGoStdout : extractOriginFromRustStdout;
  return splitter(text)?.line;
}
