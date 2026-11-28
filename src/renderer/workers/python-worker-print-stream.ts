// Print entries reach the console while a run goes: a print flushes the pending batch to the
// worker's __lingua_flush_print_entries once 50 ms have passed since the last flush, and so
// do time.sleep() and rich media; the rest wait for the next flush or the end-of-run dump.
// With the live signal on, a sleep also reports its line and length before it blocks; a recording
// posts its steps so far.
export const PYTHON_PRINT_STREAM_SOURCE = `
__lingua_print_count = 0
__lingua_print_flushed_at = float("-inf")
__lingua_print_run = object()
import functools as __lingua_functools
import time as __lingua_time
if not hasattr(__lingua_time, "_lingua_sleep"):
    __lingua_time._lingua_sleep = __lingua_time.sleep


def __lingua_flush_prints():
    global __lingua_print_flushed_at
    sink = globals().get("__lingua_flush_print_entries")
    entries = __lingua_print_entries
    if not entries or sink is None:
        return
    # Set first, so a batch that cannot be dumped is retried at most every 50 ms.
    __lingua_print_flushed_at = __lingua_time.monotonic()
    try:
        batch = __lingua_json.dumps(entries)
    except Exception:  # noqa: BLE001 — the end-of-run dump reports it
        return
    for entry in entries:
        entry["_sent"] = True
    entries.clear()
    sink(batch)


def __lingua_push_print_entry(entry):
    global __lingua_print_count
    if __lingua_print_count >= __lingua_print_entries_cap:
        return
    __lingua_print_count += 1
    __lingua_print_entries.append(entry)
    if __lingua_time.monotonic() - __lingua_print_flushed_at >= 0.05:
        __lingua_flush_prints()


@__lingua_functools.wraps(__lingua_time._lingua_sleep)
def __lingua_sleep(seconds):
    __lingua_flush_prints()
    if __lingua_trace_state is not None:
        __lingua_trace_flush()
    if __lingua_live_state is not None:
        __lingua_live_wait(seconds)
    return __lingua_time._lingua_sleep(seconds)


__lingua_time.sleep = __lingua_sleep
`;
