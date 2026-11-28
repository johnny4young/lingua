import {
  TIMELINE_MAX_FRAMES,
  TIMELINE_MAX_STEPS,
  TIMELINE_MAX_VALUE_CHARS,
  TIMELINE_MAX_VARS,
  TIMELINE_PROGRESS_MS,
  TIMELINE_VALUE_MAX_CHARS,
  sanitizeTimeline,
  type ExecutionTimeline,
} from '../../shared/timeline';
import type { PythonWorkerPort } from './python-worker-protocol';
import type { PyodideRuntime } from './python-worker-runtime';

/**
 * Record run for Pyodide: a sys.monitoring LINE callback keeps one step per line
 * the user's code reaches, in the JS recorder's shape. Only recorded runs turn the
 * events on, and they go off before the run's results are read. Generators,
 * coroutines and lambdas get no steps, as in the JS recorder; the module always does.
 */
export const PYTHON_TRACE_SOURCE = `
import ast as __lingua_trace_ast
import dis as __lingua_trace_dis
import sys as __lingua_trace_sys
import time as __lingua_trace_time
import types as __lingua_trace_types

__lingua_trace_mon = __lingua_trace_sys.monitoring
__lingua_trace_clock = __lingua_trace_time.perf_counter
__lingua_trace_seq = (list, tuple, set, frozenset)
__lingua_trace_reprs = (int, float, complex, bool, range, type(None))
__lingua_trace_logs = {"info": 1, "log": 2, "warn": 3, "error": 4}
# Pyodide turns a final expression into this raise, with the template's line 1 positions; those instructions are not the user's.
__lingua_trace_template = frozenset(
    (node.lineno, node.col_offset, node.end_col_offset)
    for node in __lingua_trace_ast.walk(__lingua_trace_ast.parse("raise ___EvalCodeResultException[0](x)"))
    if hasattr(node, "lineno")
)


def __lingua_trace_injected(state, code):
    # From the template's load to its raise, so a user line 1 that spans the same columns still counts.
    found = state["injected"].get(code)
    if found is None:
        found = set()
        inside = False
        for instruction in __lingua_trace_dis.get_instructions(code) if "___EvalCodeResultException" in code.co_names else ():
            inside = inside or instruction.argval == "___EvalCodeResultException"
            place = instruction.positions
            if inside and place and (place.lineno, place.col_offset, place.end_col_offset) in __lingua_trace_template:
                found.add(instruction.offset)
            if inside and instruction.opname == "RAISE_VARARGS":
                inside = False
        state["injected"][code] = found
    return found


def __lingua_trace_clip(text):
    return text if len(text) <= ${TIMELINE_VALUE_MAX_CHARS} else text[:${TIMELINE_VALUE_MAX_CHARS - 1}] + "…"


def __lingua_trace_preview(value, depth=0):
    # Builtin values read by their own repr; anything else by its type name, so no user code runs.
    kind = type(value)
    if kind in __lingua_trace_reprs:
        try:
            return __lingua_trace_clip(repr(value))
        except ValueError:
            return "<int>"
    if kind is str or kind is bytes:
        return __lingua_trace_clip(repr(value[:${TIMELINE_VALUE_MAX_CHARS}]))
    if kind is dict or kind in __lingua_trace_seq:
        empty = {dict: "{}", list: "[]", tuple: "()", set: "set()", frozenset: "frozenset()"}[kind]
        if not value:
            return empty
        if depth >= 2:
            return "[…]" if kind is list else "(…)" if kind is tuple else "{…}"
        parts = []
        size = 0
        for item in (value.items() if kind is dict else value):
            if size > ${TIMELINE_VALUE_MAX_CHARS}:
                parts.append("…")
                break
            part = (__lingua_trace_preview(item[0], depth + 1) + ": " + __lingua_trace_preview(item[1], depth + 1)
                    if kind is dict else __lingua_trace_preview(item, depth + 1))
            parts.append(part)
            size += len(part) + 2
        body = ", ".join(parts)
        if kind is list:
            return __lingua_trace_clip("[" + body + "]")
        if kind is tuple:
            return __lingua_trace_clip("(" + body + ("," if len(value) == 1 else "") + ")")
        if kind is frozenset:
            return __lingua_trace_clip("frozenset({" + body + "})")
        return __lingua_trace_clip("{" + body + "}")
    try:
        return "<" + __lingua_trace_clip(str(kind.__name__)) + ">"
    except Exception:  # noqa: BLE001
        return "<object>"


def __lingua_trace_guard(node):
    # The loop protection's own statements: __lpN = 0, __lpN += 1 and if __lpN > max: raise.
    ast = __lingua_trace_ast
    target = node.targets[0] if isinstance(node, ast.Assign) else node.target if isinstance(node, ast.AugAssign) else None
    if isinstance(node, ast.If) and isinstance(node.test, ast.Compare):
        target = node.test.left
    return isinstance(target, ast.Name) and target.id.startswith("__lp")


def __lingua_trace_read(source):
    # The statement that owns each line, as JS records a statement once however many lines it spans; the
    # loop guard's lines; the body lines of every loop by its header; and the lines each module-level
    # name is bound on (names inside functions, classes and comprehensions stay theirs).
    ast = __lingua_trace_ast
    tree = ast.parse(source)
    loops = {}
    owner = {}
    guards = set()
    statements = sorted((node for node in ast.walk(tree) if isinstance(node, ast.stmt)), key=lambda node: node.lineno)
    for node in statements:
        if __lingua_trace_guard(node):
            guards.add(node.lineno)
        body = getattr(node, "body", None)
        last = body[0].lineno - 1 if isinstance(body, list) and body else (node.end_lineno or node.lineno)
        for line in range(node.lineno, max(node.lineno, last) + 1):
            owner[line] = node.lineno
        if isinstance(node, (ast.For, ast.AsyncFor, ast.While)) and node.body:
            loops[node.lineno] = max(stmt.end_lineno or stmt.lineno for stmt in node.body)
    first = {}
    binds = {}
    scoped = (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
    pending = list(ast.iter_child_nodes(tree))
    while pending:
        node = pending.pop()
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store) and not node.id.startswith("__"):
            first[node.id] = min(first.get(node.id, node.lineno), node.lineno)
            binds.setdefault(node.id, set()).add(owner.get(node.lineno, node.lineno))
        if not isinstance(node, scoped):
            pending.extend(ast.iter_child_nodes(node))
    return tuple(sorted(first, key=lambda name: (first[name], name))), binds, loops, owner, frozenset(guards)


def __lingua_trace_traced(state, code):
    # Not generators (0x20), coroutines (0x80, 0x100) or async generators (0x200): their bodies interleave.
    traced = state["traced"].get(code)
    if traced is None:
        traced = state["traced"][code] = code.co_filename == "<exec>" and (
            code.co_name == "<module>" or not (code.co_flags & 0x3A0 or code.co_name == "<lambda>")
        )
    return traced


def __lingua_trace_ms(state, at):
    # Run time without the recorder's own time.
    return max(0.0, (at - state["start"] - state["overhead"]) * 1000)


def __lingua_trace_forget(state):
    # A finished call's frame address can come back for a later call.
    state["previous"].pop(state["calls"].pop(id(__lingua_trace_sys._getframe(2)), None), None)


def __lingua_trace_stop(state):
    state["truncated"] = True
    __lingua_trace_mon.set_events(state["tool"], 0)


def __lingua_trace_vars(state, code, frame, line):
    scope = frame.f_locals
    if code.co_name == "<module>":
        # Globals outlive a run: a name shows once a line binding it ran, or once it holds another
        # object than when the run began (a global set in a function, an import), never the last run's value.
        binds = state["binds"]
        baseline = state["baseline"]
        ran = state["ran"]
        names = [
            name for name in (*state["module_names"], *(name for name in scope if name not in binds and not name.startswith("__")))
            if (name in binds and not ran.isdisjoint(binds[name])) or baseline.get(name, baseline) is not scope.get(name, baseline)
        ]
        ran.add(line)
    elif code.co_flags & 1:
        names = state["locals"].get(code)
        if names is None:
            names = state["locals"][code] = tuple(name for name in dict.fromkeys(code.co_varnames + code.co_cellvars + code.co_freevars) if not name.startswith("__"))
    else:
        names = [name for name in scope if not name.startswith("__")]
    found = []
    for name in names:
        if len(found) >= ${TIMELINE_MAX_VARS}:
            break
        try:
            value = scope[name]
        except KeyError:
            continue
        if callable(value) or type(value) is __lingua_trace_types.ModuleType:
            continue
        found.append([name, __lingua_trace_preview(value)])
    return found


def __lingua_trace_line(code, line):
    state = __lingua_trace_state
    if state is None:
        return None
    if line in state["skip"] or not __lingua_trace_traced(state, code):
        return __lingua_trace_mon.DISABLE
    entered = __lingua_trace_clock()
    try:
        top = __lingua_trace_sys._getframe(1)
        # A one-line program's expression shares line 1 with the template and gets no later LINE event.
        if top.f_lasti in __lingua_trace_injected(state, code) and (line != 1 or id(top) in state["calls"]):
            return __lingua_trace_mon.DISABLE
        owner = state["owner"]
        line = owner.get(line, line)
        calls = state["calls"]
        call = calls.get(id(top))
        if call is None:
            call = calls[id(top)] = state["next_call"]
            state["next_call"] += 1
        previous = state["previous"].get(call)
        if previous == line:
            return None
        # A loop header runs again before each pass, as JS records a loop once: passes start in the body.
        body_end = state["loops"].get(line)
        state["previous"][call] = line
        if body_end is not None and previous is not None and line < previous <= body_end:
            return None
        steps = state["steps"]
        if len(steps) >= ${TIMELINE_MAX_STEPS}:
            __lingua_trace_stop(state)
            return None
        frames = []
        frame = top
        while frame is not None:
            if __lingua_trace_traced(state, frame.f_code):
                frames.append(frame)
            frame = frame.f_back
        frames.reverse()
        found = __lingua_trace_vars(state, code, top, line)
        kept = [{"name": item.f_code.co_name, "line": line if item is top else owner.get(item.f_lineno, item.f_lineno)} for item in frames[-${TIMELINE_MAX_FRAMES}:]]
        state["chars"] += sum(len(name) + len(value) for name, value in found) + sum(len(item["name"]) for item in kept)
        if state["chars"] > ${TIMELINE_MAX_VALUE_CHARS}:
            __lingua_trace_stop(state)
            return None
        steps.append({"line": line, "frames": kept, "vars": found, "depth": max(0, len(frames) - 1), "call": call, "ms": __lingua_trace_ms(state, entered)})
        if entered - state["flushed"] >= ${TIMELINE_PROGRESS_MS / 1000}:
            __lingua_trace_flush()
    except Exception:  # noqa: BLE001 — the recorder never raises into user code
        __lingua_trace_stop(state)
    finally:
        state["overhead"] += __lingua_trace_clock() - entered
    return None


def __lingua_trace_exit(code, offset, value):
    state = __lingua_trace_state
    if state is None:
        return None
    if not __lingua_trace_traced(state, code):
        return __lingua_trace_mon.DISABLE
    __lingua_trace_forget(state)
    return None


def __lingua_trace_unwind(code, offset, exception):
    state = __lingua_trace_state
    if state is not None and __lingua_trace_traced(state, code):
        __lingua_trace_forget(state)


def __lingua_trace_flush():
    state = __lingua_trace_state
    if state is None or state["sent"] >= len(state["steps"]):
        return
    now = __lingua_trace_clock()
    start = state["sent"]
    state["sent"] = len(state["steps"])
    state["flushed"] = now
    try:
        __lingua_post_trace(__lingua_json.dumps({"steps": state["steps"][start:], "ms": __lingua_trace_ms(state, now)}))
    except Exception:  # noqa: BLE001 — the final timeline still carries every step
        pass


def __lingua_trace_log(method):
    state = __lingua_trace_state
    if state is None or not state["steps"]:
        return
    step = state["steps"][-1]
    mark = method if method in __lingua_trace_logs else "log"
    if __lingua_trace_logs[mark] > __lingua_trace_logs.get(step.get("log"), 0):
        step["log"] = mark


def __lingua_trace_begin(source, namespace):
    global __lingua_trace_state
    mon = __lingua_trace_mon
    tool = next((tool for tool in (4, 3) if mon.get_tool(tool) is None), None)
    if tool is None:
        return False
    names, binds, loops, owner, skip = __lingua_trace_read(source)
    mon.use_tool_id(tool, "lingua-record")
    events = mon.events
    mon.register_callback(tool, events.LINE, __lingua_trace_line)
    mon.register_callback(tool, events.PY_RETURN, __lingua_trace_exit)
    mon.register_callback(tool, events.PY_UNWIND, __lingua_trace_unwind)
    now = __lingua_trace_clock()
    __lingua_trace_state = {
        "tool": tool, "start": now, "overhead": 0.0, "flushed": now, "steps": [], "sent": 0, "chars": 0,
        "truncated": False, "skip": skip, "traced": {}, "calls": {}, "next_call": 0, "previous": {},
        "module_names": names, "binds": binds, "baseline": dict(namespace), "loops": loops, "owner": owner, "ran": set(), "locals": {}, "injected": {},
    }
    mon.set_events(tool, events.LINE | events.PY_RETURN | events.PY_UNWIND)
    return True


def __lingua_trace_end(error):
    global __lingua_trace_state
    state = __lingua_trace_state
    if state is None:
        return None
    ms = __lingua_trace_ms(state, __lingua_trace_clock())
    __lingua_trace_state = None
    mon = __lingua_trace_mon
    mon.set_events(state["tool"], 0)
    for event in (mon.events.LINE, mon.events.PY_RETURN, mon.events.PY_UNWIND):
        mon.register_callback(state["tool"], event, None)
    mon.free_tool_id(state["tool"])
    steps = state["steps"]
    if error and steps:
        steps[-1]["error"] = True
    return __lingua_json.dumps({"steps": steps, "truncated": state["truncated"], "ms": ms})
`;

