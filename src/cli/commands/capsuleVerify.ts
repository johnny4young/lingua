import { rm } from 'node:fs/promises';
import {
  capsuleEngineDivergence,
  capsuleVerificationBlocker,
  compareCapsuleStreams,
  type CapsuleVerdict,
} from '../../shared/capsuleVerification';
import type { RunCapsuleV1 } from '../../shared/runCapsule';
import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import type { CliIo } from '../io';
import { CLI_OUTPUT_PAYLOAD_BYTES, executeCliPlan } from '../runtime/execution';
import { RegressionTargetError, resolveRegressionTarget } from '../runtime/regressionTargets';
import { resolveExecutionTarget } from '../runtime/targets';
import { emitExecution, emitPreflightError } from './run';
import {
  loadCapsule,
  prepareLoadedCapsuleExecution,
  type CapsulePreflightRefusal,
  type ReplayCapsuleArgs,
} from './capsule';
import { renderCliNotice } from '../presentation';

export interface VerifyCapsuleArgs extends ReplayCapsuleArgs {
  targetPath?: string;
  rootDirectory?: string;
  deadline?: number;
}

const label = 'lingua capsule verify';
const preflightFields = { command: 'capsule-verify', verdict: 'inconclusive' };

export async function runVerifyCapsuleCommand(
  args: VerifyCapsuleArgs,
  io: CliIo
): Promise<CliExitCode> {
  const loaded = await loadCapsule(args.filePath, io);
  if (!loaded.ok)
    return emitPreflightError(
      args,
      io,
      loaded.reason,
      loaded.detail ?? 'Capsule validation failed.',
      CLI_EXIT_CODES.userInputError,
      preflightFields,
      label
    );
  return verifyCapsuleBaseline(loaded.value, args, io);
}

function verificationGate(
  capsule: RunCapsuleV1,
  args: VerifyCapsuleArgs
): CapsulePreflightRefusal | null {
  const blocker = capsuleVerificationBlocker(capsule, CLI_OUTPUT_PAYLOAD_BYTES);
  if (blocker) {
    return {
      reason: blocker,
      detail: 'The recording cannot supply a complete successful stdout/stderr baseline.',
      exitCode: CLI_EXIT_CODES.verificationInconclusive,
    };
  }
  const divergence = capsuleEngineDivergence(capsule);
  if (divergence) {
    return {
      reason: divergence,
      detail: `The ${capsule.tab.language} recording came from a different engine than the CLI runtime, so its output is not a comparable baseline.`,
      exitCode: CLI_EXIT_CODES.verificationInconclusive,
    };
  }
  if (args.targetPath !== undefined && capsule.tab.runtimeMode === 'browser-preview') {
    return {
      reason: 'unsupported-runtime-mode',
      detail: 'Browser-preview baselines require a DOM unavailable to the CLI.',
      exitCode: CLI_EXIT_CODES.unsupportedCapability,
    };
  }
  return null;
}

export async function verifyCapsuleBaseline(
  capsule: RunCapsuleV1,
  args: VerifyCapsuleArgs,
  io: CliIo
): Promise<CliExitCode> {
  const { targetPath } = args;
  const prepared = await prepareLoadedCapsuleExecution(capsule, args, io, label, preflightFields, {
    gate: recorded => verificationGate(recorded, args),
    ...(targetPath !== undefined
      ? {
          resolvePlan: async (recorded, env) =>
            resolveExecutionTarget(
              await resolveRegressionTarget(
                args.rootDirectory ?? process.cwd(),
                targetPath,
                recorded.tab.language
              ),
              recorded.input.args ?? [],
              env
            ),
          classifyResolveError: error =>
            error instanceof RegressionTargetError
              ? {
                  reason: 'invalid-regression-target',
                  detail: error.message,
                  exitCode: CLI_EXIT_CODES.userInputError,
                }
              : null,
        }
      : {}),
  });
  if (!prepared.ok) return prepared.exitCode;
  const { env, plan } = prepared;
  const remaining = args.deadline === undefined ? undefined : args.deadline - Date.now();
  if (remaining !== undefined && remaining < 100) {
    await Promise.all(
      (plan.cleanupPaths ?? []).map(file =>
        rm(file, { recursive: true, force: true }).catch(() => {})
      )
    );
    return emitPreflightError(
      args,
      io,
      'suite-budget-exhausted',
      'The total suite execution budget is exhausted.',
      CLI_EXIT_CODES.verificationInconclusive,
      { ...preflightFields, capsuleId: capsule.capsuleId },
      label
    );
  }
  const run = await executeCliPlan(plan, {
    env,
    ...(capsule.input.stdin !== undefined ? { stdin: capsule.input.stdin } : {}),
    ...(remaining !== undefined
      ? { timeoutMs: Math.min(args.timeoutMs ?? 30_000, remaining) }
      : args.timeoutMs !== undefined
        ? { timeoutMs: args.timeoutMs }
        : {}),
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
    sourceMode: targetPath === undefined ? 'captured' : 'current-target',
    ...(targetPath !== undefined ? { target: targetPath } : {}),
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
