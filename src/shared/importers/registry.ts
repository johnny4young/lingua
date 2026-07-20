/**
 * implementation — Importer registry.
 *
 * Single source of truth for `id → adapter` lookup. Mirrors
 * `src/shared/utilities/registry.ts` (set as precedent by internal
 * implementation) so a future fourth registry doesn't have to invent its
 * own shape.
 *
 * Adding an importer means:
 *
 *   1. Add the id to `IMPORTER_IDS` in `./types.ts`.
 *   2. Implement the adapter in its own file.
 *   3. Register it here.
 *   4. Add `importPreview.importer.<id>.{title,description}` to
 *      both i18n locales.
 *
 * `getImporter()` returns `undefined` for unknown ids so callers
 * that round-trip persisted state can drop orphaned references
 * gracefully (matches the `getAdapter` semantics in
 * `src/shared/utilities/registry.ts`).
 */

import { brunoImporterAdapter } from './brunoImporter';
import { curlImporterAdapter } from './curlImporter';
import { ipynbImporterAdapter } from './ipynbImporter';
import { linguanbImporterAdapter } from './linguanbImporter';
import { postmanImporterAdapter } from './postmanImporter';
import type { ImporterAdapter, ImporterId } from './types';

// `unknown` generic params mirror the utility-registry precedent —
// each adapter carries its own TPreview / TResult; the union is too
// narrow to express directly so we widen at the registry boundary.
//
// ORDER MATTERS for `detectImporter`: `'linguanb-notebook'` is listed
// BEFORE `'ipynb-notebook'` because a `.linguanb` envelope embeds an
// inner notebook with a `"cells":` array, which the ipynb adapter's
// loose `"cells":` / `"nbformat":` sniff would otherwise claim first.
// The linguanb `detect` requires the specific `"format":"linguanb"`
// marker, so checking it first routes each format to the right adapter.
export const IMPORTER_REGISTRY: Readonly<
  Record<ImporterId, ImporterAdapter<unknown, unknown>>
> = {
  'curl-http': curlImporterAdapter as ImporterAdapter<unknown, unknown>,
  'linguanb-notebook': linguanbImporterAdapter as ImporterAdapter<unknown, unknown>,
  'ipynb-notebook': ipynbImporterAdapter as ImporterAdapter<unknown, unknown>,
  'postman-collection': postmanImporterAdapter as ImporterAdapter<unknown, unknown>,
  'bruno-collection': brunoImporterAdapter as ImporterAdapter<unknown, unknown>,
};

export function getImporter(
  id: string
): ImporterAdapter<unknown, unknown> | undefined {
  if (!Object.prototype.hasOwnProperty.call(IMPORTER_REGISTRY, id)) {
    return undefined;
  }
  return IMPORTER_REGISTRY[id as ImporterId];
}

export function listImporters(): ReadonlyArray<ImporterAdapter<unknown, unknown>> {
  return Object.values(IMPORTER_REGISTRY);
}

/**
 * Best-effort auto-detection — runs `detect(source)` on every
 * registered importer and returns the first match's id, or `null`
 * if nothing claims the input. implementation only has one importer so
 * this is trivially `'curl-http'` for inputs starting with `curl `;
 * the shape stays useful for implementation when multiple importers
 * could compete.
 */
export function detectImporter(source: string): ImporterId | null {
  for (const [id, adapter] of Object.entries(IMPORTER_REGISTRY) as Array<
    [ImporterId, ImporterAdapter<unknown, unknown>]
  >) {
    if (adapter.detect(source)) return id;
  }
  return null;
}
