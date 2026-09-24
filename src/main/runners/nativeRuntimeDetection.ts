import { spawnNativeRun } from './spawnNativeRun';

const VERSION_PROBE_TIMEOUT_MS = 5_000;
const VERSION_PROBE_MAX_OUTPUT_BYTES = 64 * 1024;
const VERSION_PROBE_TRUNCATION_MARKER = '\n[Runtime probe output truncated]';

interface NativeRuntimeVersionProbe {
  command: string;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  killEscalationMs: number;
}

export type NativeRuntimeProbe =
  | { version: string }
  | { version: null; reason: 'missing' | 'check-failed' };

/**
 * Run a bounded, cancelable runtime version probe through the same process-tree
 * supervisor used for native execution. Only a missing executable is reported
 * as `missing`; timeouts, cancellation and failing binaries are `check-failed`.
 */
export async function detectNativeRuntimeVersion({
  command,
  env,
  signal,
  killEscalationMs,
}: NativeRuntimeVersionProbe): Promise<NativeRuntimeProbe> {
  const probe = await spawnNativeRun({
    command,
    args: ['--version'],
    env,
    signal,
    timeoutMs: VERSION_PROBE_TIMEOUT_MS,
    killEscalationMs,
    maxOutputBytes: VERSION_PROBE_MAX_OUTPUT_BYTES,
    stdoutTruncationMarker: VERSION_PROBE_TRUNCATION_MARKER,
    stderrTruncationMarker: VERSION_PROBE_TRUNCATION_MARKER,
  });
  if (probe.spawnError && (probe.spawnError as NodeJS.ErrnoException).code === 'ENOENT') {
    return { version: null, reason: 'missing' };
  }
  if (signal?.aborted || probe.spawnError || probe.timedOut || probe.exitCode !== 0) {
    return { version: null, reason: 'check-failed' };
  }
  return { version: probe.stdout.trim() };
}
