const STDIN_REQUEST = /__LinguaStdinRequest: (\{.*\})\s*$/;

/** The prompt an `input()` past the end of stdin stopped at, read back from the traceback. */
export function parsePythonStdinRequest(errorText: string): { message: string; line?: number } | null {
  const match = STDIN_REQUEST.exec(errorText);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]!) as { message?: unknown; line?: unknown };
    const message = typeof parsed.message === 'string' ? parsed.message : '';
    return typeof parsed.line === 'number' && Number.isInteger(parsed.line) && parsed.line > 0 ? { message, line: parsed.line } : { message };
  } catch {
    return null;
  }
}

// Run regions: input() past the end of stdin stops the run with the prompt and its line,
// as a BaseException so a user's except Exception does not swallow it.
export const PYTHON_ASK_STDIN_SOURCE = `
class __LinguaStdinRequest(BaseException):
    pass


def __lingua_input(prompt=""):
    text = "" if prompt is None else str(prompt)
    sys.stdout.write(text)
    line = sys.stdin.readline()
    if line == "":
        raise __LinguaStdinRequest(__lingua_json.dumps({"message": text[:200], "line": __lingua_caller_line()}))
    return line[:-1] if line.endswith("\\n") else line


globals()["input"] = __lingua_input
`;

// The worker keeps its globals between runs, so a later run without regions gets the stock input() back.
export const PYTHON_RESTORE_INPUT_SOURCE = `
if getattr(globals().get("input"), "__name__", "") == "__lingua_input":
    del globals()["input"]
`;
