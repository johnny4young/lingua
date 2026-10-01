import { computeContentHash } from '../../shared/runCapsule';
import {
  capsuleVerificationBlocker,
  compareCapsuleStreams,
  type CapsuleVerdict,
} from '../../shared/capsuleVerification';
import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import type { CliIo } from '../io';
import { CliEnvironmentError, buildCliRuntimeEnvironment } from '../runtime/environment';
import { executeCliPlan } from '../runtime/execution';
import { ExecutionTargetError, resolveCapsuleSource } from '../runtime/targets';
import { emitPreflightError } from './run';
import { loadCapsule, type ReplayCapsuleArgs } from './capsule';
import { renderCliNotice } from '../presentation';

export async function runVerifyCapsuleCommand(
  args: ReplayCapsuleArgs,
  io: CliIo
): Promise<CliExitCode> {
  const label = 'lingua capsule verify';
  const fail = (reason: string, detail: string, code: CliExitCode) =>
    emitPreflightError(
      args,
      io,
      reason,
      detail,
      code,
      { command: 'capsule-verify', verdict: 'inconclusive' },
      label
    );
  const loaded = await loadCapsule(args.filePath, io);
  if (!loaded.ok)
    return fail(
      loaded.reason,
      loaded.detail ?? 'Capsule validation failed.',
      CLI_EXIT_CODES.userInputError
    );
  const capsule = loaded.value;
  if ((await computeContentHash(capsule.source.content)) !== capsule.source.contentHash)
    return fail(
      'content-hash-mismatch',
      'Recorded source hash differs; refusing execution.',
      CLI_EXIT_CODES.userInputError
    );
  const blocker = capsuleVerificationBlocker(capsule);
  if (blocker)
    return fail(
      blocker,
      'The recording cannot supply a complete successful stdout/stderr baseline.',
      CLI_EXIT_CODES.verificationInconclusive
    );
  let env: NodeJS.ProcessEnv;
  try {
    env = buildCliRuntimeEnvironment(args.env);
  } catch (error) {
    return fail(
      error instanceof CliEnvironmentError ? error.reason : 'environment-resolution-failed',
      'Could not resolve the explicit runtime environment.',
      CLI_EXIT_CODES.userInputError
    );
  }
  let plan;
  try {
    plan = await resolveCapsuleSource(
      {
        language: capsule.tab.language,
        runtimeMode: capsule.tab.runtimeMode,
        source: capsule.source.content,
        capsuleId: capsule.capsuleId,
      },
      capsule.input.args ?? [],
      env
    );
  } catch (error) {
    return fail(
      error instanceof ExecutionTargetError ? error.reason : 'target-resolution-failed',
      error instanceof Error ? error.message : 'Target resolution failed.',
      error instanceof ExecutionTargetError
        ? CLI_EXIT_CODES.unsupportedCapability
        : CLI_EXIT_CODES.internal
    );
  }
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
  else if (!args.quiet)
    io.writeStdout(
      `${renderCliNotice(io, args.color, `${label}: ${verdict} (recorded=${result.recordedRuntime}, actual=${result.actualRuntime})`, verdict === 'pass' ? 'success' : 'warning')}\n`
    );
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
