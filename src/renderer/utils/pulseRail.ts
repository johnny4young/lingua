import type { RunState } from '../components/ui/runState';

/** A run-rail line state; `reached` is a lit line without a tick. Stale is a class on the host, not a line state. */
type PulseRailState = Exclude<RunState, 'stale'> | 'reached';

export interface PulseRailLine {
  line: number;
  state: PulseRailState;
  /** Travel slot of a lit line, 0 at the top; null for lines the pulse never reaches. */
  slot: number | null;
}

export interface PulseRailInput {
  lines: readonly string[];
  /** Lines the run reached: timeline step lines in order, or the lines that answered. */
  executed: readonly number[];
  /** True when `executed` lists every step the run took, so unlisted code did not run. */
  complete: boolean;
  /** Where the run stopped: the selected timeline step, the paused line, or the line that threw. */
  frontier: { line: number; kind: 'running' | 'paused' | 'raised' } | null;
  /** The run reached the end of the code it was given. */
  finished: boolean;
  /** The lines the run was given, for a region run; the whole file otherwise. */
  span?: { start: number; end: number };
  /** Last line of the statement starting on a line, so a statement's later lines read as run with it. */
  statementEnd?: (line: number) => number;
}

export const PULSE_RAIL_SLOTS = 12;
/** Pixels the rail adds to the lines-decorations margin. */
export const PULSE_RAIL_WIDTH = 22;

/** Blank lines, comments and closing brackets run nothing on their own, so they never carry a tick. */
const QUIET_LINE = /^\s*(?:(?:\/\/|#|\/\*|\*(?=\s|\/|$)).*|[\]})>;,]*)$/;

/** A line that opens a block: ends in an opening bracket, or a colon as in Python. */
const OPENS_BLOCK = /[{([:]\s*(?:\/\/.*|#.*)?$/;

export function isQuietRailLine(text: string): boolean {
  return QUIET_LINE.test(text);
}

/**
 * Lays the run out on the rail: a tick where a line ran, a solid rail through
 * quiet lines between them, dots where code did not run, and the frontier's
 * mark. A run with no line to show draws nothing.
 */
export function buildPulseRail(input: PulseRailInput): PulseRailLine[] {
  const { lines, frontier, complete, finished } = input;
  const start = Math.max(1, input.span?.start ?? 1);
  let end = Math.min(lines.length, input.span?.end ?? lines.length);
  while (end >= start && lines[end - 1]!.trim() === '') end -= 1;
  const inSpan = (line: number) => Number.isInteger(line) && line >= start && line <= end;

  const front = frontier && inSpan(frontier.line) ? frontier : null;
  // A line that answered ran, wherever the run stopped; only steps after a selected one have not happened yet.
  const ran = new Set(
    input.executed.filter(line => inSpan(line) && (complete || front?.kind !== 'running' || line <= front.line))
  );
  if (ran.size === 0 && !front) return [];

  const quiet = (line: number) => isQuietRailLine(lines[line - 1]!);
  // Indexed by line - start.
  const states: PulseRailState[] = new Array(end - start + 1);
  if (complete) {
    // Steps say exactly what ran; a gap between two of them is lit only when nothing in it could run.
    // A step's later lines, when its statement spans several, ran with it.
    const continued = new Set<number>();
    const { statementEnd } = input;
    if (statementEnd) {
      for (const line of ran) {
        for (let next = line + 1; next <= Math.min(end, statementEnd(line)); next += 1) continued.add(next);
      }
    }
    const anchors = [...ran, ...(front ? [front.line] : [])].sort((a, b) => a - b);
    let previous = start - 1;
    for (const anchor of [...anchors, end + 1]) {
      let lit = anchor <= end;
      for (let line = previous + 1; lit && line < anchor; line += 1) lit = quiet(line) || continued.has(line);
      // The header of a block whose body ran, such as a called function, ran too.
      let opened = anchor;
      for (let line = anchor - 1; anchor <= end && line > previous; line -= 1) {
        if (OPENS_BLOCK.test(lines[line - 1]!)) opened = line;
        else if (!quiet(line)) break;
      }
      for (let line = previous + 1; line < anchor; line += 1) {
        states[line - start] = lit || line >= opened || continued.has(line) ? 'reached' : 'not-run';
      }
      previous = anchor;
    }
  } else {
    // Only answers are known: everything above the frontier ran, and below it only when the run finished.
    let reachedTo = front ? front.line - 1 : finished ? end : start - 1;
    for (const line of ran) reachedTo = Math.max(reachedTo, line);
    for (let line = start; line <= end; line += 1) states[line - start] = line <= reachedTo ? 'reached' : 'not-run';
  }
  for (const line of ran) states[line - start] = quiet(line) ? 'reached' : 'answered';
  if (front) states[front.line - start] = front.kind;

  let top = -1;
  let bottom = -1;
  states.forEach((state, index) => {
    if (state === 'not-run') return;
    if (top < 0) top = index;
    bottom = index;
  });
  const span = Math.max(1, bottom - top);
  return states.map((state, index) => ({
    line: index + start,
    state,
    slot: state === 'not-run' ? null : Math.round(((index - top) / span) * (PULSE_RAIL_SLOTS - 1)),
  }));
}
