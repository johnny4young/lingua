/**
 * Lightweight Git workflow directives.
 *
 * These checks run from always-mounted Git hooks and tab chrome, so they stay
 * independent from the heavier magic-comment transformation engine used only
 * by editor providers and execution. Both directives intentionally accept any
 * language with `//` or `#` comments.
 *
 * The regexes can match inside string literals. That over-suppression trade-off
 * is acceptable because both directives only mute renderer affordances; they
 * never change repository contents or Git operations.
 */

const GIT_IGNORE_STATUS_DIRECTIVE_RE =
  /(?:\/\/|#)\s*@git-ignore-status\b/i;

export function gitStatusSuppressedByMagicComment(
  language: string,
  code: string
): boolean {
  if (typeof language !== 'string' || language.length === 0) return false;
  if (typeof code !== 'string' || code.length === 0) return false;
  return GIT_IGNORE_STATUS_DIRECTIVE_RE.test(code);
}

const GIT_WATCH_HEAD_OFF_DIRECTIVE_RE =
  /(?:\/\/|#)\s*@git-watch-head\s*:?\s*off\b/i;

export function gitWatchHeadSuppressedByMagicComment(
  language: string,
  code: string
): boolean {
  if (typeof language !== 'string' || language.length === 0) return false;
  if (typeof code !== 'string' || code.length === 0) return false;
  return GIT_WATCH_HEAD_OFF_DIRECTIVE_RE.test(code);
}
