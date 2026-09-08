/**
 * The per-line side-tables every worker runner builds from its detected
 * magic comments.
 *
 * The worker postMessage protocol is deliberately kind-agnostic: a
 * `magic-comment` message carries a line number and a value, never the
 * syntactic variant that produced it. Each runner therefore keeps two
 * sparse maps built before execution and consults them while stitching
 * results back:
 *
 *   - `kindByLine` tags the incoming result `'arrow'` / `'watch'` /
 *     `'autoLog'`.
 *   - `directiveByLine` tells the runner when to upgrade a stringified
 *     value into a typed `RichOutputPayload` (`//=> table`, `chart`,
 *     `image`, `html`).
 *
 * JS, TS and Python built these identically; the auto-log merge below is
 * the only JS/TS-specific half, which is why it is a separate call
 * rather than a flag.
 */

import type {
  MagicCommentDirective,
  MagicCommentKind,
  MagicCommentLine,
} from '../utils/magicComments';

export interface MagicLineMaps {
  /** Sparse 1-based line number to the variant that produced it. */
  kindByLine: Record<number, MagicCommentKind>;
  /** Sparse 1-based line number to its rich-output directive, when present. */
  directiveByLine: Record<number, MagicCommentDirective>;
}

/**
 * Build both side-tables from the detector output. A later entry on the
 * same line wins, preserving the original per-runner loop semantics.
 */
export function buildMagicLineMaps(
  entries: ReadonlyArray<MagicCommentLine>
): MagicLineMaps {
  const kindByLine: Record<number, MagicCommentKind> = {};
  const directiveByLine: Record<number, MagicCommentDirective> = {};
  for (const entry of entries) {
    kindByLine[entry.line] = entry.kind;
    if (entry.directive) {
      directiveByLine[entry.line] = entry.directive;
    }
  }
  return { kindByLine, directiveByLine };
}

/**
 * Merge auto-log lines into an existing kind map WITHOUT overwriting a
 * line an arrow or watch already claimed.
 *
 * `detectJSAutoLogLines` already receives the magic-line skip set and
 * would not yield those lines, so this guard is the reviewable statement
 * of that precedence rather than the mechanism enforcing it. Mutates
 * `kindByLine` in place, matching the call sites it replaces.
 */
export function markAutoLogLines(
  kindByLine: Record<number, MagicCommentKind>,
  autoLogLines: ReadonlyArray<number>
): void {
  for (const line of autoLogLines) {
    if (!(line in kindByLine)) {
      kindByLine[line] = 'autoLog';
    }
  }
}
