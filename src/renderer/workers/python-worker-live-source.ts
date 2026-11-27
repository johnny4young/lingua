import {
  LIVE_RUN_MAX_LOOPS,
  LIVE_RUN_PROTOCOL_VERSION,
  LIVE_RUN_THROTTLE_MS,
  type LiveRunSnapshot,
} from '../../shared/liveRun';
import { PYTHON_LIVE_REPR_SOURCE } from './python-worker-live-repr-source';
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
import itertools as __lingua_live_itertools
import time as __lingua_live_time

__lingua_live_clock = __lingua_live_time.perf_counter
__lingua_live_enter__ = __lingua_live_itertools.count(1).__next__
__lingua_live_loops = []
__lingua_live_totals = {}
__lingua_live_ordinals = {}
__lingua_live_sized = (list, tuple, range, str, bytes, dict, set, frozenset,
                       type({}.keys()), type({}.values()), type({}.items()))
${PYTHON_LIVE_REPR_SOURCE}

def __lingua_live_of__(name, value):
    __lingua_live_totals[name] = len(value) if type(value) in __lingua_live_sized else None
    return value


def __lingua_live_prepare(tree):
    # Each protected loop starts its body with __lpN += 1: that counter is its pass, and each run of the
    # loop takes a new entry number. Names end in __ so a class body does not mangle them.
    ast = __lingua_live_ast
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and node.id.startswith("__lp") and node.id[4:].isdigit():
            node.id += "__"
    loops = []
    for parent in list(ast.walk(tree)):
        for stmts in (getattr(parent, field, None) for field in ("body", "orelse", "finalbody")):
            for index in range(len(stmts) - 1, -1, -1) if isinstance(stmts, list) else ():
                node = stmts[index]
                first = node.body[0] if isinstance(node, (ast.For, ast.AsyncFor, ast.While)) and node.body else None
                if not (isinstance(first, ast.AugAssign) and isinstance(first.target, ast.Name)
                        and first.target.id.startswith("__lp")):
                    continue
                name, entry = first.target.id, "__lingua_le" + first.target.id[4:]
                target = node.target.id if isinstance(node, (ast.For, ast.AsyncFor)) and isinstance(node.target, ast.Name) else None
                end = max(getattr(stmt, "end_lineno", None) or stmt.lineno for stmt in node.body)
                loops.append((node.lineno, end, name, entry, target))
                if not isinstance(node, ast.While):
                    call = ast.Call(func=ast.Name(id="__lingua_live_of__", ctx=ast.Load()), args=[ast.Constant(value=name), node.iter], keywords=[])
                    node.iter = ast.copy_location(call, node.iter)
                enter = ast.Call(func=ast.Name(id="__lingua_live_enter__", ctx=ast.Load()), args=[], keywords=[])
                stmts.insert(index, ast.copy_location(ast.Assign(targets=[ast.Name(id=entry, ctx=ast.Store())], value=enter), node))
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
    # Open loops around each frame's line, outermost first: (name, header, pass, entry, target, scope, end).
    path = []
    for frame in frames:
        line = frame.f_lineno
        hits = [(head, end, name, entry, target) for head, end, name, entry, target in __lingua_live_loops if head <= line <= end]
        if not hits:
            continue
        scope = frame.f_locals
        for head, end, name, entry, target in hits:
            count = scope.get(name)
            if type(count) is int:
                path.append((name, head, count, scope.get(entry), target, scope, end))
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
    for name, head, count, _entry, target, scope, end in __lingua_live_path(frames)[-${LIVE_RUN_MAX_LOOPS}:]:
        loop = {"line": head, "end": end, "pass": count}
        total = __lingua_live_totals.get(name)
        if total is not None:
            loop["total"] = total
        if target is not None and count > 0 and target in scope:
            value = __lingua_live_repr(scope[target])
            if value is not None:
                loop["binding"] = {"name": target, "value": value}
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
        path = tuple((name, entry, count) for name, _head, count, entry, *_rest in __lingua_live_path(__lingua_live_frames(sys._getframe(1))))
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
  // Each step on its own, so a failing buffer still turns the Python side off.
  const stop = () => {
    for (const step of [() => runtime.setInterruptBuffer?.(undefined), () => runtime.runPython?.('__lingua_live_end()')]) {
      try {
        step();
      } catch {
        // The next run's begin installs the handler again.
      }
    }
  };
  try {
    runtime.setInterruptBuffer(createSampleBuffer(signum, () => performance.now()));
  } catch (error) {
    // Never leave the handler and the pass tags on for later runs.
    stop();
    throw error;
  }
  return stop;
}
