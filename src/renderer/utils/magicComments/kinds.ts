/**
 * The per-line `kind` side-table runners consult at result-stitching
 * time, since the worker postMessage protocol is kind-agnostic.
 */

import { detectJSAutoLogLines } from './jsAutoLog';
import { detectJSMagicComments } from './jsDetect';
import { detectPythonMagicComments } from './python';
import type { MagicCommentKind } from './types';

/**
 * Runner-side option bag for the JS / TS source pass. Python auto-log is
 * worker-owned and therefore intentionally ignored here.
 */
export interface MagicCommentTransformOptions {
  /**
   * Replace every top-level bare expression statement with an
   * `__mc(line, value)` capture, in addition to any explicit `//=>`
   * arrows and `// @watch` watches. JS / TS only.
   */
  autoLog?: boolean;
}

/**
 * implementation — derive the per-line `kind` map for a given source.
 * Runners use this side-table at result-stitching time to tag each
 * incoming `magic-comment` worker message with `'arrow'` /
 * `'watch'` / `'autoLog'` (the worker postMessage protocol is
 * intentionally kind-agnostic).
 *
 * Returns a sparse `Record<lineNumber, MagicCommentKind>`; lookup
 * defaults to `'arrow'` for any unrecognized line — the worker would
 * not have emitted a message for that line in the first place, so
 * the fallback is purely defensive.
 *
 * implementation — when `options.autoLog` is true and the language
 * is JS / TS, any line that the auto-log detector flags AND that is
 * not already claimed by an arrow / watch gets `kind: 'autoLog'` in
 * the returned map. Arrow + watch win over auto-log on the same
 * line because `detectJSAutoLogLines` consumes a magic-line skip
 * set.
 */
export function magicCommentKindsByLine(
  language: 'javascript' | 'typescript' | 'python',
  code: string,
  options: MagicCommentTransformOptions = {}
): Record<number, MagicCommentKind> {
  const detected =
    language === 'python'
      ? detectPythonMagicComments(code)
      : detectJSMagicComments(code);
  const map: Record<number, MagicCommentKind> = {};
  for (const entry of detected) {
    map[entry.line] = entry.kind;
  }
  if (options.autoLog && language !== 'python') {
    const magicLines = new Set<number>(detected.map((entry) => entry.line));
    for (const line of detectJSAutoLogLines(code, magicLines)) {
      // Arrow / watch already in the map — `detectJSAutoLogLines`
      // received `magicLines` and would not yield those lines. The
      // explicit guard below makes the precedence reviewable.
      if (!(line in map)) {
        map[line] = 'autoLog';
      }
    }
  }
  return map;
}
