/** A SQL failure with the detail the renderer needs; it crosses the process boundary as the error's `data`. */

import type { SerializedError } from '@electron-stagewright/host-supervisor';

export class SqlHostError<Detail extends { message: string } = { message: string }> extends Error {
  constructor(readonly detail: Detail) {
    super(detail.message);
    this.name = 'SqlHostError';
  }
}

/** For `serveHost`: what a host sends with a thrown error. */
export const SQL_HOST_ERROR_DETAIL = {
  data: (error: unknown) => (error instanceof SqlHostError ? error.detail : undefined),
};

/** For `createHost`: rebuilds the host's `SqlHostError` in main. */
export function reviveSqlHostError(serialized: SerializedError): Error | undefined {
  const data = serialized.data as { message?: unknown } | undefined;
  return serialized.name === 'SqlHostError' && typeof data?.message === 'string' ? new SqlHostError(data as { message: string }) : undefined;
}
