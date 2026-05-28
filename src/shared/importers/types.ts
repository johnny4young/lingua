/**
 * RL-100 Slice 1 — Importer adapter contract.
 *
 * Importers turn an external payload (cURL command, `.ipynb` JSON,
 * Postman collection, etc.) into a Lingua domain object the user can
 * confirm into a workspace. Slice 1 ships the registry shape + the
 * cURL → HTTP request adapter only; later slices add `.ipynb`,
 * Bruno/Postman, and CodePen/JSFiddle URL flows.
 *
 * Three-phase contract — every adapter implements all three:
 *
 *   1. `detect(source)` — fast probe: does this look like our format?
 *      Used by the registry's "auto-pick the importer" hook so the
 *      user doesn't have to choose `curl-http` vs `ipynb` etc. by
 *      hand.
 *   2. `preview(source)` — parse to a preview shape. Surfaces
 *      `warnings: string[]` for lossy features we silently dropped
 *      (e.g. `-F file=@photo.jpg` in cURL). Returns a discriminated
 *      `{ ok: true, preview, warnings } | { ok: false, reason }`.
 *   3. `import(preview)` — commit. Builds the canonical domain
 *      object (in Slice 1: `HttpRequestV1`) that the caller writes
 *      into the appropriate Zustand store.
 *
 * Closed-enum reject reasons keep the surface honest: every reject
 * has a code, and the UI maps codes to localized copy without
 * relying on free-form error strings.
 *
 * Privacy posture:
 *
 *   - Importers run entirely in the renderer. NO IPC, NO network
 *     fetches.
 *   - Sensitive headers (`Authorization`, `Cookie`, etc. — the
 *     RL-097 `BASELINE_SENSITIVE_HEADERS` set) are REDACTED in the
 *     preview shape so the user's screen never displays them, even
 *     mid-import. The actual `HttpRequestV1` written on confirm
 *     keeps the unredacted value — that's the whole point of
 *     importing.
 *   - Telemetry (`import.applied`) carries only the closed importer
 *     id + status + size bucket. NO URL, NO header values, NO body
 *     content on the wire.
 */

/**
 * Closed enum of importer ids. Slice 1 shipped `'curl-http'`;
 * Slice 2 (2026-05-27) added `'ipynb-notebook'`; Slice 3 (2026-05-28)
 * adds `'postman-collection'` + `'bruno-collection'`. The enum stays
 * open for `'codepen-url'` (Slice 4+).
 *
 * Mirrored on `update-server/src/telemetry.ts` as
 * `IMPORTER_IDS_SET` — see the parity test there.
 */
export const IMPORTER_IDS = [
  'curl-http',
  'ipynb-notebook',
  'postman-collection',
  'bruno-collection',
] as const;
export type ImporterId = (typeof IMPORTER_IDS)[number];

/**
 * Closed enum of reject reasons. Adding new reasons is allowed
 * (additive); renaming/removing breaks i18n keys + downstream
 * branching, so don't.
 */
export const IMPORTER_REJECT_REASONS = [
  'empty-input',
  'unrecognized-format',
  'malformed',
  'unsupported-feature',
] as const;
export type ImporterRejectReason = (typeof IMPORTER_REJECT_REASONS)[number];

/**
 * Closed enum of lossy-feature warning codes. Each adapter
 * declares which codes it can emit. The UI maps codes to localized
 * hint copy via `importPreview.warning.lossy.<code>` keys.
 *
 * Slice 1 codes are cURL-specific; future adapters add their own
 * (e.g. `'notebook-cell-output-stripped'` for `.ipynb`).
 */
export const IMPORTER_LOSSY_WARNINGS = [
  'curl-data-binary-file',
  'curl-multipart-form',
  'curl-basic-auth',
  'curl-cookie-jar',
  'curl-cookie-write',
  'curl-output-file',
  'curl-other-flag',
  // RL-100 Slice 2 — `.ipynb` adapter lossy codes. The `.ipynb`
  // → `NotebookV1` mapping is intentionally lossy in Slice 2:
  //   - `cell_type: 'raw'` cells are dropped (Lingua has no raw kind);
  //   - rich outputs (`image/png`, `text/html`, `application/json`,
  //     etc.) are dropped, only the `text/plain` MIME variant survives
  //     as a `NotebookCellOutputV1`;
  //   - cells whose kernelspec language is not in
  //     `NOTEBOOK_CELL_LANGUAGES` (Slice A: JS / TS / Python) fall
  //     back to JS with `ipynb-unknown-language`;
  //   - cells with `execute_count` metadata lose it on import (only
  //     content + outputs survive).
  // Slice B+ promotes via RL-043 Slice B rich outputs + RL-043 Slice D
  // round-trip export.
  'ipynb-raw-cell-dropped',
  'ipynb-rich-output-dropped',
  'ipynb-unknown-language',
  'ipynb-execute-result-stripped',
  // RL-100 Slice 3 — Postman / Bruno collection lossy codes. A
  // collection import is intentionally lossy: Postman's auth helpers,
  // pre-request / test scripts, environment variables, and non-text
  // body modes have no Lingua HTTP-workspace equivalent, so they are
  // surfaced as warnings rather than silently dropped.
  //   - `postman-auth-helper`: an `auth` block (basic / apikey / oauth)
  //     we could not flatten to a single header (bearer IS mapped).
  //   - `postman-prerequest-script` / `postman-test-script`: the
  //     `event` scripts are dropped (Lingua has no scripting runtime).
  //   - `postman-variable`: `{{var}}` placeholders left literal because
  //     Slice 3 does not resolve environment / globals files.
  //   - `postman-graphql-body`: GraphQL body kept as raw text only.
  //   - `postman-formdata-file`: multipart / file-upload body parts
  //     are not importable; the text parts survive.
  //   - `bruno-script-dropped`: a `.bru` `script:*` / `tests` block.
  'postman-auth-helper',
  'postman-prerequest-script',
  'postman-test-script',
  'postman-variable',
  'postman-graphql-body',
  'postman-formdata-file',
  'bruno-script-dropped',
] as const;
export type ImporterLossyWarning = (typeof IMPORTER_LOSSY_WARNINGS)[number];

