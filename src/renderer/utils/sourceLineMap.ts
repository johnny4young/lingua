import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

/**
 * Build a best-effort generated-line -> original-source-line map from
 * a sourcemap. Missing or malformed sourcemaps intentionally degrade
 * to an empty map so runtime execution is never blocked by diagnostics.
 */
export function buildGeneratedSourceLineMap(
  generatedCode: string,
  inputMap: string | undefined
): Record<number, number> {
  if (!inputMap) return {};

  const out: Record<number, number> = {};
  let tracer: TraceMap;
  try {
    tracer = new TraceMap(inputMap);
  } catch {
    return out;
  }

  const lineCount = generatedCode.split('\n').length;
  for (let line = 1; line <= lineCount; line += 1) {
    try {
      const original = originalPositionFor(tracer, { line, column: 0 });
      if (typeof original.line === 'number' && original.line > 0) {
        out[line] = original.line;
      }
    } catch {
      // Sourcemap lookup is best-effort; unmapped helper lines stay unmapped.
    }
  }

  return out;
}
