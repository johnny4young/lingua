/**
 * The one request shape the HTTP engines send. The desktop SQL host sends it
 * to the address main pinned; the browser sends it with fetch.
 */

import type { SqlColumnMetadata } from '../sqlWorkspace';
import type { DriverRows } from '../sqlDriver';
import { SqlConnectError } from '../sqlDriver';

export interface HttpSqlRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
}

export interface HttpSqlResponse {
  status: number;
  body: string;
}

export type HttpSqlTransport = (request: HttpSqlRequest) => Promise<HttpSqlResponse>;

/** The engines send a whole result at once, so a larger answer is refused before it is parsed. */
export const MAX_HTTP_SQL_RESPONSE_BYTES = 64 * 1024 * 1024;

export const responseTooLarge = () =>
  new Error(`The answer is larger than ${MAX_HTTP_SQL_RESPONSE_BYTES / (1024 * 1024)} MB, which this engine sends whole. Add a LIMIT to read it in parts.`);

/** An engine's own error, with its code when it gives one. */
export class HttpSqlError extends Error {
  constructor(
    message: string,
    readonly code?: string
  ) {
    super(message);
  }
}

const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError';

/**
 * Sends one request, turning a refused credential into an auth failure and an
 * aborted request into a cancelled run.
 */
export async function send(transport: HttpSqlTransport, request: HttpSqlRequest): Promise<HttpSqlResponse> {
  let response: HttpSqlResponse;
  try {
    response = await transport(request);
  } catch (err) {
    if (isAbort(err)) throw new Error('Query cancelled', { cause: err });
    throw err;
  }
  if (response.status === 401 || response.status === 403) {
    throw new SqlConnectError(`Authentication failed (HTTP ${response.status}): ${summary(response.body)}`, { step: 'auth', fix: 'auth' });
  }
  return response;
}

/** The start of a server's answer, for an error message. */
export const summary = (body: string) => body.replace(/\s+/g, ' ').trim().slice(0, 300) || 'no details';

export function parseJson<T>(response: HttpSqlResponse): T {
  try {
    return JSON.parse(response.body) as T;
  } catch {
    throw new HttpSqlError(`The server answered HTTP ${response.status} with something other than JSON: ${summary(response.body)}`);
  }
}

/** Rows an engine already sent in full, read in pages. */
export function wholeRows(columns: SqlColumnMetadata[], rows: Array<Record<string, unknown>>, affectedRows?: number): DriverRows {
  let left = rows;
  return {
    columns,
    ...(affectedRows !== undefined ? { affectedRows } : {}),
    async next(limit) {
      const page = left.slice(0, limit);
      left = left.slice(page.length);
      return { rows: page, done: left.length === 0 };
    },
    async close() {
      left = [];
    },
  };
}

/** Requests in flight on one session, so Cancel can abort them. */
export function inflight() {
  const controllers = new Set<AbortController>();
  return {
    async run<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
      const controller = new AbortController();
      controllers.add(controller);
      try {
        return await work(controller.signal);
      } finally {
        controllers.delete(controller);
      }
    },
    cancel(): void {
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },
  };
}

/** Column names keyed onto each row's values. */
export const rowObject = (names: string[], values: unknown[]) => Object.fromEntries(names.map((name, index) => [name, values[index]]));
