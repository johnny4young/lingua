/**
 * Shared resource limits for the runner pipeline.
 *
 * Two distinct boundaries get distinct caps on purpose:
 *
 *   - **Web Worker -> renderer postMessage volume** (`MAX_STDERR_BYTES`,
 *     `MAX_RESULT_BYTES` in `src/renderer/runners/limits.ts`). The
 *     renderer process holds the worker, the message queue, and the
 *     result panel in the same heap, so we keep these tighter
 *     (256 KiB / 64 KiB) to defend the UI thread against runaway
 *     output.
 *
 *   - **OS subprocess (rustc / native binary / go build) stdout/stderr**
 *     captured in main (`MAX_NATIVE_STDERR_BYTES`,
 *     `MAX_COMPILE_OUTPUT_BYTES` below). The subprocess has its own
 *     heap, and verbose toolchain output is part of normal operation,
 *     so we allow up to 1 MiB before truncating. Bumping these to
 *     1 MiB is a deliberate user-facing decision (RL-079); do not
 *     homogenize them with the renderer-side caps without updating
 *     both surfaces in lockstep.
 *
 * The constants live in `src/shared` so both main and renderer can
 * import them without crossing a process boundary.
 */

/** Cap on aggregated subprocess stderr / stdout captured in main. */
export const MAX_NATIVE_STDERR_BYTES = 1024 * 1024;

/** Cap on toolchain compile output captured in main. */
export const MAX_COMPILE_OUTPUT_BYTES = 1024 * 1024;

/** Cap on compiled Go WASM artifacts before crossing IPC into renderer. */
export const MAX_GO_WASM_BYTES = 10 * 1024 * 1024;

/**
 * Slice `value` to fit in `maxBytes` (UTF-16 code units, matching
 * `String.prototype.length`) and append `marker` so the user can tell
 * the output was clipped. Returns the input unchanged when it already
 * fits. Marker is always appended in full; if `maxBytes` would not
 * leave room for it we still emit at least one source character before
 * the marker so the truncation is unambiguous.
 */
export function truncateBytes(value: string, maxBytes: number, marker: string): string {
  if (value.length <= maxBytes) return value;
  const headroom = Math.max(1, maxBytes - marker.length);
  return `${value.slice(0, headroom)}${marker}`;
}
