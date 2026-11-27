// Print entries reach the console while a run goes: a print flushes the pending batch to the
// worker's __lingua_flush_print_entries once 50 ms have passed since the last flush, and so
// does time.sleep(); the rest wait for the end-of-run dump.
export const PYTHON_PRINT_STREAM_SOURCE = `
__lingua_print_count = 0
__lingua_print_flushed_at = float("-inf")
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
    try:
        batch = __lingua_json.dumps(entries)
    except Exception:  # noqa: BLE001 — the end-of-run dump reports it
        return
    for entry in entries:
        entry["_sent"] = True
    entries.clear()
    __lingua_print_flushed_at = __lingua_time.monotonic()
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
    return __lingua_time._lingua_sleep(seconds)


__lingua_time.sleep = __lingua_sleep
`;
