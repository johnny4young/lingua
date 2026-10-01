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
import { compareCapsuleStreams } from '../../shared/capsuleVerification';
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
  const prepared = await prepareCapsuleExecution(args, io, label, { command: 'capsule-replay' });
  if (!prepared.ok) return prepared.exitCode;
  const { capsule, env, plan } = prepared;

  const result = await executeCliPlan(plan, {
    ...(capsule.input.stdin !== undefined ? { stdin: capsule.input.stdin } : {}),
    ...(args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {}),
    env,
    ...(!args.json ? { onStdout: io.writeStdout, onStderr: io.writeStderr } : {}),
  });
  const comparison = compareCapsuleStreams(capsule, result);
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

export interface CapsulePreflightRefusal {
  reason: string;
  detail: string;
  exitCode: CliExitCode;
}

type CapsuleExecutionPlan = Awaited<ReturnType<typeof resolveCapsuleSource>>;

type PreparedCapsuleExecution =
  | { ok: true; capsule: RunCapsuleV1; env: NodeJS.ProcessEnv; plan: CapsuleExecutionPlan }
  | { ok: false; exitCode: CliExitCode };

export interface CapsulePreflightOptions {
  gate?: (capsule: RunCapsuleV1) => CapsulePreflightRefusal | null;
  /** Replaces captured-source resolution, e.g. with a current target file. */
  resolvePlan?: (capsule: RunCapsuleV1, env: NodeJS.ProcessEnv) => Promise<CapsuleExecutionPlan>;
  classifyResolveError?: (error: unknown) => CapsulePreflightRefusal | null;
}

/** Load, hash-check, gate, and resolve a capsule without executing it. */
export async function prepareCapsuleExecution(
  args: ReplayCapsuleArgs,
  io: CliIo,
  label: string,
  extra: Record<string, unknown>,
  options: CapsulePreflightOptions = {}
): Promise<PreparedCapsuleExecution> {
  const loaded = await loadCapsule(args.filePath, io);
  if (!loaded.ok) {
    return {
      ok: false,
      exitCode: emitPreflightError(
        args,
        io,
        loaded.reason,
        loaded.detail ?? 'Capsule validation failed.',
        CLI_EXIT_CODES.userInputError,
        extra,
        label
      ),
    };
  }
  return prepareLoadedCapsuleExecution(loaded.value, args, io, label, extra, options);
}

export async function prepareLoadedCapsuleExecution(
  capsule: RunCapsuleV1,
  args: ReplayCapsuleArgs,
  io: CliIo,
  label: string,
  extra: Record<string, unknown>,
  { gate, resolvePlan, classifyResolveError }: CapsulePreflightOptions = {}
): Promise<PreparedCapsuleExecution> {
  const refuse = (
    reason: string,
    detail: string,
    exitCode: CliExitCode,
    fields: Record<string, unknown> = extra
  ) => ({
    ok: false as const,
    exitCode: emitPreflightError(args, io, reason, detail, exitCode, fields, label),
  });
  const identified = { ...extra, capsuleId: capsule.capsuleId };
  if ((await computeContentHash(capsule.source.content)) !== capsule.source.contentHash) {
    return refuse(
      'content-hash-mismatch',
      'Capsule source content does not match its recorded SHA-256 hash; refusing to execute it.',
      CLI_EXIT_CODES.userInputError,
      identified
    );
  }
  const refusal = gate?.(capsule);
  if (refusal) return refuse(refusal.reason, refusal.detail, refusal.exitCode, identified);

  let env: NodeJS.ProcessEnv;
  try {
    env = buildCliRuntimeEnvironment(args.env);
  } catch (error) {
    return refuse(
      error instanceof CliEnvironmentError ? error.reason : 'environment-resolution-failed',
      errorMessage(error),
      CLI_EXIT_CODES.userInputError,
      identified
    );
  }

  try {
    const plan = resolvePlan
      ? await resolvePlan(capsule, env)
      : await resolveCapsuleSource(
          {
            language: capsule.tab.language,
            runtimeMode: capsule.tab.runtimeMode,
            source: capsule.source.content,
            capsuleId: capsule.capsuleId,
          },
          capsule.input.args ?? [],
          env
        );
    return { ok: true, capsule, env, plan };
  } catch (error) {
    const classified = classifyResolveError?.(error);
    if (classified) {
      return refuse(classified.reason, classified.detail, classified.exitCode, identified);
    }
    if (error instanceof ExecutionTargetError) {
      return refuse(error.reason, error.message, CLI_EXIT_CODES.unsupportedCapability, identified);
    }
    return refuse(
      'target-resolution-failed',
      errorMessage(error),
      CLI_EXIT_CODES.internal,
      identified
    );
  }
}

export async function loadCapsule(
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
