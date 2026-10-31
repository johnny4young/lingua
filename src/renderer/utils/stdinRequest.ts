import type { ExecutionResult } from '../types/execution';

type StdinRequest = NonNullable<ExecutionResult['stdinRequest']>;

const MESSAGE_CHARS = 200;

/** Re-applies the shape and length caps to a worker's stdin request, which user code can reach. */
export function sanitizeStdinRequest(value: unknown): StdinRequest {
  const raw = (value ?? {}) as { message?: unknown; line?: unknown };
  const message = typeof raw.message === 'string' ? raw.message.slice(0, MESSAGE_CHARS) : '';
  const line = typeof raw.line === 'number' && Number.isInteger(raw.line) && raw.line > 0 ? raw.line : undefined;
  return line === undefined ? { message } : { message, line };
}

/** Stdin lines as the workers read them: one per line, without a trailing empty one. */
export function splitStdinLines(buffer: string | null | undefined): string[] {
  if (!buffer) return [];
  const lines = buffer.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
