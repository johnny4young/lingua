import type {
  SpawnNativeRunOptions,
  SpawnNativeRunResult,
} from '../../src/main/runners/spawnNativeRun';

interface VersionProbeOutput {
  stdout?: string | Buffer;
  stderr?: string | Buffer;
}

type VersionProbe = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeout: number }
) => Promise<VersionProbeOutput>;

type SpawnNativeRun = (
  options: SpawnNativeRunOptions
) => Promise<SpawnNativeRunResult>;

function stoppedProbe(): SpawnNativeRunResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: -1,
    executionTime: 0,
    timedOut: false,
    killed: true,
  };
}

/**
 * Keeps existing runner tests focused on the runtime child while adapting their
 * legacy execFile probe fixtures to the supervised spawnNativeRun contract.
 */
export function mockNativeVersionProbe(
  realSpawnNativeRun: SpawnNativeRun,
  probe: VersionProbe,
  onProbeSignal?: (signal: AbortSignal | undefined) => void
): SpawnNativeRun {
  return options => {
    if (options.args.length !== 1 || options.args[0] !== '--version') {
      return realSpawnNativeRun(options);
    }

    onProbeSignal?.(options.signal);
    if (options.signal?.aborted) return Promise.resolve(stoppedProbe());

    return new Promise(resolve => {
      let settled = false;
      const finish = (result: SpawnNativeRunResult) => {
        if (settled) return;
        settled = true;
        options.signal?.removeEventListener('abort', onAbort);
        resolve(result);
      };
      const onAbort = () => finish(stoppedProbe());
      options.signal?.addEventListener('abort', onAbort, { once: true });

      probe(options.command, options.args, {
        env: options.env,
        timeout: options.timeoutMs,
      }).then(
        output => finish({
          stdout: String(output.stdout ?? ''),
          stderr: String(output.stderr ?? ''),
          exitCode: 0,
          executionTime: 0,
          timedOut: false,
          killed: false,
        }),
        error => finish({
          stdout: '',
          stderr: '',
          exitCode: -1,
          executionTime: 0,
          timedOut: false,
          killed: false,
          spawnError: error instanceof Error ? error : new Error(String(error)),
        })
      );
    });
  };
}
