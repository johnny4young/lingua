/**
 * RL-100 Slice 1 — re-export shim.
 *
 * The cURL parser used to live here under RL-097 Slice 1 fold B
 * (HTTP workspace inline "paste cURL into URL field" auto-detect).
 * RL-100 Slice 1 moved the parser to `src/shared/importers/curlImporter.ts`
 * so the new global Import overlay (`Mod+Alt+I`) can reuse it.
 *
 * This file re-exports `tryParseCurl` + `ParsedCurl` from the shared
 * module so the existing HTTP workspace import-from-URL-field flow
 * keeps picking up parser fixes uniformly with the global overlay.
 * The existing test suite at
 * `tests/components/HttpWorkspace/curlImport.test.ts` runs against
 * the new location via this re-export.
 *
 * Do NOT add new behaviour here. Extend
 * `src/shared/importers/curlImporter.ts` (or the broader
 * `ImporterAdapter` shape in `src/shared/importers/types.ts`) so
 * both surfaces — the inline editor + the global overlay — pick up
 * the change uniformly.
 */

export {
  tryParseCurl,
  type ParsedCurl,
} from '../../../shared/importers/curlImporter';
