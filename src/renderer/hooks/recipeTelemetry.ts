/**
 * RL-039 Slice B fold B — Recipe telemetry helpers.
 *
 * Two closed-enum events:
 *
 *   - `recipe.opened { language }` — fires once per overlay-driven
 *     `Open recipe` confirm. NO recipe id on the wire (privacy
 *     posture, fold B in the plan). Per-recipe granularity can land
 *     Slice C+ behind a closed `RECIPE_IDS_SET` parity test.
 *   - `recipe.test_run { language, status }` — fires once per
 *     `Run + Test` settle. `status ∈ RECIPE_RUN_STATUSES`.
 *
 * Mirrored on `update-server/src/telemetry.ts` with
 * `RECIPE_RUN_STATUSES_SET` parity test cross-importing the
 * renderer source-of-truth.
 *
 * Payload validation lives at the telemetry redactor level
 * (`src/shared/telemetry.ts` validator branch). This helper is the
 * thin emit surface — callers pass already-typed values.
 */

import type { LanguagePackId } from '../../shared/languagePacks';
import type { RecipeRunStatus } from '../../shared/lessonRunner';
import { trackEvent } from '../utils/telemetry';

export interface RecipeOpenedPayload {
  language: LanguagePackId;
}

export interface RecipeTestRunPayload {
  language: LanguagePackId;
  status: RecipeRunStatus;
}

export function trackRecipeOpened(payload: RecipeOpenedPayload): void {
  void trackEvent('recipe.opened', { language: payload.language });
}

export function trackRecipeTestRun(payload: RecipeTestRunPayload): void {
  void trackEvent('recipe.test_run', {
    language: payload.language,
    status: payload.status,
  });
}
