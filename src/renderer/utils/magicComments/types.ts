/**
 * Shared magic-comment vocabulary: the three syntactic variants, the
 * rich-output directive words, and the per-line record every detector
 * emits. Kept dependency-free so both the JS and the Python detector can
 * import it without pulling the other language's scanner along.
 */

export type MagicCommentKind = 'arrow' | 'watch' | 'autoLog';

/**
 * implementation / 2b — rich-output directives surfaced on an arrow
 * magic comment. `table`, `chart`, `image`, and `html` are all live
 * across JS / TS / Python; runner-side payload conversion consumes the
 * canonical directive name.
 *
 * Usage:
 *   `myArray //=> table` → renderer upgrades the inline pill from
 *   the stringified array to a `Table(N×M)` summary backed by a
 *   typed `RichOutputPayload` on the resulting `MagicCommentResult`.
 *
 * `undefined` means the arrow had no directive — legacy behavior.
 */
export type MagicCommentDirective = 'table' | 'chart' | 'image' | 'html';

export interface MagicCommentLine {
  /** 1-based line number in the original source */
  line: number;
  /** The expression text the runner should evaluate */
  expression: string;
  /**
   * implementation — which magic-comment syntactic variant produced
   * this entry. Arrow is the legacy `//=>` shape; watch is the new
   * `// @watch <expr>` pin.
   */
  kind: MagicCommentKind;
  /**
   * Line text that should still execute alongside the magic-comment
   * call. Empty for arrow lines (the prefix IS the expression);
   * non-empty for watch lines so a declaration like
   * `const x = 5; // @watch x` keeps `const x = 5;` running.
   */
  preserve: string;
  /**
   * implementation — optional rich-output directive parsed from
   * the comment tail (`//=> table`). The runner consumes this to
   * decide whether to upgrade the captured value to a typed
   * `RichOutputPayload`. Only set when `kind === 'arrow'` AND the
   * directive word is recognised; unknown directives silently
   * fall through to the legacy arrow path so a typo never breaks
   * a run.
   */
  directive?: MagicCommentDirective;
}
