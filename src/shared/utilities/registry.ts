/**
 * RL-099 Slice 1 — utility adapter registry.
 *
 * Single source of truth for `id → adapter` lookup. Both the pipeline
 * engine and the UI step dropdown consume this map. Adding an
 * adapter means:
 *
 *   1. Add the id to `UTILITY_ADAPTER_IDS` in `./types.ts`.
 *   2. Implement the adapter in its own file.
 *   3. Register it here.
 *   4. Add `utilityPipeline.adapter.<id>.{title,description,options.*}`
 *      to both i18n locales.
 *
 * `getAdapter()` returns `undefined` for unknown ids so the engine's
 * persisted-pipeline rehydrate path can drop orphaned steps
 * gracefully.
 */

import { base64DecodeAdapter, base64EncodeAdapter } from './base64';
import { diffTextAdapter } from './diffText';
import { jsonFormatAdapter } from './jsonFormat';
import { regexReplaceAdapter } from './regexReplace';
import type { UtilityAdapter, UtilityAdapterId } from './types';
import { urlParseAdapter } from './urlParse';

// `as` is required because `Record<UtilityAdapterId, UtilityAdapter>`
// is too narrow — each adapter has its own TOptions generic so the
// union type isn't directly assignable. The literal closed enum
// keeps the keys honest; missing an id surfaces as a TS error.
export const UTILITY_ADAPTER_REGISTRY: Readonly<
  Record<UtilityAdapterId, UtilityAdapter<unknown>>
> = {
  'json-format': jsonFormatAdapter as UtilityAdapter<unknown>,
  'base64-encode': base64EncodeAdapter as UtilityAdapter<unknown>,
  'base64-decode': base64DecodeAdapter as UtilityAdapter<unknown>,
  'url-parse': urlParseAdapter as UtilityAdapter<unknown>,
  'regex-replace': regexReplaceAdapter as UtilityAdapter<unknown>,
  'diff-text': diffTextAdapter as UtilityAdapter<unknown>,
};

export function getAdapter(id: string): UtilityAdapter<unknown> | undefined {
  if (!Object.prototype.hasOwnProperty.call(UTILITY_ADAPTER_REGISTRY, id)) {
    return undefined;
  }
  return UTILITY_ADAPTER_REGISTRY[id as UtilityAdapterId];
}

export function listAdapters(): ReadonlyArray<UtilityAdapter<unknown>> {
  return Object.values(UTILITY_ADAPTER_REGISTRY);
}
