/** Reads, then clears, the request the patched input() left on sys; exception text alone never counts. */
export const PYTHON_TAKE_STDIN_REQUEST_SOURCE = `
import sys
__lingua_taken = getattr(sys, "_lingua_stdin_request", None)
sys._lingua_stdin_request = None
__lingua_taken
`;

/** The prompt an `input()` past the end of stdin stopped at, from the JSON the patched input() stored. */
export function parsePythonStdinRequest(payload: unknown): { message: string; line?: number } | null {
  if (typeof payload !== 'string') return null;
  try {
    const parsed = JSON.parse(payload) as { message?: unknown; line?: unknown };
    const message = typeof parsed.message === 'string' ? parsed.message : '';
    return typeof parsed.line === 'number' && Number.isInteger(parsed.line) && parsed.line > 0 ? { message, line: parsed.line } : { message };
  } catch {
    return null;
  }
}

// Run regions: input() past the end of stdin stops the run with the prompt and its line,
// as a BaseException so a user's except Exception does not swallow it.
export const PYTHON_ASK_STDIN_SOURCE = `
sys._lingua_stdin_request = None


class __LinguaStdinRequest(BaseException):
    pass


def __lingua_input(prompt=""):
    text = "" if prompt is None else str(prompt)
    sys.stdout.write(text)
    line = sys.stdin.readline()
    if line == "":
        sys._lingua_stdin_request = __lingua_json.dumps({"message": text[:200], "line": __lingua_caller_line()})
        raise __LinguaStdinRequest()
    return line[:-1] if line.endswith("\\n") else line


globals()["input"] = __lingua_input
`;

// The worker keeps its globals between runs, so a later run without regions gets the stock input() back.
export const PYTHON_RESTORE_INPUT_SOURCE = `
if getattr(globals().get("input"), "__name__", "") == "__lingua_input":
    del globals()["input"]
`;