/**
 * RL-100 Slice 2 — `.ipynb` adapter's internal reject taxonomy.
 *
 * Surfaced via `ImporterPreviewOutcome.detail` (NOT a new closed
 * enum on the outer outcome) so the generic `IMPORTER_REJECT_REASONS`
 * shape stays uniform across every importer. The UI reads
 * `detail` when the reason is `'malformed'` / `'unsupported-feature'`
 * to render a more specific localized hint via
 * `importPreview.reject.ipynb.<code>` keys.
 *
 * `'malformed-json'` and `'invalid-shape'` map outward to
 * `IMPORTER_REJECT_REASONS = 'malformed'`. `'wrong-version'`,
 * `'oversized'`, and `'too-many-cells'` map to `'unsupported-feature'`.
 */
export const IPYNB_REJECT_REASONS = [
  'malformed-json',
  'wrong-version',
  'invalid-shape',
  'oversized',
  'too-many-cells',
] as const;
export type IpynbRejectReason = (typeof IPYNB_REJECT_REASONS)[number];

/**
 * RL-100 Slice 2 fold E — closed enum of `.ipynb` warning kinds
 * surfaced via the `import.notebook_warnings_surfaced` telemetry
 * event. The renderer derives `dominantKind` from the warnings
 * array on a successful import; if no warnings, the event does NOT
 * fire.
 *
 * Mirrored on `update-server/src/telemetry.ts` as
 * `NOTEBOOK_WARNING_KINDS_SET` — parity test there.
 */
export const NOTEBOOK_WARNING_KINDS = [
  'raw-cell-dropped',
  'rich-output-dropped',
  'unknown-language',
  'execute-result-stripped',
] as const;
export type NotebookWarningKind = (typeof NOTEBOOK_WARNING_KINDS)[number];

/**
 * RL-100 Slice 3 — Postman Collection adapter's internal reject
 * taxonomy. Surfaced via `ImporterPreviewOutcome.detail` (same
 * pattern as `IPYNB_REJECT_REASONS`) so the generic
 * `IMPORTER_REJECT_REASONS` shape stays uniform across importers.
 *
 * Outward mapping (to `IMPORTER_REJECT_REASONS`):
 *   - `'malformed-json'` / `'invalid-shape'` → `'malformed'`.
 *   - `'wrong-version'` / `'empty-collection'` / `'oversized'` →
 *     `'unsupported-feature'`.
 */
export const POSTMAN_REJECT_REASONS = [
  'malformed-json',
  'wrong-version',
  'invalid-shape',
  'empty-collection',
  'oversized',
] as const;
export type PostmanRejectReason = (typeof POSTMAN_REJECT_REASONS)[number];

/**
 * RL-100 Slice 3 — Bruno `.bru` adapter's internal reject taxonomy.
 * Surfaced via `ImporterPreviewOutcome.detail`. Outward mapping:
 *   - `'malformed'` / `'invalid-shape'` → `'malformed'`.
 *   - `'empty-input'` → `'empty-input'`.
 */
export const BRUNO_REJECT_REASONS = [
  'empty-input',
  'malformed',
  'invalid-shape',
] as const;
export type BrunoRejectReason = (typeof BRUNO_REJECT_REASONS)[number];

/**
 * Result of `adapter.preview(source)`. The `preview` field is the
 * adapter's TPreview generic; the caller hands it back to
 * `adapter.import(preview)` to commit.
 *
 * `warnings` is ALWAYS an array even when empty so consumers can
 * `.map()` without nullchecks.
 */
export type ImporterPreviewOutcome<TPreview> =
  | {
      readonly ok: true;
      readonly preview: TPreview;
      readonly warnings: ReadonlyArray<ImporterLossyWarning>;
    }
  | {
      readonly ok: false;
      readonly reason: ImporterRejectReason;
      /** Optional human-readable detail; NOT user-facing copy (the UI maps `reason` → i18n key). */
      readonly detail?: string;
    };

/**
 * Generic adapter contract. `TPreview` is the parsed-but-not-yet-
 * committed shape (lets the UI render a read-only preview band);
 * `TResult` is the canonical Lingua domain object the caller
 * writes into the appropriate store on confirm.
 */
export interface ImporterAdapter<TPreview, TResult> {
  readonly id: ImporterId;
  /** i18n key for the importer's display name. */
  readonly titleKey: string;
  /** i18n key for a one-line description. */
  readonly descriptionKey: string;
  /**
   * Fast probe — does this look like our format? Should run in
   * microseconds; the registry uses it to auto-pick the right
   * importer for arbitrary pasted text.
   */
  detect(source: string): boolean;
  /**
   * Parse to a preview shape. Always settles to a discriminated
   * outcome — never throws.
   */
  preview(source: string): ImporterPreviewOutcome<TPreview>;
  /**
   * Commit the preview to the canonical domain object. Pure
   * function; the caller is responsible for writing the result
   * into the right Zustand store.
   */
  import(preview: TPreview): TResult;
}
