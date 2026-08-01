export interface JsWorkerStdinReader {
  consume: () => string | null;
  getCount: () => number;
  getTotal: () => number;
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
