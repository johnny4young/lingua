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

/**
 * Run a bounded, cancelable runtime version probe through the same process-tree
 * supervisor used for native execution. A null result means the command could
 * not be trusted as an installed runtime.
 */
export async function detectNativeRuntimeVersion({
  command,
  env,
  signal,
  killEscalationMs,
}: NativeRuntimeVersionProbe): Promise<string | null> {
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
  if (signal?.aborted || probe.spawnError || probe.timedOut || probe.exitCode !== 0) {
    return null;
  }
  return probe.stdout.trim();
}
