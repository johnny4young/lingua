/**
 * implementation — pure capsule comparison model.
 *
 * Mirrors the `ExecutionComparisonModal` precedent  but
 * over two `RunCapsuleV1` records instead of two execution-history
 * snapshots. The model is pure (no React, no side effects) so the modal
 * stays presentational and the math is unit-testable in isolation.
 *
 * Three section diffs are computed line-by-line via `diffLines` (reused
 * from `utils/diff.ts` — we never roll our own differ):
 *
 *   - `codeDiff`   — `source.content` older vs. newer.
 *   - `inputDiff`  — `input.stdin ?? ''` older vs. newer.
 *   - `outputDiff` — the run output. Decision: we COMBINE stdout + stderr
 *     into one text per side (`stdout`, then `'\n' + stderr` when stderr
 *     is present) and diff the combined string, rather than keeping two
 *     separate `stdoutDiff` / `stderrDiff` sections. Rationale: it
 *     mirrors the single "Output" pane the modal renders, keeps the
 *     section tab bar to a clean three (Code | Input | Output), and
 *     matches how a developer reads a run — stdout and stderr interleave
 *     conceptually as "what the program emitted". A capsule whose only
 *     difference is stderr still surfaces a non-empty output diff.
 *
 * Two independent caps protect the renderer:
 *
 *   - The CHAR clamp lives in `diff.ts` (`DIFF_MAX_INPUT_CHARS`, 40k per
 *     side). We surface a per-section `*Clamped` flag when EITHER side of
 *     that section exceeded the limit, exactly like the modal's `clamped`
 *     check. This is about the differ refusing to allocate over huge
 *     inputs.
 *   - The LINE cap (`MAX_DIFF_LINES`, this module) is a separate
 *     rendered-segment ceiling: we slice each section's `DiffSegment[]`
 *     to the first `MAX_DIFF_LINES` segments and report `*OmittedLines`
 *     (the count beyond the cap) so the modal can show a localized
 *     "+N more lines". The two caps are orthogonal: a side under 40k
 *     chars can still produce more than `MAX_DIFF_LINES` diff segments
 *     (line mode emits one segment per line), and a side over 40k chars
 *     is clamped BEFORE diffing so its segment count is already bounded.
 */

import {
  diffLines,
  summarizeDiff,
  DIFF_MAX_INPUT_CHARS,
  type DiffSegment,
} from '../../utils/diff';
import type { RunCapsuleStatus, RunCapsuleV1 } from '../../../shared/runCapsule';

/**
 * Maximum number of rendered diff segments we hand the modal per section.
 * Line mode emits one segment per line, so this is effectively a
 * "max diff lines" ceiling. Beyond it we report the overflow as
 * `*OmittedLines` and let the modal surface a localized "+N more lines".
 */
export const MAX_DIFF_LINES = 400;

/**
 * Flat, render-ready summary of one capsule side. Pulled from
 * `tab` / `result` / `environment`; git fields are optional (absent on
 * web builds, detached HEAD, or when the gitStore posture was
 * unavailable at capture time — see `RunCapsuleEnvironment.git`).
 */
export interface CapsuleComparisonSide {
  language: string;
  runtimeMode: string;
  workflowMode: string;
  status: RunCapsuleStatus;
  durationMs: number;
  platform: 'web' | 'desktop';
  runner: string;
  gitBranch?: string;
  gitCommit?: string;
}

/** One section's diff plus its caps, ready for the modal. */
export interface CapsuleComparisonSection {
  /** The two raw texts so the modal can render Older | Newer panes. */
  olderText: string;
  newerText: string;
  /** Line-by-line diff, already clamped to `MAX_DIFF_LINES` segments. */
  diff: DiffSegment[];
  /** Segments dropped by the line cap (0 when nothing was dropped). */
  omittedLines: number;
  /** True when EITHER side exceeded `DIFF_MAX_INPUT_CHARS` (char clamp). */
  clamped: boolean;
  /** True when both sides are empty — the modal empty-states the tab. */
  empty: boolean;
}

/**
 * The full comparison model. `compareRunCapsules` produces this once;
 * `CapsuleComparisonModal` renders it without any further logic.
 */
