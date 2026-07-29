import type * as AutoRunExecutionModule from './autoRunExecution';

let autoRunExecutionPromise: Promise<typeof AutoRunExecutionModule> | null = null;

/**
 * Load the execution engine only after Scratchpad accepts a debounced input.
 *
 * Keeping the promise makes subsequent edits reuse the resolved module while
 * preserving a real dynamic-import boundary for the initial renderer graph.
 */
export function loadAutoRunExecution(): Promise<typeof AutoRunExecutionModule> {
  autoRunExecutionPromise ??= import('./autoRunExecution');
  return autoRunExecutionPromise;
}
