import { LIVE_RUN_MAX_LOOPS, LIVE_RUN_PROTOCOL_VERSION, LIVE_RUN_THROTTLE_MS, type LiveRunSnapshot } from '../../shared/liveRun';
import type { PythonWorkerPort } from './python-worker-protocol';
import type { PyodideRuntime } from './python-worker-runtime';

/** How often the interpreter is asked for a sample; posts stay at the throttle. */
const LIVE_SAMPLE_MS = 10;
/** Signal polls between clock reads; a poll comes every 50 loop passes or calls. */
const POLLS_PER_CLOCK_READ = 16;

/**
 * Live run signal for Pyodide, sampled instead of traced. CPython on Emscripten
 * reads `Py_EmscriptenSignalBuffer[0]` every 50 eval-breaker checks; a getter
 * there raises SIGUSR1 every LIVE_SAMPLE_MS, and the handler reads the stack.
 * Loop passes are the loop-protection counters (`__lpN`) in each frame, so a
 * pass costs nothing extra. C code that never reaches the eval breaker is not
 * sampled until it returns.
 */
export const PYTHON_LIVE_SOURCE = `
import ast as __lingua_live_ast
import signal as __lingua_live_signal
import time as __lingua_live_time

__lingua_live_clock = __lingua_live_time.perf_counter
__lingua_live_loops = []
__lingua_live_totals = {}
__lingua_live_ordinals = {}
__lingua_live_sized = (list, tuple, range, str, bytes, dict, set, frozenset,
                       type({}.keys()), type({}.values()), type({}.items()))


def __lingua_live_of(name, value):
    __lingua_live_totals[name] = len(value) if type(value) in __lingua_live_sized else None
    return value


def __lingua_live_prepare(tree):
    # Each protected loop starts its body with __lpN += 1: that counter is its pass.
    ast = __lingua_live_ast
    loops = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.For, ast.AsyncFor, ast.While)) or not node.body:
            continue
        first = node.body[0]
        if not (isinstance(first, ast.AugAssign) and isinstance(first.target, ast.Name)
                and first.target.id.startswith("__lp")):
            continue
        name = first.target.id
        loops.append((node.lineno, max(getattr(stmt, "end_lineno", None) or stmt.lineno for stmt in node.body), name))
        if not isinstance(node, ast.While):
            call = ast.Call(func=ast.Name(id="__lingua_live_of", ctx=ast.Load()),
                            args=[ast.Constant(value=name), node.iter], keywords=[])
            node.iter = ast.copy_location(call, node.iter)
    # Sorted by header, so the loops around a line come outermost first.
    __lingua_live_loops[:] = sorted(loops)
    __lingua_live_totals.clear()
    return ast.fix_missing_locations(tree)


def __lingua_live_frames(frame):
    frames = []
    while frame is not None:
        if frame.f_code.co_filename == "<exec>" and frame.f_lineno:
            frames.append(frame)
        frame = frame.f_back
    frames.reverse()
    return frames


def __lingua_live_path(frames):
    # Open loops around each frame's line, outermost first: (name, header, pass).
    path = []
    for frame in frames:
        line = frame.f_lineno
        hits = [(head, name) for head, end, name in __lingua_live_loops if head <= line <= end]
        if not hits:
            continue
        scope = frame.f_locals
        for head, name in hits:
            count = scope.get(name)
            if type(count) is int:
                path.append((name, head, count))
    return path


def __lingua_live_sample(frame, wait=None):
    state = __lingua_live_state
    if state is None:
        return
    now = __lingua_live_clock()
    frames = __lingua_live_frames(frame)
    if not frames:
        return
    line = frames[-1].f_lineno
    if line != state[0]:
        state[0] = line
        state[1] = now
    if wait is None and now - state[2] < ${LIVE_RUN_THROTTLE_MS / 1000}:
        return
    state[2] = now
    loops = []
    for name, head, count in __lingua_live_path(frames)[-${LIVE_RUN_MAX_LOOPS}:]:
        loop = {"line": head, "pass": count}
        total = __lingua_live_totals.get(name)
        if total is not None:
            loop["total"] = total
        loops.append(loop)
    snapshot = {"line": line, "lineMs": (now - state[1]) * 1000, "elapsedMs": (now - state[3]) * 1000, "loops": loops}
    if wait is not None:
        snapshot["waitMs"] = wait * 1000
    __lingua_post_live(__lingua_json.dumps(snapshot))


def __lingua_live_on_signal(signum, frame):
    try:
        __lingua_live_sample(frame)
    except Exception:  # noqa: BLE001 — a sample never reaches user code
        pass


def __lingua_live_wait(seconds):
    if __lingua_live_state is None or type(seconds) not in (int, float) or seconds < ${LIVE_RUN_THROTTLE_MS / 1000}:
        return
    try:
        __lingua_live_sample(sys._getframe(1), seconds)
    except Exception:  # noqa: BLE001
        pass


def __lingua_live_pass():
    # Same pass of the same loops, same number; 0 outside every loop.
    try:
        path = tuple((name, count) for name, _head, count in __lingua_live_path(__lingua_live_frames(sys._getframe(1))))
    except Exception:  # noqa: BLE001
        return None
    if not path:
        return 0
    return __lingua_live_ordinals.setdefault(path, len(__lingua_live_ordinals) + 1)


def __lingua_live_begin():
    global __lingua_live_state, __lingua_live_previous
    now = __lingua_live_clock()
    __lingua_live_ordinals.clear()
    __lingua_live_state = [0, now, now, now]
    __lingua_live_previous = __lingua_live_signal.signal(__lingua_live_signal.SIGUSR1, __lingua_live_on_signal)
    return int(__lingua_live_signal.SIGUSR1)


def __lingua_live_end():
    global __lingua_live_state
    __lingua_live_state = None
    __lingua_live_signal.signal(__lingua_live_signal.SIGUSR1, __lingua_live_previous or __lingua_live_signal.SIG_DFL)
`;

