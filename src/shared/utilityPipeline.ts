/**
 * RL-099 Slice 1 — Utility pipeline schema + execution engine.
 *
 * A pipeline is a versioned, named, ordered list of utility steps.
 * Each step references an adapter from `src/shared/utilities/registry.ts`
 * and carries that adapter's options blob. `runPipeline()` executes
 * the steps in order, piping each step's output into the next
 * step's input, with explicit kind-compatibility checks + skip-on-
 * upstream-failure + a `requestIdleCallback` yield between steps so
 * the renderer thread stays responsive.
 *
 * Privacy posture:
 *
 *   - Pipelines persist locally (zustand on
 *     `lingua-utility-pipeline-state`). The step contents + inputs
 *     never leave the device unless the user explicitly exports the
 *     pipeline JSON (which redacts NOTHING — the pipeline shape is
 *     the recipe, not the data) or shares a capsule (Slice 3+).
 *   - Telemetry (`utility.pipeline_executed`) carries only the
 *     bucketed step count + a closed-enum run status. NO utility
 *     ids, NO step options, NO input/output values on the wire.
 *   - Sanitize-on-rehydrate drops invalid entries silently so a
 *     hand-edited localStorage cannot brick the panel.
 *
 * Design landmines documented inline:
 *
 *   1. `PIPELINE_STEP_STATUSES` keeps `'incompatible'` reserved for
 *      Slice 2+ binary/structured adapters. All Slice 1 adapters are
 *      `text → text`; the engine code path is wired but never fires
 *      with the current registry.
 *
 *   2. `parsePipeline()` REJECTS the whole pipeline on shape
 *      mismatch. `parseStep()` is more lenient — it returns `null`
 *      for unknown-utility-id so the persisted-pipeline rehydrate
 *      path can drop orphaned steps gracefully. Document which level
 *      the caller is using before adding new validations.
 *
 *   3. `runPipeline()` uses `Promise.race` for the per-step timeout
 *      (no native abort for adapter promises). Adapters that take
 *      >`STEP_TIMEOUT_MS` ms return `'timeout'`. The pending adapter
 *      promise is left with an attached no-op catch (RL-097 Slice 2
 *      precedent) so a late rejection cannot bubble.
 */

import type { UtilityAdapterId } from './utilities/types';
import { UTILITY_ADAPTER_IDS } from './utilities/types';
import { getAdapter } from './utilities/registry';

// ---------------------------------------------------------------------------
// Caps + closed enums.
// ---------------------------------------------------------------------------

/** Hard cap on persisted pipelines per device (LRU oldest-first eviction). */
export const PIPELINE_CAP = 100;
/** Max steps per pipeline. Soft warning at 20; hard reject at 50. */
export const PIPELINE_MAX_STEPS = 50;
/** Per-step timeout when running. Adapters that take longer settle as `'timeout'`. */
export const STEP_TIMEOUT_MS = 30_000;
/** Yield budget between steps via `requestIdleCallback` / `setTimeout(0)`. */
export const YIELD_BETWEEN_STEPS_MS = 5;
/** UTF-8 byte cap on the chained intermediate values (per step). 256 KiB. */
export const STEP_VALUE_BYTE_CAP = 256 * 1024;

/**
 * Closed enum of per-step outcomes.
 *
 *   - `'ok'`        — adapter ran and returned a value.
 *   - `'error'`     — adapter returned `{ ok: false }` OR threw.
 *   - `'skipped'`   — an upstream step failed; this step never ran.
 *   - `'timeout'`   — adapter exceeded `STEP_TIMEOUT_MS`.
 *   - `'incompatible'` — adapter's `inputKind` doesn't match the
 *                       upstream's `outputKind`. Reserved for Slice 2+.
 *
 * Mirrored on `update-server/src/telemetry.ts` if telemetry later
 * surfaces this enum directly (Slice 1 uses an aggregate
 * `PIPELINE_RUN_STATUSES` instead).
 */
