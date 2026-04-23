/**
 * RL-071 — Diff viewer helper.
 *
 * Pure, offline, renderer-side. Ships Myers O((N+M)·D) diff over three
 * tokenization strategies: lines, word-aware segments, and characters
 * (grapheme clusters). Every emitter returns a `DiffSegment[]` where
 * adjacent same-kind segments are merged so consumers render runs, not
 * a firehose of single-token edits.
 *
 * Myers-diff reference: "An O(ND) Difference Algorithm and Its Variations"
 * Eugene W. Myers, 1986. We use the forward D-path variant with explicit
 * path reconstruction (the straightforward one, not the divide-and-conquer
 * refinement) — enough for the inputs this panel realistically handles.
 */

export type DiffKind = 'equal' | 'add' | 'remove';

export interface DiffSegment {
  kind: DiffKind;
  text: string;
}

/** Grain of the diff. Callers pick it from the panel selector. */
export type DiffGranularity = 'line' | 'word' | 'character';

/** Maximum input we accept per side before refusing to allocate arrays. */
export const DIFF_MAX_INPUT_CHARS = 40_000;

/**
 * Fold three tokenizers into a single entry point. `granularity` decides
 * how both sides are tokenized; the output is always `DiffSegment[]` with
 * adjacent runs of the same kind merged.
 */
export function computeDiff(
  left: string,
  right: string,
  granularity: DiffGranularity
): DiffSegment[] {
  if (granularity === 'line') return diffLines(left, right);
  if (granularity === 'word') return diffWords(left, right);
  return diffChars(left, right);
}

export function diffLines(left: string, right: string): DiffSegment[] {
  const leftTokens = tokenizeLines(clamp(left));
  const rightTokens = tokenizeLines(clamp(right));
  // Line mode intentionally keeps one segment per original line so the
  // summary counts reflect "lines added / removed" and the renderer can
  // emit one row per segment. Merging would fuse unrelated neighboring
  // lines into a single run.
  return myersSegments(leftTokens, rightTokens, identity);
}

export function diffWords(left: string, right: string): DiffSegment[] {
  const leftTokens = tokenizeWords(clamp(left));
  const rightTokens = tokenizeWords(clamp(right));
  return mergeRuns(myersSegments(leftTokens, rightTokens, identity));
}

export function diffChars(left: string, right: string): DiffSegment[] {
  const leftTokens = tokenizeChars(clamp(left));
  const rightTokens = tokenizeChars(clamp(right));
  return mergeRuns(myersSegments(leftTokens, rightTokens, identity));
}

/** Aggregated counts — handy for the UI summary strip. */
export function summarizeDiff(segments: readonly DiffSegment[]): {
  add: number;
  remove: number;
  equal: number;
} {
  let add = 0;
  let remove = 0;
  let equal = 0;
  for (const segment of segments) {
    if (segment.kind === 'add') add += 1;
    else if (segment.kind === 'remove') remove += 1;
    else equal += 1;
  }
  return { add, remove, equal };
}

// ---------------------------------------------------------------------------
// Tokenizers
// ---------------------------------------------------------------------------

function clamp(input: string): string {
  return input.length > DIFF_MAX_INPUT_CHARS ? input.slice(0, DIFF_MAX_INPUT_CHARS) : input;
}

/**
 * Line tokens are bare lines (without the trailing `\n`). That matches the
 * legacy behavior of `developerUtilities.computeLineDiff` and keeps the
 * summary counts line-oriented: "line three" and "line three\n" are the
 * same logical line regardless of whether the file ends with a newline.
 */
function tokenizeLines(input: string): string[] {
  if (input === '') return [];
  return input.split('\n');
}

/**
 * Word tokens preserve whitespace runs as their own tokens so the output
 * can be rendered inline without reconstructing spacing from thin air.
 * Grouping rule: consecutive ASCII word chars are one token; anything else
 * (whitespace, punctuation, emoji, CJK) is emitted per-grapheme so small
 * edits stay local.
 */
function tokenizeWords(input: string): string[] {
  const tokens: string[] = [];
  const chars = Array.from(input);
  let buffer = '';
  let wordBufferIsAlnum = false;

  const isAlnum = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);
  const flush = () => {
    if (buffer.length > 0) {
      tokens.push(buffer);
      buffer = '';
    }
  };

  for (const ch of chars) {
    const alnum = isAlnum(ch);
    if (alnum && (buffer.length === 0 || wordBufferIsAlnum)) {
      buffer += ch;
      wordBufferIsAlnum = true;
      continue;
    }
    // Character boundary — flush whatever we had and emit the non-word
    // grapheme as its own token so single-char punctuation edits stay local.
    flush();
    tokens.push(ch);
    wordBufferIsAlnum = false;
  }
  flush();
  return tokens;
}