type LiveRuntime = PyodideRuntime & { setInterruptBuffer?: (buffer: unknown) => void };

/** Raises `signum` once per LIVE_SAMPLE_MS when the interpreter polls for signals. */
function createSampleBuffer(signum: number, now: () => number): { 0: number } {
  let next = now() + LIVE_SAMPLE_MS;
  let polls = 0;
  return {
    get 0() {
      if (++polls < POLLS_PER_CLOCK_READ) return 0;
      polls = 0;
      const at = now();
      if (at < next) return 0;
      next = at + LIVE_SAMPLE_MS;
      return signum;
    },
    set 0(_cleared: number) {},
  };
}

/** Interpreters that already hold the live helpers; they persist across runs. */
const prepared = new WeakSet<object>();

/** Starts sampling for one run; the returned stop must run before the next one. */
export async function startPythonLive(py: PyodideRuntime, port: PythonWorkerPort, runId: string): Promise<(() => void) | null> {
  const runtime = py as LiveRuntime;
  if (typeof runtime.setInterruptBuffer !== 'function' || typeof runtime.runPython !== 'function') return null;
  // The renderer checks the snapshot, as it does every worker reply.
  py.globals.set('__lingua_post_live', (json: string) =>
    port.postMessage({ type: 'live-line', runId, v: LIVE_RUN_PROTOCOL_VERSION, live: JSON.parse(json) as LiveRunSnapshot })
  );
  if (!prepared.has(py)) {
    await py.runPythonAsync(PYTHON_LIVE_SOURCE, { filename: '<lingua-live>' });
    prepared.add(py);
  }
  const signum = Number(runtime.runPython('__lingua_live_begin()'));
  runtime.setInterruptBuffer(createSampleBuffer(signum, () => performance.now()));
  return () => {
    runtime.setInterruptBuffer?.(undefined);
    try {
      runtime.runPython?.('__lingua_live_end()');
    } catch {
      // The next run's begin installs the handler again.
    }
  };
}
