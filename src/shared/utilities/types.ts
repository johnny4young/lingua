/**
 * RL-099 Slice 1 — Utility adapter contract.
 *
 * Five pure-function utility adapters get extracted from
 * `src/renderer/utils/developerUtilities.ts` into `src/shared/utilities/`
 * so both the existing React panels AND the new pipeline engine
 * (`src/shared/utilityPipeline.ts`) consume them through the same
 * surface. Renderer panels keep importing from
 * `src/renderer/utils/developerUtilities.ts` which re-exports from
 * here — zero behavior change at the panel layer.
 *
 * Design decisions worth surfacing inline:
 *
 *   1. **All Slice 1 adapters are `text → text`.** Compatibility
 *      checks between `inputKind` / `outputKind` are wired up in the
 *      engine for forward-compat (Slice 2+ will add binary + json
 *      adapters like `hash-bytes`, `parse-json` that produce
 *      structured outputs). The closed `PIPELINE_STEP_STATUSES` enum
 *      keeps `'incompatible'` reserved for that future use.
 *
 *   2. **Adapter `id` is a closed enum** so persisted pipelines stay
 *      version-safe across releases — drop an adapter and the load
 *      path rejects the orphaned step with `'unknown-utility-id'`.
 *
 *   3. **`run()` always settles** with a discriminated `{ok, value}`
 *      / `{ok: false, reason}` result. Closed-enum `AdapterRunReason`
 *      keeps the failure surface honest: every reject has a code.
 *
 *   4. **`parseOptions()` is the shape guard** for persisted
 *      pipelines. Returns `null` on any mismatch so the engine drops
 *      orphaned step options gracefully.
 *
 *   5. **`optionsSchema`** (fold C — schema-driven options form)
 *      declares the UI inputs the panel renders. Closed enum of
 *      field types (`text` / `textarea` / `select` / `boolean`)
 *      keeps the form renderer simple + lets adapters declare their
 *      options without writing React forms.
 */

/**
 * Closed enum of utility adapter ids. Add a new adapter here AND in
 * `registry.ts`. Telemetry deliberately does not surface adapter ids
 * today; if a future slice does, mirror this enum on the update-server
 * allowlist in the same change.
 */
export const UTILITY_ADAPTER_IDS = [
  'json-format',
  'base64-encode',
  'base64-decode',
  'url-parse',
  'regex-replace',
  'diff-text',
  // RL-099 Slice 4 — adapter-vocabulary expansion. Core 4 transforms
  // plus the folded-in timestamp / color / string-case / html-entity
  // adapters. Each is a pure shared reimplementation (the shared layer
  // cannot import the renderer helpers; mirrors the base64 precedent).
  'hash',
  'jwt-decode',
  'url-encode',
  'url-decode',
  'timestamp',
  'color-convert',
  'string-case',
  'html-entity-encode',
  'html-entity-decode',
  // RL-099 Slice 6 — vocabulary expansion round 2. Pure text→text
  // transforms (number radix, line sort, slugify, JSON minify, text
  // stats). Each is a self-contained shared reimplementation.
  'number-base',
  'line-sort',
  'slugify',
  'json-minify',
  'text-stats',
] as const;
export type UtilityAdapterId = (typeof UTILITY_ADAPTER_IDS)[number];

/**
 * Kind of value an adapter consumes or produces. Slice 1 is all
 * `'text'`; the enum stays open for Slice 2+ binary / structured
 * adapters.
 */
export type UtilityValueKind = 'text' | 'json' | 'binary';

/**
 * Closed enum of failure reasons an adapter `run()` returns. The
 * engine maps these onto step status + the UI maps them onto i18n
 * keys (`utilityPipeline.result.error.*`).
 */
export const ADAPTER_RUN_REASONS = [
  'invalid-input',
  'invalid-options',
  'execution-error',
  'unsupported',
] as const;
export type AdapterRunReason = (typeof ADAPTER_RUN_REASONS)[number];

/**
 * Discriminated outcome of `adapter.run()`. Always settles; never
 * throws. The engine treats any thrown exception as
 * `{ ok: false, reason: 'execution-error' }` defensively.
 */
export type AdapterRunOutcome<TValue = string> =
  | { readonly ok: true; readonly value: TValue }
  | {
      readonly ok: false;
      readonly reason: AdapterRunReason;
      /** Optional dev-facing detail. NOT user-facing copy — surfaced in the error band's <pre>. */
      readonly detail?: string;
    };

/**
 * One field in the adapter's options form. The panel renders
 * `<input>` / `<textarea>` / `<select>` / `<input type="checkbox">`
 * based on `type`. Labels go through i18n via `labelKey`.
 */
export type UtilityOptionField =
  | {
      readonly key: string;
      readonly type: 'text';
      readonly labelKey: string;
      readonly placeholderKey?: string;
      readonly defaultValue: string;
    }
  | {
      readonly key: string;
      readonly type: 'textarea';
      readonly labelKey: string;
      readonly placeholderKey?: string;
      readonly defaultValue: string;
    }
  | {
      readonly key: string;
      readonly type: 'select';
      readonly labelKey: string;
      readonly options: ReadonlyArray<{ value: string; labelKey: string }>;
      readonly defaultValue: string;
    }
  | {
      readonly key: string;
      readonly type: 'boolean';
      readonly labelKey: string;
      readonly defaultValue: boolean;
    };

/**
 * Pure adapter contract. Adapters are pure functions wrapped to
 * declare their kinds, default options, and option-shape guard.
 * Implementations live one-per-file alongside this contract.
 *
 * `TOptions` is the structured options shape (typed per adapter).
 * `run()` takes the chained `input` (always a string in Slice 1) +
 * the parsed `options` (already through `parseOptions`).
 */
export interface UtilityAdapter<TOptions = Record<string, unknown>> {
  readonly id: UtilityAdapterId;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly inputKind: UtilityValueKind;
  readonly outputKind: UtilityValueKind;
  readonly optionsSchema: ReadonlyArray<UtilityOptionField>;
  /** Build the default options blob for a fresh step. */
  readonly defaultOptions: () => TOptions;
  /**
   * Strict shape guard at the persisted-pipeline boundary. Returns
   * `null` on any mismatch; the engine drops the orphaned options
   * and uses `defaultOptions()` instead, marking the step with a
   * non-blocking `removed-options` note (Slice 2 surfacing).
   */
  readonly parseOptions: (raw: unknown) => TOptions | null;
  /**
   * Execute the adapter. Always settles to an `AdapterRunOutcome`.
   * Thrown exceptions are caught by the engine and surfaced as
   * `execution-error` — implementations should still catch internally
   * and return a typed reason where possible.
   */
  readonly run: (input: string, options: TOptions) => Promise<AdapterRunOutcome<string>>;
}
