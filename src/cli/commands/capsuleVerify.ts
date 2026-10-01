import {
  capsuleEngineDivergence,
  capsuleVerificationBlocker,
  compareCapsuleStreams,
  type CapsuleVerdict,
} from '../../shared/capsuleVerification';
import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import type { CliIo } from '../io';
import { CLI_OUTPUT_PAYLOAD_BYTES, executeCliPlan } from '../runtime/execution';
import { emitExecution } from './run';
import { prepareCapsuleExecution, type ReplayCapsuleArgs } from './capsule';
import { renderCliNotice } from '../presentation';

export async function runVerifyCapsuleCommand(
  args: ReplayCapsuleArgs,
  io: CliIo
): Promise<CliExitCode> {
  const label = 'lingua capsule verify';
  const prepared = await prepareCapsuleExecution(
    args,
    io,
    label,
    { command: 'capsule-verify', verdict: 'inconclusive' },
    capsule => {
      const blocker = capsuleVerificationBlocker(capsule, CLI_OUTPUT_PAYLOAD_BYTES);
      if (blocker) {
        return {
          reason: blocker,
          detail: 'The recording cannot supply a complete successful stdout/stderr baseline.',
          exitCode: CLI_EXIT_CODES.verificationInconclusive,
        };
      }
      const divergence = capsuleEngineDivergence(capsule);
      return divergence
        ? {
            reason: divergence,
            detail: `The ${capsule.tab.language} recording came from a different engine than the CLI runtime, so its output is not a comparable baseline.`,
            exitCode: CLI_EXIT_CODES.verificationInconclusive,
          }
        : null;
    }
  );
  if (!prepared.ok) return prepared.exitCode;
  const { capsule, env, plan } = prepared;
  const run = await executeCliPlan(plan, {
    env,
    ...(capsule.input.stdin !== undefined ? { stdin: capsule.input.stdin } : {}),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
  });
  const comparison = compareCapsuleStreams(capsule, run);
  const incomplete = Boolean(
    run.truncated?.stdout ||
    run.truncated?.stderr ||
    run.status === 'timeout' ||
    run.status === 'stopped' ||
    run.reason === 'missing-runtime' ||
    run.reason === 'spawn-failed' ||
    run.reason === 'prepare-failed'
  );
  const verdict: CapsuleVerdict = incomplete
    ? 'inconclusive'
    : comparison.matches
      ? 'pass'
      : 'fail';
  const result = {
    ok: verdict === 'pass',
    command: 'capsule-verify',
    capsuleId: capsule.capsuleId,
    sourceMode: 'captured',
    verdict,
    comparison,
    recordedRuntime: capsule.environment.runner,
    actualRuntime: run.runtime,
    ...(incomplete
      ? { reason: run.reason ?? 'incomplete-execution' }
      : run.reason
        ? { reason: run.reason }
        : verdict === 'fail'
          ? { reason: 'output-drift' }
          : {}),
    run,
  };
  if (args.json) io.writeStdout(`${JSON.stringify(result)}\n`);
  else {
    emitExecution(args, io, run, {}, label, true);
    if (!args.quiet) {
      const notice =
        `${label}: ${verdict}${result.reason ? ` (${result.reason})` : ''} ` +
        `(status=${comparison.status}, stdout=${comparison.stdout}, stderr=${comparison.stderr}, ` +
        `recorded=${result.recordedRuntime}, actual=${result.actualRuntime})`;
      io.writeStderr(
        `${renderCliNotice(io, args.color, notice, verdict === 'pass' ? 'success' : 'warning')}\n`
      );
    }
  }
  if (run.status !== 'success')
    return run.reason === 'missing-runtime'
      ? CLI_EXIT_CODES.unsupportedCapability
      : CLI_EXIT_CODES.runtimeError;
  return verdict === 'pass'
    ? CLI_EXIT_CODES.ok
    : verdict === 'fail'
      ? CLI_EXIT_CODES.verificationFailed
      : CLI_EXIT_CODES.verificationInconclusive;
}
