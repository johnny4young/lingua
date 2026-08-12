// SPDX-License-Identifier: MIT
/** `lingua run <file-or-directory>` command. */

import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import type { CliIo } from '../io';
import { emitCliFailure } from '../presentation';
import type { CliColorMode } from '../commandModel';
import { CliEnvironmentError, buildCliRuntimeEnvironment } from '../runtime/environment';
import { executeCliPlan, type CliExecutionResult } from '../runtime/execution';
import { ExecutionTargetError, resolveExecutionTarget } from '../runtime/targets';

export interface RunTargetArgs {
  target: string;
  stdinPath?: string;
  timeoutMs?: number;
  env: ReadonlyArray<{ key: string; value: string }>;
  programArgs: ReadonlyArray<string>;
  json: boolean;
  quiet: boolean;
  color?: CliColorMode;
}

export async function runTargetCommand(args: RunTargetArgs, io: CliIo): Promise<CliExitCode> {
  let stdin: string | undefined;
  if (args.stdinPath) {
    try {
      stdin = await io.readFile(args.stdinPath);
    } catch (error) {
      return emitPreflightError(
        args,
        io,
        'stdin-read-failed',
        `Could not read --stdin ${args.stdinPath}: ${errorMessage(error)}`,
        CLI_EXIT_CODES.userInputError
      );
    }
  } else {
    try {
      stdin = (await io.readStdin()) ?? undefined;
    } catch (error) {
      return emitPreflightError(
        args,
        io,
        'stdin-read-failed',
        `Could not read stdin: ${errorMessage(error)}`,
        CLI_EXIT_CODES.userInputError
      );
    }
  }

  let env: NodeJS.ProcessEnv;
  try {
    env = buildCliRuntimeEnvironment(args.env);
  } catch (error) {
    const reason =
      error instanceof CliEnvironmentError ? error.reason : 'environment-resolution-failed';
    return emitPreflightError(args, io, reason, errorMessage(error), CLI_EXIT_CODES.userInputError);
  }

  let plan;
  try {
    plan = await resolveExecutionTarget(args.target, args.programArgs);
  } catch (error) {
    if (error instanceof ExecutionTargetError) {
      const unsupported = [
        'unsupported-file-type',
        'unsupported-language',
        'unsupported-runtime-mode',
      ].includes(error.reason);
      return emitPreflightError(
        args,
        io,
        error.reason,
        error.message,
        unsupported ? CLI_EXIT_CODES.unsupportedCapability : CLI_EXIT_CODES.userInputError
      );
    }
    return emitPreflightError(
      args,
      io,
      'target-resolution-failed',
      errorMessage(error),
      CLI_EXIT_CODES.internal
    );
  }

  const result = await executeCliPlan(plan, {
    ...(stdin !== undefined ? { stdin } : {}),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    env,
    ...(!args.json ? { onStdout: io.writeStdout, onStderr: io.writeStderr } : {}),
  });
  emitExecution(args, io, result, {}, 'lingua run', !args.json);
  if (result.status === 'success') return CLI_EXIT_CODES.ok;
  if (result.reason === 'missing-runtime') return CLI_EXIT_CODES.unsupportedCapability;
  return CLI_EXIT_CODES.runtimeError;
}

export function emitExecution(
  args: Pick<RunTargetArgs, 'json' | 'quiet' | 'color'>,
  io: CliIo,
  result: CliExecutionResult,
  extra: Record<string, unknown> = {},
  label = 'lingua run',
  streamsAlreadyEmitted = false
): void {
  if (args.json) {
    const failure =
      result.status === 'success'
        ? {}
        : {
            reason: result.reason ?? result.status,
            detail: result.detail ?? `Run failed with status ${result.status}.`,
            ...(result.recovery ? { recovery: result.recovery } : {}),
          };
    io.writeStdout(
      `${JSON.stringify({ ok: result.status === 'success', ...extra, ...failure, run: result })}\n`
    );
    return;
  }
  if (!streamsAlreadyEmitted && result.stdout) io.writeStdout(result.stdout);
  if (!streamsAlreadyEmitted && result.stderr) io.writeStderr(result.stderr);
  if (result.status !== 'success' && !args.quiet) {
    const detail = result.detail ?? `Run failed with status ${result.status}.`;
    emitCliFailure(io, args, {
      label,
      reason: result.reason ?? result.status,
      detail,
    });
  }
}

export function emitPreflightError(
  args: Pick<RunTargetArgs, 'json' | 'quiet' | 'color'>,
  io: CliIo,
  reason: string,
  detail: string,
  exitCode: CliExitCode,
  extra: Record<string, unknown> = {},
  label = 'lingua run'
): CliExitCode {
  emitCliFailure(io, args, { label, reason, detail, extra });
  return exitCode;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
