/**
 * implementation — `lingua capsule validate <file>` subcommand.
 *
 * Reads a capsule JSON blob and validates it against the SAME
 * `parseRunCapsule` validator the renderer uses (single source of
 * truth in `src/shared/runCapsule.ts`). A capsule that validates
 * exits 0; a malformed one exits 1 with the closed-enum reason on
 * stderr (or the structured `--json` body on stdout when `--json`
 * is set).
 *
 * `--json` output shape (snapshot-stable per implementation note):
 *
 *   { ok: true, summary: string }
 *   { ok: false, reason: ParseRunCapsuleReason, detail?: string }
 */

import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import {
  computeContentHash,
  parseRunCapsule,
  summarizeRunCapsule,
  type RunCapsuleV1,
} from '../../shared/runCapsule';
import type { CliIo } from '../io';
import type { CliColorMode } from '../commandModel';
import { emitCliFailure, renderCliNotice, renderCliSuccess } from '../presentation';
import { CliEnvironmentError, buildCliRuntimeEnvironment } from '../runtime/environment';
import { executeCliPlan } from '../runtime/execution';
import { ExecutionTargetError, resolveCapsuleSource } from '../runtime/targets';
import { emitExecution, emitPreflightError } from './run';

export interface ValidateCapsuleArgs {
  filePath: string;
  json: boolean;
  quiet: boolean;
  color?: CliColorMode;
}

export interface ReplayCapsuleArgs extends ValidateCapsuleArgs {
  timeoutMs?: number;
  env: ReadonlyArray<{ key: string; value: string }>;
}

export async function runValidateCapsuleCommand(
  args: ValidateCapsuleArgs,
  io: CliIo
): Promise<CliExitCode> {
  const loaded = await loadCapsule(args.filePath, io);
  if (!loaded.ok) {
    emit(io, args, false, loaded.reason, loaded.detail);
    return CLI_EXIT_CODES.userInputError;
  }

  const summary = summarizeRunCapsule(loaded.value);
  if (args.json) {
    io.writeStdout(`${JSON.stringify({ ok: true, summary })}\n`);
    return CLI_EXIT_CODES.ok;
  }
  if (!args.quiet) {
    io.writeStdout(`${renderCliSuccess(io, args.color, summary)}\n`);
  }
  return CLI_EXIT_CODES.ok;
}

export async function runReplayCapsuleCommand(
  args: ReplayCapsuleArgs,
  io: CliIo
): Promise<CliExitCode> {
  const label = 'lingua capsule replay';
  const loaded = await loadCapsule(args.filePath, io);
  if (!loaded.ok) {
    return emitPreflightError(
      args,
      io,
      loaded.reason,
      loaded.detail ?? 'Capsule validation failed.',
      CLI_EXIT_CODES.userInputError,
      { command: 'capsule-replay' },
      label
    );
  }
  const capsule = loaded.value;
  const actualHash = await computeContentHash(capsule.source.content);
  if (actualHash !== capsule.source.contentHash) {
    return emitPreflightError(
      args,
      io,
      'content-hash-mismatch',
      'Capsule source content does not match its recorded SHA-256 hash; refusing to execute it.',
      CLI_EXIT_CODES.userInputError,
      { command: 'capsule-replay', capsuleId: capsule.capsuleId },
      label
    );
  }

  let env: NodeJS.ProcessEnv;
  try {
    env = buildCliRuntimeEnvironment(args.env);
  } catch (error) {
    const reason =
      error instanceof CliEnvironmentError ? error.reason : 'environment-resolution-failed';
    return emitPreflightError(
      args,
      io,
      reason,
      errorMessage(error),
      CLI_EXIT_CODES.userInputError,
      { command: 'capsule-replay', capsuleId: capsule.capsuleId },
      label
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
      capsule.input.args ?? []
    );
  } catch (error) {
    if (error instanceof ExecutionTargetError) {
      return emitPreflightError(
        args,
        io,
        error.reason,
        error.message,
        CLI_EXIT_CODES.unsupportedCapability,
        { command: 'capsule-replay', capsuleId: capsule.capsuleId },
        label
      );
    }
    return emitPreflightError(
      args,
      io,
      'target-resolution-failed',
      errorMessage(error),
      CLI_EXIT_CODES.internal,
      { command: 'capsule-replay', capsuleId: capsule.capsuleId },
      label
    );
  }

  const result = await executeCliPlan(plan, {
    ...(capsule.input.stdin !== undefined ? { stdin: capsule.input.stdin } : {}),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    env,
    ...(!args.json ? { onStdout: io.writeStdout, onStderr: io.writeStderr } : {}),
  });
  const comparison = compareReplay(capsule, result);
  emitExecution(
    args,
    io,
    result,
    {
      command: 'capsule-replay',
      capsuleId: capsule.capsuleId,
      recordedStatus: capsule.result.status,
      comparison,
    },
    label,
    !args.json
  );
  if (!args.json && !args.quiet) {
    const comparisonNotice =
      `${label}: ${comparison.matches ? 'recorded output matches' : 'recorded output differs'} ` +
      `(status=${comparison.status}, stdout=${comparison.stdout}, stderr=${comparison.stderr})`;
    io.writeStderr(
      `${renderCliNotice(io, args.color, comparisonNotice, comparison.matches ? 'success' : 'warning')}\n`
    );
  }

  if (result.status === 'success') return CLI_EXIT_CODES.ok;
  if (result.reason === 'missing-runtime') return CLI_EXIT_CODES.unsupportedCapability;
  return CLI_EXIT_CODES.runtimeError;
}

async function loadCapsule(
  filePath: string,
  io: CliIo
): Promise<{ ok: true; value: RunCapsuleV1 } | { ok: false; reason: string; detail?: string }> {
  let raw: string;
  try {
    raw = await io.readFile(filePath);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
    return {
      ok: false,
      reason: code === 'ENOENT' ? 'file-not-found' : 'read-failed',
      detail: errorMessage(error),
    };
  }
  return parseRunCapsule(raw);
}

function compareReplay(
  capsule: RunCapsuleV1,
  result: Awaited<ReturnType<typeof executeCliPlan>>
): { matches: boolean; status: boolean; stdout: boolean; stderr: boolean } {
  const status = capsule.result.status === result.status;
  const stdout = (capsule.result.stdout ?? '') === result.stdout;
  const stderr = (capsule.result.stderr ?? '') === result.stderr;
  return { matches: status && stdout && stderr, status, stdout, stderr };
}

function emit(
  io: CliIo,
  args: ValidateCapsuleArgs,
  ok: boolean,
  reasonOrSummary: string,
  detail?: string
): void {
  if (args.json) {
    const body = ok
      ? { ok: true, summary: reasonOrSummary }
      : detail !== undefined
        ? { ok: false, reason: reasonOrSummary, detail }
        : { ok: false, reason: reasonOrSummary };
    io.writeStdout(`${JSON.stringify(body)}\n`);
    return;
  }
  if (args.quiet) return;
  if (ok) {
    io.writeStdout(`${renderCliSuccess(io, args.color, reasonOrSummary)}\n`);
  } else {
    emitCliFailure(io, args, {
      label: 'lingua capsule validate',
      reason: reasonOrSummary,
      detail: detail ?? 'Capsule validation failed.',
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
