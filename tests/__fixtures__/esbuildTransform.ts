/**
 * A complete `esbuild.transform` result for mocked transpiles.
 *
 * `TransformResult` also requires `map`, `mangleCache` and `legalComments`,
 * which the tests do not care about but the mocked function must still
 * satisfy. Keeping the shape here means a change in esbuild's contract
 * surfaces in one place.
 */

import type { TransformResult } from 'esbuild-wasm';

export function transformResult(code: string, map = ''): TransformResult {
  return {
    code,
    map,
    warnings: [],
    mangleCache: undefined,
    legalComments: undefined,
  };
}
