/** Test view of a host or engine handler: each failure as a value, with the detail main reads. */

import { SqlHostError } from '../../src/main/sqlHost/hostError';

export type Reply<T = unknown> = { ok: true; value: T } | { ok: false; error: { message: string } & Record<string, unknown> };

export async function asReply<T>(call: Promise<T>): Promise<Reply<T>> {
  try {
    return { ok: true, value: await call };
  } catch (error) {
    return { ok: false, error: error instanceof SqlHostError ? error.detail : { message: error instanceof Error ? error.message : String(error) } };
  }
}

type Handler = { handle: (request: never, signal?: AbortSignal) => Promise<unknown> };

export type Replying<H extends Handler> = Omit<H, 'handle'> & { handle: <T = unknown>(request: Parameters<H['handle']>[0], signal?: AbortSignal) => Promise<Reply<T>> };

export function withReplies<H extends Handler>(handler: H): Replying<H> {
  return { ...handler, handle: <T = unknown>(request: Parameters<H['handle']>[0], signal?: AbortSignal) => asReply(handler.handle(request, signal) as Promise<T>) };
}