export const PIPELINE_STEP_STATUSES = [
  'ok',
  'error',
  'skipped',
  'timeout',
  'incompatible',
] as const;
export type PipelineStepStatus = (typeof PIPELINE_STEP_STATUSES)[number];

/**
 * Closed enum of aggregate pipeline outcomes for telemetry.
 *
 *   - `'all-ok'`         — every step `'ok'`.
 *   - `'partial'`        — some steps `'ok'`, some not (typical mid-failure).
 *   - `'all-failed'`     — no step ran successfully.
 *   - `'incompatible'`   — engine detected kind mismatch on first step (no run).
 *
 * Mirrored on `update-server/src/telemetry.ts` with parity test.
 */
export const PIPELINE_RUN_STATUSES = [
  'all-ok',
  'partial',
  'all-failed',
  'incompatible',
] as const;
export type PipelineRunStatus = (typeof PIPELINE_RUN_STATUSES)[number];

// ---------------------------------------------------------------------------
// Schema types.
// ---------------------------------------------------------------------------

export interface PipelineStepV1 {
  /** Stable UUID for the step within a pipeline. Survives reorder. */
  id: string;
  /** Adapter id from `UTILITY_ADAPTER_IDS`. */
  utilityId: UtilityAdapterId;
  /** Adapter-specific options blob. Shape validated by the adapter's `parseOptions`. */
  options: Record<string, unknown>;
}

