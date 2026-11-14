/** Main's side of a SQL host reply: unwraps it, or throws its detail as a `SqlHostError`. */

import { isHostError } from '@electron-stagewright/host-supervisor';
import type { HostError, HostReply } from './sqlHost/protocol';

export class SqlHostError<Detail extends { message: string } = HostError> extends Error {
  constructor(readonly detail: Detail) {
    super(detail.message);
    this.name = 'SqlHostError';
  }
}

/** `stopped` shapes the failure when the supervisor, not the host, ended the call. */
export async function settle<T, Failure extends { message: string } = HostError>(
  reply: Promise<HostReply<T, Failure>>,
  stopped: (message: string) => Failure = message => ({ message }) as Failure
): Promise<T> {
  let answer: HostReply<T, Failure>;
  try {
    answer = await reply;
  } catch (error) {
    throw new SqlHostError(stopped(isHostError(error, 'HOST_CALL_TIMEOUT') ? 'The SQL host did not answer in time.' : 'The SQL host stopped.'));
  }
  if (answer.ok) return answer.value;
  throw new SqlHostError(answer.error);
}
