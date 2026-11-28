/**
 * The safe watch evaluator's rejections. Each carries a code the renderer
 * translates; its English text is what logpoints print.
 */
const FIXED = {
  empty: 'Expression is empty',
  tooLong: 'Expression is too long',
  invalid: 'Invalid expression',
  single: 'Only one expression is allowed',
  budget: 'Expression is too complex to evaluate',
  nullish: 'Cannot inspect null or undefined',
  prototype: 'Prototype access is not allowed',
  objectMethods: 'Object methods and spread are not allowed',
  number: 'A primitive number is required',
  primitive: 'A primitive value is required',
  strictEquality: 'Use strict equality (=== or !==)',
  call: 'Function calls are not allowed',
  assignment: 'Assignments are not allowed',
  failed: 'Evaluation failed',
} as const;

const WITH_DETAIL = {
  identifier: 'Unknown identifier',
  operator: 'Unsupported operator',
  syntax: 'Unsupported syntax',
} as const;

type FixedCode = keyof typeof FIXED;
type DetailCode = keyof typeof WITH_DETAIL;
export type DebuggerExpressionErrorCode = FixedCode | DetailCode;

/** Why an expression failed: the text as reported, and the code when the safe evaluator rejected it. */
export interface DebuggerExpressionFailure {
  error: string;
  errorCode?: DebuggerExpressionErrorCode;
  errorDetail?: string;
}

/** A watch's evaluation at a pause: a value, a failure, or pending until the next pause. */
export interface DebuggerWatchResult extends Partial<DebuggerExpressionFailure> {
  value?: string;
  pending?: boolean;
}

export class DebuggerExpressionError extends Error {
  constructor(
    readonly code: DebuggerExpressionErrorCode,
    readonly detail?: string
  ) {
    super(code in FIXED ? FIXED[code as FixedCode] : `${WITH_DETAIL[code as DetailCode]}: ${detail ?? ''}`);
  }
}

export function debuggerExpressionError(code: FixedCode): DebuggerExpressionError;
export function debuggerExpressionError(code: DetailCode, detail: string): DebuggerExpressionError;
export function debuggerExpressionError(code: DebuggerExpressionErrorCode, detail?: string): DebuggerExpressionError {
  return new DebuggerExpressionError(code, detail);
}

/** A caught error as a failure; only the evaluator's own rejections carry a code. */
export function expressionFailure(error: unknown): DebuggerExpressionFailure {
  if (error instanceof DebuggerExpressionError) {
    return error.detail === undefined ? { error: error.message, errorCode: error.code } : { error: error.message, errorCode: error.code, errorDetail: error.detail };
  }
  return error instanceof Error ? { error: error.message } : { error: FIXED.failed, errorCode: 'failed' };
}

/** Whether a code from the worker, which user code can reach, is one the renderer translates. */
export function isDebuggerExpressionErrorCode(code: unknown): code is DebuggerExpressionErrorCode {
  return typeof code === 'string' && (Object.hasOwn(FIXED, code) || Object.hasOwn(WITH_DETAIL, code));
}