export interface UtilityPipelineV1 {
  version: 1;
  id: string;
  name: string;
  steps: PipelineStepV1[];
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStepResult {
  stepId: string;
  utilityId: UtilityAdapterId;
  status: PipelineStepStatus;
  /** Output value when `status === 'ok'`. Capped at `STEP_VALUE_BYTE_CAP`. */
  output?: string;
  /** Failure detail when `status === 'error' | 'timeout' | 'incompatible'`. */
  errorMessage?: string;
  /** Wall-clock duration in ms (set for every status except `'skipped'`). */
  durationMs: number;
}

export interface PipelineRunOutcome {
  status: PipelineRunStatus;
  results: PipelineStepResult[];
  /** Wall-clock total in ms. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Parsers — defense in depth at the localStorage + import boundary.
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isUtilityAdapterId(value: unknown): value is UtilityAdapterId {
  return (
    typeof value === 'string' && (UTILITY_ADAPTER_IDS as readonly string[]).includes(value)
  );
}

/**
 * Strict step parser. Returns `null` on any shape mismatch including
 * unknown utility id — that branch lets the persisted-pipeline
 * rehydrate path drop orphaned steps gracefully rather than reject
 * the whole pipeline.
 */
export function parsePipelineStep(value: unknown): PipelineStepV1 | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (!isUtilityAdapterId(value.utilityId)) return null;
  if (!isRecord(value.options)) return null;
  // Adapter-level options validation happens lazily in `runPipeline`;
  // the engine falls back to `defaultOptions()` if the blob fails to
  // parse, so an outdated options shape (e.g. dropped key) doesn't
  // brick the whole pipeline.
  return {
    id: value.id,
    utilityId: value.utilityId,
    options: { ...value.options },
  };
}

/**
 * Strict pipeline parser. Returns `null` if the top-level shape is
 * broken; the engine's load path silently drops malformed pipelines
 * from the persisted list. Steps with unknown utility ids are
 * filtered (so a forward-version drift drops the orphans without
 * losing the whole pipeline shell).
 */
export function parsePipeline(value: unknown): UtilityPipelineV1 | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (typeof value.id !== 'string' || value.id.length === 0) return null;
  if (typeof value.name !== 'string') return null;
  if (typeof value.createdAt !== 'string') return null;
  if (typeof value.updatedAt !== 'string') return null;
  if (!Array.isArray(value.steps)) return null;
  if (value.steps.length > PIPELINE_MAX_STEPS) return null;
  const steps: PipelineStepV1[] = [];
  const stepIds = new Set<string>();
  for (const raw of value.steps) {
    const parsed = parsePipelineStep(raw);
    if (parsed !== null) {
      if (stepIds.has(parsed.id)) return null;
      stepIds.add(parsed.id);
      steps.push(parsed);
    }
  }
  return {
    version: 1,
    id: value.id,
    name: value.name,
    steps,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

/**
 * Closed-enum reject reasons for `tryImportPipelineJson`. The
 * renderer maps these onto i18n copy + telemetry buckets.
 */
export const PIPELINE_IMPORT_REJECT_REASONS = [
  'malformed-json',
  'invalid-shape',
  'unknown-utility-id',
  'wrong-version',
  'cap-exceeded',
] as const;
export type PipelineImportRejectReason = (typeof PIPELINE_IMPORT_REJECT_REASONS)[number];

export type PipelineImportOutcome =
  | { ok: true; pipeline: UtilityPipelineV1; warnings: ReadonlyArray<string> }
  | { ok: false; reason: PipelineImportRejectReason; detail?: string };

/**
 * Decode a pasted/dropped pipeline JSON. Strict at the top level
 * (wrong-version is rejected outright). Slice 1 also hard-rejects
 * unknown utility ids so the imported recipe never looks runnable
 * while silently missing a step.
 *
 * `currentPipelineCount` lets the caller short-circuit when the
 * library is already at `PIPELINE_CAP`; the import doesn't run on a
 * device that can't store the result.
 */
export function tryImportPipelineJson(
  json: string,
  currentPipelineCount: number
): PipelineImportOutcome {
  const trimmed = typeof json === 'string' ? json.trim() : '';
  if (trimmed.length === 0) {
    return { ok: false, reason: 'malformed-json', detail: 'empty input' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return {
      ok: false,
      reason: 'malformed-json',
      detail: err instanceof Error ? err.message : 'JSON.parse failed',
    };
  }
  if (!isRecord(parsed)) {
    return { ok: false, reason: 'invalid-shape', detail: 'root is not an object' };
  }
  if (parsed.version !== 1) {
    return {
      ok: false,
      reason: 'wrong-version',
      detail: `version=${String(parsed.version)} — expected 1`,
    };
  }
  // Check for unknown utility ids BEFORE the parser drops them
  // silently on the persisted rehydrate path.
  if (Array.isArray(parsed.steps)) {
    const unknown = new Set<string>();
    for (const step of parsed.steps) {
      if (
        isRecord(step) &&
        typeof step.utilityId === 'string' &&
        !isUtilityAdapterId(step.utilityId)
      ) {
        unknown.add(step.utilityId);
      }
    }
    if (unknown.size > 0) {
      // Slice 1 treats unknown utility ids as a hard reject (the
      // pipeline as designed can't run). A future slice may downgrade
      // this to a warning + drop-the-step.
      return {
        ok: false,
        reason: 'unknown-utility-id',
        detail: [...unknown].slice(0, 5).join(', '),
      };
    }
  }
  if (currentPipelineCount >= PIPELINE_CAP) {
    return { ok: false, reason: 'cap-exceeded' };
  }
  const pipeline = parsePipeline(parsed);
  if (pipeline === null) {
    return { ok: false, reason: 'invalid-shape', detail: 'parsePipeline rejected' };
  }
  return { ok: true, pipeline, warnings: [] };
}

// ---------------------------------------------------------------------------
// Engine.
// ---------------------------------------------------------------------------

export interface RunPipelineOptions {
  /**
   * Streaming callback fired as each step settles. The panel uses
   * this to render per-step results before the whole pipeline
   * completes.
   */
  onStepSettled?: (result: PipelineStepResult) => void;
  /** Test seam — override the per-step timeout. Production passes undefined. */
  stepTimeoutMs?: number;
  /** Test seam — skip the `requestIdleCallback` yield. */
  skipYield?: boolean;
}

interface TimeoutSentinel {
  readonly __utilityPipelineTimeout: true;
}
const TIMEOUT: TimeoutSentinel = { __utilityPipelineTimeout: true };

function isTimeout(value: unknown): value is TimeoutSentinel {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<TimeoutSentinel>).__utilityPipelineTimeout === true
  );
}

/** UTF-8 byte length helper — same shape as the other shared schemas. */
function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

async function yieldToBrowser(skip: boolean): Promise<void> {
  if (skip) return;
  // `requestIdleCallback` ships in Chrome/Edge/Firefox but not Safari
  // < 16 and not in jsdom. Fall back to `setTimeout(0)` cleanly.
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => unknown })
    .requestIdleCallback;
  if (typeof ric === 'function') {
    await new Promise<void>((resolve) => {
      ric(() => resolve());
    });
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, YIELD_BETWEEN_STEPS_MS);
  });
}

