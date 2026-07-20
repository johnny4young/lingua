/**
 * implementation — Build a `RunCapsuleV1` from a utility-pipeline run.
 *
 * Mirrors `httpResponseCapsule.ts`: a pipeline run is wrapped in the
 * same wire format every other Lingua run uses (script execution, HTTP
 * responses, future SQL queries) so share-links, CLI replay, AI prompt
 * inclusion, the Pro capsule browse overlay, and the internal side-by-side
 * comparator ALL handle a pipeline run through the same redaction + size
 * + version-migration machinery without special-casing the pipeline path.
 *
 * Mapping rules:
 *
 *   - `tab.language = 'pipeline'` — distinguishes pipeline capsules from
 *     `'javascript'` / `'http'` / etc. so the consumer can render them
 *     with the right surface (see `languageMeta.ts` for the friendly
 *     "Pipeline" label, implementation note).
 *   - `tab.runtimeMode = 'utility-pipeline'` + `environment.runner =
 *     'utility-pipeline'` — reserved literals the existing capsule shape
 *     allows.
 *   - `source.content` (implementation note) carries the RECIPE ONLY — never the input
 *     data. A deterministic header line plus one line per step
 *     (`#<n> <utilityId> <options JSON>`). The content-hash on that
 *     string lets the consumer dedup repeats; two runs of the same
 *     recipe produce the same hash regardless of input.
 *   - `input.stdin` carries the pipeline input string so the existing
 *     capsule sanitiser's stdin handling applies uniformly.
 *   - `result.status` maps the aggregate `PipelineRunStatus` to the
 *     capsule outcome: `'all-ok'` → `'success'`; `'partial'` /
 *     `'all-failed'` / `'incompatible'` → `'error'`.
 *   - `result.stdout` carries the FINAL output — the last `'ok'` step's
 *     output (the pipeline's effective result).
 *   - `result.stderr` (implementation note) carries a compact failed-step summary.
 *   - `result.durationMs` mirrors the run's total duration.
 *
 * The existing capsule sanitiser (`sanitizeRunCapsule`) handles
 * defense-in-depth redaction so the EXPORTED capsule never carries
 * secrets even if the renderer somehow recorded them.
 */

import {
  buildRunCapsule,
  type RunCapsuleStatus,
  type RunCapsuleV1,
} from '../../shared/runCapsule';
import type {
  PipelineRunOutcome,
  PipelineRunStatus,
  PipelineStepV1,
} from '../../shared/utilityPipeline';

/**
 * Map the aggregate pipeline status to the capsule status enum. Only a
 * fully-`'all-ok'` run is a `'success'`; every other aggregate state
 * (`'partial'`, `'all-failed'`, `'incompatible'`) surfaces as `'error'`
 * from the capsule's POV — the per-step detail is still summarised on
 * `result.stderr` for any consumer that wants to dispatch on it.
 */
function mapRunStatusToCapsuleStatus(
  status: PipelineRunStatus
): RunCapsuleStatus {
  return status === 'all-ok' ? 'success' : 'error';
}

/**
 * Serialize the pipeline steps into a deterministic recipe string for
 * `source.content`.
 *
 * **Privacy gate (implementation note)** — this is the RECIPE, never the data. The
 * input the pipeline ran against rides `input.stdin` (where the
 * sanitiser applies); the per-step OUTPUTS never enter the source. The
 * recipe is only the step ids + their options blobs, which are the same
 * shape the user can already export via "Export pipeline JSON".
 *
 * Steps are emitted in pipeline order (NOT sorted) because order is part
 * of the recipe's identity — reordering steps produces a different
 * pipeline, so it must produce a different content-hash. Within each
 * step the options object is serialized with `JSON.stringify`, which is
 * deterministic for a given key-insertion order; the adapter option
 * blobs are built by the engine with stable key order, so the same
 * recipe hashes identically across runs.
 */
function serializeRecipeForCapsule(steps: readonly PipelineStepV1[]): string {
  const lines: string[] = [];
  lines.push('# Lingua utility pipeline capsule v1');
  steps.forEach((step, index) => {
    lines.push(
      `#${index + 1} ${step.utilityId} ${JSON.stringify(step.options ?? {})}`
    );
  });
  return lines.join('\n');
}

/**
 * Extract the pipeline's effective FINAL output — the last step whose
 * status is `'ok'` and that carries an `output`. Walking newest-first
 * means a partial run (where a tail step failed) still surfaces the last
 * good intermediate value rather than nothing. Returns `''` when no step
 * produced an output (e.g. first step failed, or every step was skipped).
 */
function finalOutput(outcome: PipelineRunOutcome): string {
  for (let i = outcome.results.length - 1; i >= 0; i -= 1) {
    const result = outcome.results[i];
    if (result && result.status === 'ok' && typeof result.output === 'string') {
      return result.output;
    }
  }
  return '';
}

/**
 * Build a compact failed-step summary for `result.stderr` (implementation note). One
 * line per result whose status is in `{error, timeout, incompatible}`:
 * `#<index> <utilityId>: <errorMessage ?? status>`. The index is
 * 1-based to match the recipe lines. Returns `''` when no step failed,
 * in which case the caller omits the field entirely.
 */
function failedStepSummary(outcome: PipelineRunOutcome): string {
  const lines: string[] = [];
  outcome.results.forEach((result, index) => {
    if (
      result.status === 'error' ||
      result.status === 'timeout' ||
      result.status === 'incompatible'
    ) {
      lines.push(
        `#${index + 1} ${result.utilityId}: ${result.errorMessage ?? result.status}`
      );
    }
  });
  return lines.join('\n');
}

export interface BuildPipelineCapsuleInput {
  appVersion: string;
  /** Display name of the pipeline. Falls back to a neutral label when empty. */
  pipelineName: string;
  /** The pipeline's ordered steps — serialized as the recipe (implementation note). */
  steps: readonly PipelineStepV1[];
  /** The input string the pipeline ran against. Rides `input.stdin`. */
  input: string;
  /** The settled run outcome (status + per-step results + total duration). */
  outcome: PipelineRunOutcome;
  platform: 'web' | 'desktop';
}

/**
 * Build a capsule for a utility-pipeline run. Delegates content-hashing,
 * UUID generation, and the ISO timestamp to the shared `buildRunCapsule`
 * helper so pipeline capsules share every guarantee with code-run and
 * HTTP capsules.
 */
export async function buildPipelineCapsule(
  input: BuildPipelineCapsuleInput
): Promise<RunCapsuleV1> {
  const status = mapRunStatusToCapsuleStatus(input.outcome.status);
  const content = serializeRecipeForCapsule(input.steps);
  const stdout = finalOutput(input.outcome);
  const stderr = failedStepSummary(input.outcome);
  return buildRunCapsule({
    appVersion: input.appVersion,
    tab: {
      name:
        input.pipelineName.trim().length > 0
          ? input.pipelineName.trim()
          : 'Utility pipeline',
      language: 'pipeline',
      runtimeMode: 'utility-pipeline',
      workflowMode: 'run',
    },
    source: { content },
    // The input data rides `input.stdin` so the existing sanitiser's
    // stdin handling applies — same slot the code-run + HTTP paths use.
    input: { stdin: input.input },
    result: {
      status,
      durationMs: Math.max(0, input.outcome.durationMs),
      // Final output + failed-step summary ride the existing
      // stdout/stderr slots so the consumer's redactor + truncator apply.
      ...(stdout.length > 0 ? { stdout } : {}),
      ...(stderr.length > 0 ? { stderr } : {}),
    },
    environment: {
      platform: input.platform,
      runner: 'utility-pipeline',
    },
  });
}