/** Character tokens iterate by grapheme code point (handles surrogate pairs). */
function tokenizeChars(input: string): string[] {
  return Array.from(input);
}

function identity(token: string): string {
  return token;
}

// ---------------------------------------------------------------------------
// Myers diff
// ---------------------------------------------------------------------------

/**
 * Standard O((N+M)·D) forward Myers diff with path reconstruction. Returns
 * a flat list of one-token DiffSegments; `mergeRuns` collapses adjacent
 * same-kind segments afterwards.
 *
 * We record every (k, x) visited per D so the traceback can reconstruct
 * the path. This keeps the code straightforward at the cost of O(N·D)
 * memory — fine for the clamped inputs this module accepts.
 */
function myersSegments(
  left: readonly string[],
  right: readonly string[],
  toText: (token: string) => string
): DiffSegment[] {
  const n = left.length;
  const m = right.length;

  // Fast paths — Myers is overkill for these cases.
  if (n === 0 && m === 0) return [];
  if (n === 0) return right.map((token) => ({ kind: 'add', text: toText(token) } as const));
  if (m === 0) return left.map((token) => ({ kind: 'remove', text: toText(token) } as const));

  const max = n + m;
  const vSize = 2 * max + 1;
  const offset = max;
  const v = new Int32Array(vSize);
  const trace: Int32Array[] = [];

  let foundD = -1;
  outer: for (let d = 0; d <= max; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      const kIndex = k + offset;
      let x: number;
      if (k === -d || (k !== d && v[kIndex - 1]! < v[kIndex + 1]!)) {
        x = v[kIndex + 1]!;
      } else {
        x = v[kIndex - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && left[x] === right[y]) {
        x += 1;
        y += 1;
      }
      v[kIndex] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice());
        foundD = d;
        break outer;
      }
    }
    trace.push(v.slice());
  }

  if (foundD < 0) {
    // Defensive fallback: treat as full rewrite. Should be unreachable —
    // Myers always terminates within `max` D-iterations.
    return [
      ...left.map((token) => ({ kind: 'remove', text: toText(token) } as const)),
      ...right.map((token) => ({ kind: 'add', text: toText(token) } as const)),
    ];
  }

  // Trace back from (n, m) to (0, 0).
  const path: { x: number; y: number }[] = [];
  let x = n;
  let y = m;
  for (let d = foundD; d > 0; d -= 1) {
    const vPrev = trace[d - 1]!;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vPrev[k - 1 + offset]! < vPrev[k + 1 + offset]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vPrev[prevK + offset]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      path.push({ x: x - 1, y: y - 1 });
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      path.push({ x: prevX, y: prevY });
      x = prevX;
      y = prevY;
    }
  }
  while (x > 0 && y > 0) {
    path.push({ x: x - 1, y: y - 1 });
    x -= 1;
    y -= 1;
  }

  // Walk from the start, emitting equal/remove/add segments.
  const segments: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  const steps = path.slice().reverse();
  for (const step of steps) {
    while (i < step.x && j < step.y && left[i] !== right[j]) {
      // should not happen with valid Myers path
      break;
    }
    while (i < step.x) {
      segments.push({ kind: 'remove', text: toText(left[i]!) });
      i += 1;
    }
    while (j < step.y) {
      segments.push({ kind: 'add', text: toText(right[j]!) });
      j += 1;
    }
    if (i === step.x && j === step.y && i < n && j < m && left[i] === right[j]) {
      segments.push({ kind: 'equal', text: toText(left[i]!) });
      i += 1;
      j += 1;
    }
  }
  while (i < n) {
    segments.push({ kind: 'remove', text: toText(left[i]!) });
    i += 1;
  }
  while (j < m) {
    segments.push({ kind: 'add', text: toText(right[j]!) });
    j += 1;
  }

  return segments;
}

/**
 * Collapse adjacent segments of the same kind. We emit one segment per
 * token during Myers for simplicity; the UI cares about runs.
 */
function mergeRuns(segments: readonly DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && last.kind === segment.kind) {
      last.text += segment.text;
    } else {
      merged.push({ kind: segment.kind, text: segment.text });
    }
  }
  return merged;
}
