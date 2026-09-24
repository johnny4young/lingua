import type MagicString from 'magic-string';

/** Receives one transform map; runners prepend it to their tracing chain. */
export type RecordSourceMap = (map: string) => void;

export function finishSourceTransform(source: MagicString, recordMap?: RecordSourceMap): string {
  if (recordMap && source.hasChanged()) {
    recordMap(source.generateMap({ source: 'input', hires: true }).toString());
  }
  return source.toString();
}

/** Replace the surroundings of an expression, retaining its character-level mappings. */
interface ExpressionEdit {
  start: number;
  end: number;
  expressionStart: number;
  expressionEnd: number;
  prefix: string;
  suffix: string;
}

export function wrapSourceExpression(
  source: MagicString,
  { start, end, expressionStart, expressionEnd, prefix, suffix }: ExpressionEdit
): void {
  if (start < expressionStart) source.overwrite(start, expressionStart, prefix);
  else source.appendLeft(expressionStart, prefix);
  if (expressionEnd < end) source.overwrite(expressionEnd, end, suffix);
  else source.appendLeft(expressionEnd, suffix);
}
