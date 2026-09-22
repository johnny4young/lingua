import type { ExecutionError, ExecutionResult } from '../types/execution';

type Outcome = Pick<ExecutionResult, 'kind' | 'cancelled' | 'error' | 'magicResults'>;

/** Captured expression failures do not abort the program, but are not successes. */
export function capturedExecutionErrors(result: Outcome): ExecutionError[] {
  return (result.magicResults ?? [])
    .filter(entry => entry.isError === true)
    .map(entry => ({ message: entry.value, line: entry.line }));
}

export function primaryExecutionError(result: Outcome): ExecutionError | null {
  return result.error ?? capturedExecutionErrors(result)[0] ?? null;
}

/** Explicit cancellation/deadlines take precedence over errors already captured. */
export function executionKind(result: Outcome): NonNullable<ExecutionResult['kind']> {
  if (result.kind === 'timeout') return 'timeout';
  if (result.cancelled || result.kind === 'stopped') return 'stopped';
  if (result.error || result.magicResults?.some(entry => entry.isError) || result.kind === 'error') {
    return 'error';
  }
  return 'success';
}
