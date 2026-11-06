export interface JsWorkerStdinReader {
  consume: () => string | null;
  getCount: () => number;
  getTotal: () => number;
}

export const STDIN_PROMPT_CHARS = 200;

/** Thrown by prompt() / readline() past the end of stdin when the run asks for input inline. */
export class JsWorkerStdinRequest {
  readonly message: string;
  constructor(
    message: unknown,
    readonly line: number | undefined
  ) {
    let text: string;
    try {
      text = message === undefined || message === null ? '' : String(message);
    } catch {
      text = '';
    }
    this.message = text.slice(0, STDIN_PROMPT_CHARS);
  }
}

/** Build the per-run line reader used by prompt() and readline(). */
export function createJsWorkerStdinReader(buffer: string | undefined): JsWorkerStdinReader {
  if (!buffer || buffer.length === 0) {
    return {
      consume: () => null,
      getCount: () => 0,
      getTotal: () => 0,
    };
  }

  const rawLines = buffer.split('\n');
  if (rawLines.length > 0 && rawLines[rawLines.length - 1] === '') {
    rawLines.pop();
  }
  let cursor = 0;
  return {
    consume: () => {
      if (cursor >= rawLines.length) return null;
      const value = rawLines[cursor]!;
      cursor += 1;
      return value;
    },
    getCount: () => cursor,
    getTotal: () => rawLines.length,
  };
}