/** Interpreters that already hold the recorder; it persists across runs. */
const prepared = new WeakSet<object>();

/**
 * Starts recording `code` for one run, posting steps while it goes. The returned
 * stop must run before the run's results are read; it posts the whole `timeline`.
 */
export async function startPythonTrace(
  py: PyodideRuntime,
  port: PythonWorkerPort,
  runId: string,
  code: string
): Promise<((error: boolean) => void) | null> {
  // Its own filename keeps the recorder's calls out of the recording.
  const run = py.runPython?.bind(py) as ((source: string, options?: { filename?: string }) => unknown) | undefined;
  if (!run) return null;
  const runPython = (source: string) => run(source, { filename: '<lingua-trace>' });
  py.globals.set('__lingua_post_trace', (json: string) => {
    const progress = JSON.parse(json) as { steps: unknown; ms: number };
    port.postMessage({ type: 'timeline-steps', runId, steps: progress.steps as ExecutionTimeline['steps'], ms: progress.ms });
  });
  if (!prepared.has(py)) {
    await py.runPythonAsync(PYTHON_TRACE_SOURCE, { filename: '<lingua-trace>' });
    prepared.add(py);
  }
  // A JSON string is a Python string literal too.
  if (runPython(`__lingua_trace_begin(${JSON.stringify(code)}, globals())`) !== true) return null;
  return error => {
    try {
      const json = runPython(`__lingua_trace_end(${error ? 'True' : 'False'})`);
      const timeline = typeof json === 'string' ? sanitizeTimeline(JSON.parse(json)) : undefined;
      if (timeline) port.postMessage({ type: 'timeline', runId, timeline });
    } catch {
      // A timeline that cannot be read or posted is dropped, so `done` still follows.
    }
  };
}
