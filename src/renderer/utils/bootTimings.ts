import {
  BOOT_PHASES,
  bucketBootDuration,
  type BootPhase,
} from '../../shared/telemetry';

const BOOT_MARK_PREFIX = 'lingua:boot';
type BootMark = 'start' | BootPhase;

export interface BootPhaseTiming {
  phase: BootPhase;
  durationMs: number;
}

export interface BootTimingSnapshot {
  version: 1;
  totalDurationMs: number;
  phases: BootPhaseTiming[];
}

const marks = new Map<BootMark, number>();
let telemetryReported = false;

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : 0;
}

function devtoolsMark(name: BootMark): void {
  if (typeof performance === 'undefined' || typeof performance.mark !== 'function') return;
  try {
    performance.mark(`${BOOT_MARK_PREFIX}:${name}`);
  } catch {
    // Performance APIs are diagnostics only and must never block boot.
  }
}

function existingDevtoolsMarkTime(name: BootMark): number | null {
  if (
    typeof performance === 'undefined' ||
    typeof performance.getEntriesByName !== 'function'
  ) {
    return null;
  }
  try {
    const entries = performance.getEntriesByName(
      `${BOOT_MARK_PREFIX}:${name}`,
      'mark'
    );
    return entries[0]?.startTime ?? null;
  } catch {
    return null;
  }
}

export function startBootTiming(): void {
  if (marks.has('start')) return;
  const documentStart = existingDevtoolsMarkTime('start');
  if (documentStart !== null) {
    marks.set('start', documentStart);
    return;
  }
  marks.set('start', now());
  devtoolsMark('start');
}

export function markBootPhase(phase: BootPhase): void {
  if (marks.has(phase)) return;
  startBootTiming();
  const phaseIndex = BOOT_PHASES.indexOf(phase);
  const previous: BootMark = phaseIndex > 0 ? BOOT_PHASES[phaseIndex - 1]! : 'start';
  if (!marks.has(previous)) return;

  marks.set(phase, now());
  devtoolsMark(phase);
  if (typeof performance?.measure === 'function') {
    try {
      performance.measure(
        `${BOOT_MARK_PREFIX}:phase:${phase}`,
        `${BOOT_MARK_PREFIX}:${previous}`,
        `${BOOT_MARK_PREFIX}:${phase}`
      );
    } catch {
      // Older/test Performance implementations may not retain named marks.
    }
  }
}

export function getBootTimings(): BootTimingSnapshot {
  const start = marks.get('start') ?? 0;
  const phases = BOOT_PHASES.flatMap<BootPhaseTiming>((phase, index) => {
    const end = marks.get(phase);
    const previousMark: BootMark = index === 0 ? 'start' : BOOT_PHASES[index - 1]!;
    const previous = marks.get(previousMark);
    if (end === undefined || previous === undefined) return [];
    return [{ phase, durationMs: Math.max(0, Math.round((end - previous) * 100) / 100) }];
  });
  const last = marks.get(BOOT_PHASES[BOOT_PHASES.length - 1]!) ?? start;
  return {
    version: 1,
    totalDurationMs: Math.max(0, Math.round((last - start) * 100) / 100),
    phases,
  };
}

/** Mark the final phase and emit only closed phase/duration buckets. */
export function finishBootTiming(): void {
  markBootPhase('rehydration');
  if (telemetryReported || !marks.has('rehydration')) return;
  telemetryReported = true;
  const snapshot = getBootTimings();
  void import('./telemetry').then(({ trackEvent }) => {
    for (const timing of snapshot.phases) {
      void trackEvent('app.boot_phase', {
        phase: timing.phase,
        durationBucket: bucketBootDuration(timing.durationMs),
      });
    }
  });
}

export async function copyBootTimingsToClipboard(
  writer?: (text: string) => Promise<void>
): Promise<boolean> {
  // Resolve the clipboard lazily inside the body: a default-parameter
  // expression touching a bare `navigator` throws ReferenceError in
  // non-browser callers (unit tests, SSR-like tooling) before the guard
  // below could ever run.
  const resolvedWriter =
    writer ??
    (typeof navigator !== 'undefined'
      ? navigator.clipboard?.writeText?.bind(navigator.clipboard)
      : undefined);
  if (!resolvedWriter) return false;
  await resolvedWriter(`${JSON.stringify(getBootTimings(), null, 2)}\n`);
  return true;
}

/** Test-only reset for deterministic phase timing coverage. */
export function resetBootTimingsForTesting(): void {
  marks.clear();
  telemetryReported = false;
  if (typeof performance === 'undefined') return;
  try {
    for (const mark of ['start', ...BOOT_PHASES] satisfies BootMark[]) {
      performance.clearMarks?.(`${BOOT_MARK_PREFIX}:${mark}`);
      performance.clearMeasures?.(`${BOOT_MARK_PREFIX}:phase:${mark}`);
    }
  } catch {
    // Test diagnostics must stay harmless in partial Performance shims.
  }
}

// Importing this tiny module from the entrypoint establishes the earliest
// renderer-owned mark before settings/i18n/bootstrap work begins.
startBootTiming();
