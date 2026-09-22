import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';

export interface SourcePosition {
  line: number;
  column: number;
}

/** Trace newest-to-oldest maps. Missing mappings stay unknown, never guessed. */
export function createSourcePositionMapper(maps: readonly string[], lineCount?: number) {
  let tracers: TraceMap[];
  try {
    tracers = maps.map(map => new TraceMap(map));
  } catch {
    return (_position: SourcePosition): SourcePosition | null => null;
  }
  return (position: SourcePosition): SourcePosition | null => {
    let { line, column } = position;
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) return null;
    try {
      for (const tracer of tracers) {
        const original = originalPositionFor(tracer, { line, column: column - 1 });
        if (original.line === null || original.column === null) return null;
        line = original.line;
        column = original.column + 1;
      }
    } catch {
      return null;
    }
    if (lineCount !== undefined && line > lineCount) return null;
    return { line, column };
  };
}
