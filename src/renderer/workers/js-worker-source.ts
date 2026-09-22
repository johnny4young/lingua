import { parse } from 'acorn';
import { parseJsErrorStack } from '../../shared/errorStack';
import { createSourcePositionMapper } from '../../shared/sourcePosition';
import type { ExecutionError } from '../types/execution';

const USER_SOURCE = 'lingua-user-code';
const PROBE_SOURCE = 'lingua-coordinate-probe';
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/** The engine owns the dynamic-function prelude; measure it, do not assume two lines. */
export async function createJsWorkerSourceMapper(
  maps: readonly string[] = [],
  lineCount?: number
) {
  const probeStack: unknown = await new AsyncFunction(
    `return new Error().stack;\n//# sourceURL=${PROBE_SOURCE}`
  )();
  const probeLine = typeof probeStack === 'string'
    ? probeStack.match(/lingua-coordinate-probe:(\d+):\d+/)?.[1]
    : undefined;
  const offset = probeLine ? Number(probeLine) - 1 : null;
  const mapPosition = createSourcePositionMapper(maps, lineCount);
  const locationPattern = () => /lingua-user-code:(\d+):(\d+)/g;
  const positionFor = (line: string, column: string) => {
    if (offset === null) return null;
    const generatedLine = Number(line) - offset;
    const position = mapPosition({ line: generatedLine, column: Number(column) });
    return position;
  };
  const firstPosition = (stack?: string) => {
    for (const match of (stack ?? '').matchAll(locationPattern())) {
      const position = positionFor(match[1]!, match[2]!);
      if (position) return position;
    }
    return null;
  };
  const mappedText = (text: string) => text.replace(locationPattern(), (_match, line, column) => {
    const position = positionFor(line, column);
    return position ? `user code:${position.line}:${position.column}` : 'generated code';
  });

  return {
    body: (code: string) => `${code}\n//# sourceURL=${USER_SOURCE}`,
    callingLine: () => firstPosition(new Error().stack)?.line,
    parseError: (error: unknown, syntaxCode?: string): ExecutionError => {
      if (!(error instanceof Error)) return { message: String(error) };
      let position = firstPosition(error.stack);
      // Dynamic-function constructors do not expose a source frame for parse
      // errors. Ask the existing parser for a location only after the engine
      // rejected syntax; never use a second evaluation or reject valid code.
      if (!position && error instanceof SyntaxError && syntaxCode !== undefined) {
        try {
          parse(syntaxCode, { ecmaVersion: 'latest', allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true });
        } catch (syntaxError) {
          const location = syntaxError && typeof syntaxError === 'object' && 'loc' in syntaxError
            ? syntaxError.loc : null;
          if (location && typeof location === 'object' &&
              'line' in location && typeof location.line === 'number' &&
              'column' in location && typeof location.column === 'number') {
            position = mapPosition({ line: location.line, column: location.column + 1 });
          }
        }
      }
      const frames = parseJsErrorStack(error.stack).map(frame => {
        if (!frame.text.includes(`${USER_SOURCE}:`)) return frame;
        const position = firstPosition(frame.text);
        // A synthetic source label is not a filesystem path. Keep mapped
        // coordinates readable without advertising an invalid cross-file link.
        return { text: mappedText(frame.text), fnName: frame.fnName, ...position };
      });
      return {
        message: error.message,
        ...position,
        stack: error.stack ? mappedText(error.stack) : undefined,
        ...(frames.length ? { frames } : {}),
      };
    },
  };
}
