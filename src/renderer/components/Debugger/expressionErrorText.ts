import { isDebuggerExpressionErrorCode, type DebuggerWatchResult } from '../../../shared/debuggerExpressionErrors';
import type { TranslateFn } from '../../runners/limits';

/** A safe-evaluator rejection in the UI language; text from a native debugger stays as it came. */
export function expressionErrorText(failure: DebuggerWatchResult, t: TranslateFn): string {
  if (!isDebuggerExpressionErrorCode(failure.errorCode)) return failure.error ?? '';
  return t(`debugger.expression.${failure.errorCode}`, { detail: typeof failure.errorDetail === 'string' ? failure.errorDetail : '' });
}
