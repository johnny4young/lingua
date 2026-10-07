/** Format-neutral collection preview, commit contracts and import limits. */

import type { HttpMethod, HttpRequestBody, HttpRequestHeader } from '../httpWorkspaceSchema';
import type { ImporterLossyWarning } from './types';

// ---------------------------------------------------------------------------
// Shared collection shapes
// ---------------------------------------------------------------------------

/**
 * One parsed request from a collection, in the same persistence-free
 * shape as `ParsedCurl`. The `useImportPreview` confirm path mints a
 * `HttpRequestV1` from each via `createBlankHttpRequest`. `headers`
 * carries the ORIGINAL (un-redacted) values — they round-trip on
 * confirm; the preview band only ever shows header COUNTS.
 */
export interface ParsedCollectionRequest {
  readonly name: string;
  readonly method: HttpMethod;
  readonly url: string;
  readonly headers: ReadonlyArray<HttpRequestHeader>;
  readonly body?: HttpRequestBody;
  /**
   * A display-only copy of `url` with values
   * sourced from a SENSITIVE-named environment/globals variable (token,
   * apiKey, secret, …) replaced by `<redacted>`. Present only when such a
   * substitution actually landed in the URL; the preview band renders
   * `displayUrl ?? url` while `url` (the real resolved value) round-trips
   * on confirm into the HTTP workspace.
   */
  readonly displayUrl?: string;
}

/** Source family — drives the preview badge + telemetry importer id. */
type CollectionSource = 'postman' | 'bruno';

/**
 * Preview shape shared by the Postman + Bruno adapters. The
 * discriminator `kind: 'http-collection'` lets `<ImportPreviewBody>`
 * branch once for both; `source` picks the badge label. `requests`
 * carries the full parsed list (original header values) for the
 * confirm round-trip.
 */
export interface CollectionImporterPreview {
  readonly kind: 'http-collection';
  readonly source: CollectionSource;
  /** Collection title (from `info.name` / Bruno `meta.name`). */
  readonly title: string;
  /** Flattened request list, capped at `MAX_IMPORT_REQUESTS`. */
  readonly requests: ReadonlyArray<ParsedCollectionRequest>;
  /** Summary counts for the preview chip. */
  readonly counts: {
    /** Requests that will be imported (== `requests.length`). */
    readonly total: number;
    /** Distinct folders represented by the flattened request list. */
    readonly folders: number;
    /** Requests dropped because the collection exceeded the cap. */
    readonly truncated: number;
    /**
     * Distinct collection-level `{{variables}}` actually substituted
     * (Postman only; undefined for Bruno, which has no collection-var
     * concept in this change). Surfaced by the preview chip + the
     * `import.postman_variables_resolved` telemetry bucket.
     */
    readonly variablesResolved?: number;
    /**
     * Distinct static `{{placeholders}}` left literal because no
     * matching collection variable was found (drives the narrowed
     * `postman-variable` warning). Dynamic `{{$...}}` tokens are NOT
     * counted here — they surface via `postman-dynamic-variable`.
     */
    readonly variablesUnresolved?: number;
    /**
     * How many distinct provided environment /
     * globals keys contributed to resolved request values (including through
     * collection variables that reference env/globals keys). Drives the
     * "N from environment" preview chip. Undefined when no
     * environment/globals source was supplied.
     */
    readonly variablesResolvedFromEnv?: number;
  };
  /**
   * The distinct `{{tokens}}` still unresolved
   * after the merge (collection + environment + globals), sorted and
   * capped for display. The preview lists these so the user knows exactly
   * which variables their environment is missing. Mirrors
   * `counts.variablesUnresolved` (the count) with the actual names.
   */
  readonly unresolvedVariableNames?: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<ImporterLossyWarning>;
}

/** Commit shape — `import(preview)` hands this back to the caller. */
export interface CollectionImporterResult {
  readonly source: CollectionSource;
  readonly title: string;
  readonly requests: ReadonlyArray<ParsedCollectionRequest>;
}

/**
 * Hard cap on requests imported from a single collection. A
 * collection larger than this is truncated (the first N survive) with
 * a `counts.truncated` count surfaced to the UI — never a reject, so a
 * partial import of a huge collection is still useful.
 */
export const MAX_IMPORT_REQUESTS = 100;

/**
 * Defensive byte cap on the raw source before `JSON.parse`, so a
 * pathological multi-megabyte paste cannot stall the renderer. 4 MiB
 * comfortably fits any realistic collection export.
 */
export const MAX_COLLECTION_BYTES = 4 * 1024 * 1024;
