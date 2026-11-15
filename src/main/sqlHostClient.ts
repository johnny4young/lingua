/** Main's side of a SQL host call: every failure becomes a `SqlHostError` with the detail the renderer reads. */

import { isHostError } from '@electron-stagewright/host-supervisor';
import { SqlHostError } from './sqlHost/hostError';

export { SqlHostError };

/** `stopped` shapes the failure when the supervisor, not the host, ended the call. */
export async function settle<T, Failure extends { message: string } = { message: string }>(
  call: Promise<T>,
  stopped: (message: string) => Failure = message => ({ message }) as Failure
): Promise<T> {
  try {
    return await call;
  } catch (error) {
    if (error instanceof SqlHostError) throw error;
    // Only the supervisor's own failures mean the host went away; anything else keeps its message.
    if (!isHostError(error)) throw new SqlHostError({ message: error instanceof Error ? error.message : String(error) } as Failure);
    throw new SqlHostError(stopped(isHostError(error, 'HOST_CALL_TIMEOUT') ? 'The SQL host did not answer in time.' : 'The SQL host stopped.'));
  }
}
