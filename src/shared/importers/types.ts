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
 * Closed enum of importer ids. Slice 1 ships `'curl-http'` only;
 * the enum stays open for `'ipynb-notebook'` (Slice 2),
 * `'postman-collection'` + `'bruno-collection'` (Slice 3), and
 * `'codepen-url'` (Slice 4+).
 *
 * Mirrored on `update-server/src/telemetry.ts` as
 * `IMPORTER_IDS_SET` — see the parity test there.
 */
export const IMPORTER_IDS = ['curl-http'] as const;
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
] as const;
export type ImporterLossyWarning = (typeof IMPORTER_LOSSY_WARNINGS)[number];

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