function aggregateStatus(results: ReadonlyArray<PipelineStepResult>): PipelineRunStatus {
  if (results.length === 0) return 'all-ok';
  const okCount = results.filter((r) => r.status === 'ok').length;
  const incompat = results.some((r) => r.status === 'incompatible');
  if (okCount === results.length) return 'all-ok';
  if (okCount === 0) {
    return incompat ? 'incompatible' : 'all-failed';
  }
  return 'partial';
}

/**
 * Execute a pipeline. Always settles. Each step's outcome is
 * surfaced via `options.onStepSettled` (if provided) AND on the
 * returned `results` array. Upstream failure cascades as `'skipped'`
 * for every downstream step.
 */
export async function runPipeline(
  pipeline: UtilityPipelineV1,
  input: string,
  options: RunPipelineOptions = {}
): Promise<PipelineRunOutcome> {
  const start = performance.now();
  const results: PipelineStepResult[] = [];
  const stepTimeoutMs = options.stepTimeoutMs ?? STEP_TIMEOUT_MS;
  const skipYield = options.skipYield ?? false;

  let chainedInput = input;
  let upstreamFailed = false;
  let lastOutputKind: 'text' | 'json' | 'binary' = 'text';

  for (let i = 0; i < pipeline.steps.length; i += 1) {
    const step = pipeline.steps[i];
    if (step === undefined) continue;

    if (upstreamFailed) {
      const skipped: PipelineStepResult = {
        stepId: step.id,
        utilityId: step.utilityId,
        status: 'skipped',
        durationMs: 0,
      };
      results.push(skipped);
      options.onStepSettled?.(skipped);
      continue;
    }

    const adapter = getAdapter(step.utilityId);
    if (adapter === undefined) {
      // The adapter is gone (forward-version drift). Mark as error +
      // cascade skips. Slice 2+ can surface this as a structural
      // `'removed'` status; Slice 1 uses `'error'` for simplicity.
      const errored: PipelineStepResult = {
        stepId: step.id,
        utilityId: step.utilityId,
        status: 'error',
        errorMessage: `Adapter "${step.utilityId}" is no longer available`,
        durationMs: 0,
      };
      results.push(errored);
      options.onStepSettled?.(errored);
      upstreamFailed = true;
      continue;
    }

    // Kind compatibility check — reserved for Slice 2+ but the engine
    // wiring is in place. With all Slice 1 adapters at `text → text`
    // this branch never fires; tests cover it via a synthetic adapter.
    if (i > 0 && adapter.inputKind !== lastOutputKind) {
      const incompat: PipelineStepResult = {
        stepId: step.id,
        utilityId: step.utilityId,
        status: 'incompatible',
        errorMessage: `Expected ${adapter.inputKind}; got ${lastOutputKind}`,
        durationMs: 0,
      };
      results.push(incompat);
      options.onStepSettled?.(incompat);
      upstreamFailed = true;
      continue;
    }

    // Defensive UTF-8 byte cap on the chained value. A pathological
    // adapter that grows the value past the cap is surfaced as an
    // error rather than feeding the next step a 1 MiB input.
    if (i > 0 && utf8ByteLength(chainedInput) > STEP_VALUE_BYTE_CAP) {
      const tooLarge: PipelineStepResult = {
        stepId: step.id,
        utilityId: step.utilityId,
        status: 'error',
        errorMessage: `Upstream output exceeded ${STEP_VALUE_BYTE_CAP} bytes`,
        durationMs: 0,
      };
      results.push(tooLarge);
      options.onStepSettled?.(tooLarge);
      upstreamFailed = true;
      continue;
    }

    if (i > 0) await yieldToBrowser(skipYield);

    const parsedOptions = adapter.parseOptions(step.options) ?? adapter.defaultOptions();
    const stepStart = performance.now();
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<TimeoutSentinel>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(TIMEOUT), stepTimeoutMs);
    });

    let outcome: PipelineStepResult;
    try {
      const adapterPromise = adapter.run(chainedInput, parsedOptions);
      // RL-097 Slice 2 HIGH-2 precedent — defensive no-op catch on
      // the pending adapter promise. If timeout wins the race, the
      // adapter may still reject later; we don't want that to bubble
      // as an unhandledRejection.
      void adapterPromise.catch(() => {
        /* swallow late rejection after timeout wins race */
      });
      const raced = await Promise.race([adapterPromise, timeoutPromise]);
      if (isTimeout(raced)) {
        outcome = {
          stepId: step.id,
          utilityId: step.utilityId,
          status: 'timeout',
          errorMessage: `Step exceeded ${stepTimeoutMs} ms`,
          durationMs: Math.round(performance.now() - stepStart),
        };
        upstreamFailed = true;
      } else if (raced.ok) {
        const durationMs = Math.round(performance.now() - stepStart);
        if (utf8ByteLength(raced.value) > STEP_VALUE_BYTE_CAP) {
          outcome = {
            stepId: step.id,
            utilityId: step.utilityId,
            status: 'error',
            errorMessage: `Step output exceeded ${STEP_VALUE_BYTE_CAP} bytes`,
            durationMs,
          };
          upstreamFailed = true;
        } else {
          outcome = {
            stepId: step.id,
            utilityId: step.utilityId,
            status: 'ok',
            output: raced.value,
            durationMs,
          };
          chainedInput = raced.value;
          lastOutputKind = adapter.outputKind;
        }
      } else {
        outcome = {
          stepId: step.id,
          utilityId: step.utilityId,
          status: 'error',
          errorMessage: raced.detail ?? raced.reason,
          durationMs: Math.round(performance.now() - stepStart),
        };
        upstreamFailed = true;
      }
    } catch (err) {
      outcome = {
        stepId: step.id,
        utilityId: step.utilityId,
        status: 'error',
        errorMessage: err instanceof Error ? err.message : String(err ?? 'adapter threw'),
        durationMs: Math.round(performance.now() - stepStart),
      };
      upstreamFailed = true;
    } finally {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    }

    results.push(outcome);
    options.onStepSettled?.(outcome);
  }

  return {
    status: aggregateStatus(results),
    results,
    durationMs: Math.round(performance.now() - start),
  };
}

// ---------------------------------------------------------------------------
// Helpers exported for the renderer + tests.
// ---------------------------------------------------------------------------

/** Build a fresh, empty pipeline with sensible defaults. */
export function createBlankPipeline(options: {
  id: string;
  name?: string;
  now?: string;
}): UtilityPipelineV1 {
  const now = options.now ?? new Date().toISOString();
  return {
    version: 1,
    id: options.id,
    name: options.name ?? '',
    steps: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Build a new step for an adapter. The renderer's "Add step" button
 * calls this with the user-picked utility id.
 */
export function createBlankStep(options: {
  id: string;
  utilityId: UtilityAdapterId;
}): PipelineStepV1 {
  const adapter = getAdapter(options.utilityId);
  return {
    id: options.id,
    utilityId: options.utilityId,
    options: adapter ? (adapter.defaultOptions() as Record<string, unknown>) : {},
  };
}

/** Bucketed step count for telemetry. Matches `DEPENDENCY_COUNT_BUCKETS`. */
export function bucketStepCount(count: number): '0' | '1' | '2-5' | '6-10' | '>10' {
  if (count <= 0) return '0';
  if (count === 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 10) return '6-10';
  return '>10';
}
