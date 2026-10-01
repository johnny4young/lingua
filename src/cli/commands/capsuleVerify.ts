import { rm } from 'node:fs/promises';
import {
  capsuleStrictVerificationRefusal,
  compareCapsuleStreams,
  type CapsuleVerdict,
} from '../../shared/capsuleVerification';
import { MAX_REGRESSION_SUITE_BYTES } from '../../shared/capsuleRegressionSuite';
import type { RunCapsuleV1 } from '../../shared/runCapsule';
import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import type { CliIo } from '../io';
import {
  DEFAULT_CLI_RUN_TIMEOUT_MS,
  MIN_CLI_RUN_TIMEOUT_MS,
  executeCliPlan,
} from '../runtime/execution';
import { RegressionTargetError, readRegressionTarget } from '../runtime/regressionTargets';
import { resolveCapsuleSource } from '../runtime/targets';
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

const refusalDetails: Record<string, { detail: string; exitCode: CliExitCode }> = {
  'engine-divergent-baseline': {
    detail:
      'The recording came from a different engine than the CLI runtime, so its output is not a comparable baseline.',
    exitCode: CLI_EXIT_CODES.verificationInconclusive,
  },
  'unsupported-runtime-mode': {
    detail: 'Browser-preview baselines require a DOM unavailable to the CLI.',
    exitCode: CLI_EXIT_CODES.unsupportedCapability,
  },
};

function verificationGate(capsule: RunCapsuleV1): CapsulePreflightRefusal | null {
  const reason = capsuleStrictVerificationRefusal(capsule);
  if (!reason) return null;
  return {
    reason,
    ...(refusalDetails[reason] ?? {
      detail: 'The recording cannot supply a complete successful stdout/stderr baseline.',
      exitCode: CLI_EXIT_CODES.verificationInconclusive,
    }),
  };
}

export async function verifyCapsuleBaseline(
  capsule: RunCapsuleV1,
  args: VerifyCapsuleArgs,
  io: CliIo
): Promise<CliExitCode> {
  const { targetPath } = args;
  const prepared = await prepareLoadedCapsuleExecution(capsule, args, io, label, preflightFields, {
    gate: verificationGate,
    ...(targetPath !== undefined
      ? {
          resolvePlan: async (recorded, env) =>
            resolveCapsuleSource(
              {
                language: recorded.tab.language,
                runtimeMode: recorded.tab.runtimeMode,
                source: await readRegressionTarget(
                  args.rootDirectory ?? process.cwd(),
                  targetPath,
                  recorded.tab.language,
                  MAX_REGRESSION_SUITE_BYTES
                ),
                capsuleId: recorded.capsuleId,
              },
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
  const requestedTimeout = args.timeoutMs ?? DEFAULT_CLI_RUN_TIMEOUT_MS;
  const budgetCapped = remaining !== undefined && remaining < requestedTimeout;
  if (remaining !== undefined && remaining < MIN_CLI_RUN_TIMEOUT_MS) {
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
      ? { timeoutMs: Math.min(requestedTimeout, remaining) }
      : args.timeoutMs !== undefined
        ? { timeoutMs: args.timeoutMs }
        : {}),
  });
  // A deadline the suite imposed is missing evidence, not a timeout in the program.
  const budgetExhausted = budgetCapped && run.status === 'timeout';
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
    ...(budgetExhausted
      ? { reason: 'suite-budget-exhausted' }
      : incomplete
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
  if (budgetExhausted) return CLI_EXIT_CODES.verificationInconclusive;
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