export interface CapsuleComparison {
  /** `older.tab.language === newer.tab.language`. */
  sameLanguage: boolean;
  older: CapsuleComparisonSide;
  newer: CapsuleComparisonSide;
  codeDiff: CapsuleComparisonSection;
  inputDiff: CapsuleComparisonSection;
  outputDiff: CapsuleComparisonSection;
  /**
   * True when code + input + output diffs all have zero adds and zero
   * removes (the modal collapses to the identical message). The summary
   * strip — including the environment deltas — still renders.
   */
  contentIdentical: boolean;
}

/** Combine stdout + stderr into one render text. See file-level comment. */
function combineOutput(result: RunCapsuleV1['result']): string {
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  if (stderr === '') return stdout;
  if (stdout === '') return stderr;
  return `${stdout}\n${stderr}`;
}

function buildSide(capsule: RunCapsuleV1): CapsuleComparisonSide {
  return {
    language: capsule.tab.language,
    runtimeMode: capsule.tab.runtimeMode,
    workflowMode: capsule.tab.workflowMode,
    status: capsule.result.status,
    durationMs: capsule.result.durationMs,
    platform: capsule.environment.platform,
    runner: capsule.environment.runner,
    gitBranch: capsule.environment.git?.branch,
    gitCommit: capsule.environment.git?.commit,
  };
}

/**
 * Diff one section and apply both caps. `olderText` / `newerText` are
 * the raw strings (kept for the side-by-side panes); `diff` is the
 * line-by-line segment list sliced to `MAX_DIFF_LINES`.
 */
function buildSection(olderText: string, newerText: string): CapsuleComparisonSection {
  const full = diffLines(olderText, newerText);
  const omittedLines = Math.max(0, full.length - MAX_DIFF_LINES);
  const diff = omittedLines > 0 ? full.slice(0, MAX_DIFF_LINES) : full;
  const clamped =
    olderText.length > DIFF_MAX_INPUT_CHARS ||
    newerText.length > DIFF_MAX_INPUT_CHARS;
  return {
    olderText,
    newerText,
    diff,
    omittedLines,
    clamped,
    empty: olderText === '' && newerText === '',
  };
}

/**
 * Compute the comparison model for two capsules. `older` and `newer`
 * are sorted oldest → newest by the caller (the overlay's
 * `compareCapsuleEntries`), so the older capsule renders on the left.
 *
 * `contentIdentical` is decided by EXACT string equality first (so a pair
 * differing only past the `MAX_DIFF_LINES` line cap OR past the
 * `DIFF_MAX_INPUT_CHARS` char clamp is still correctly reported as
 * non-identical — the differ can't see past either cap, but string compare
 * can), falling back to the line diff only for unclamped, non-equal texts.
 */
export function compareRunCapsules(
  older: RunCapsuleV1,
  newer: RunCapsuleV1
): CapsuleComparison {
  const codeDiff = buildSection(older.source.content, newer.source.content);
  const inputDiff = buildSection(older.input.stdin ?? '', newer.input.stdin ?? '');
  const outputDiff = buildSection(
    combineOutput(older.result),
    combineOutput(newer.result)
  );

  const sectionIsIdentical = (section: CapsuleComparisonSection): boolean => {
    // Exact string equality first — it is the ONLY correct identity check
    // for char-CLAMPED sections. `diffLines` clamps both sides to
    // DIFF_MAX_INPUT_CHARS (40k) before running Myers, so two texts that
    // match in the first 40k chars but differ afterwards would diff to zero
    // adds/removes and falsely report "identical" (stdout/stderr cap at
    // 1 MiB, so this is reachable). String compare sees the whole string.
    if (section.olderText === section.newerText) return true;
    // Strings differ AND a side exceeded the diff clamp: the differ can't
    // see past 40k, so we cannot trust its zero-delta — they are not
    // identical (they already differ somewhere).
    if (section.clamped) return false;
    // Unclamped + non-equal: trust the line diff. Re-diff the raw text when
    // the rendered segments were line-capped so the count is complete.
    const segments =
      section.omittedLines > 0
        ? diffLines(section.olderText, section.newerText)
        : section.diff;
    const summary = summarizeDiff(segments);
    return summary.add === 0 && summary.remove === 0;
  };

  const contentIdentical =
    sectionIsIdentical(codeDiff) &&
    sectionIsIdentical(inputDiff) &&
    sectionIsIdentical(outputDiff);

  return {
    sameLanguage: older.tab.language === newer.tab.language,
    older: buildSide(older),
    newer: buildSide(newer),
    codeDiff,
    inputDiff,
    outputDiff,
    contentIdentical,
  };
}
