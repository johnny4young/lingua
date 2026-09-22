import type { ConsoleOutput, ExecutionResult } from '../types/execution';

/** Rebuild observed order, never infer causality from independently buffered pipes. */
export function orderedConsoleOutputs(
  result: Pick<ExecutionResult, 'stdout' | 'stderr'>
): ConsoleOutput[] {
  const outputs = [...result.stdout, ...result.stderr];
  const orders = outputs.map(output => output.captureOrder);
  if (
    orders.some(order => !Number.isSafeInteger(order) || order! < 0) ||
    new Set(orders).size !== orders.length
  ) {
    // Legacy/native results have only per-stream order. Preserve that contract.
    return outputs;
  }
  return outputs.sort((left, right) => left.captureOrder! - right.captureOrder!);
}

/** Only suppress the primary diagnostic's copy, not unrelated user stderr. */
export function isPrimaryErrorOutput(result: ExecutionResult, output: ConsoleOutput): boolean {
  const error = result.error;
  if (!error || output.type !== 'error') return false;
  // Captured console.error calls are independent events even if their text
  // happens to equal a later thrown error. Browser error events are explicit.
  if (output.captureOrder !== undefined && !output.isExecutionError) return false;
  const text = output.args.join(' ').trim();
  if (!text) return false;
  const matches =
    text === error.message.trim() ||
    text === error.stack?.trim() ||
    (output.isExecutionError && error.message.split('\n').some(line => line.trim() === text));
  if (!matches) return false;
  return output.line === undefined || error.line === undefined || output.line === error.line;
}
