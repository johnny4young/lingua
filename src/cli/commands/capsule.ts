/**
 * RL-098 Slice 1 — `lingua capsule validate <file>` subcommand.
 *
 * Reads a capsule JSON blob and validates it against the SAME
 * `parseRunCapsule` validator the renderer uses (single source of
 * truth in `src/shared/runCapsule.ts`). A capsule that validates
 * exits 0; a malformed one exits 1 with the closed-enum reason on
 * stderr (or the structured `--json` body on stdout when `--json`
 * is set).
 *
 * `--json` output shape (snapshot-stable per fold F):
 *
 *   { ok: true, summary: string }
 *   { ok: false, reason: ParseRunCapsuleReason, detail?: string }
 */

import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import { parseRunCapsule, summarizeRunCapsule } from '../../shared/runCapsule';
import type { CliIo } from '../io';

export interface ValidateCapsuleArgs {
  filePath: string;
  json: boolean;
  quiet: boolean;
}

export async function runValidateCapsuleCommand(
  args: ValidateCapsuleArgs,
  io: CliIo
): Promise<CliExitCode> {
  let raw: string;
  try {
    raw = await io.readFile(args.filePath);
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as { code?: string }).code : undefined;
    const reason = code === 'ENOENT' ? 'file-not-found' : 'read-failed';
    const detail = err instanceof Error ? err.message : String(err);
    emit(io, args, false, reason, detail);
    return CLI_EXIT_CODES.userInputError;
  }

  const outcome = parseRunCapsule(raw);
  if (!outcome.ok) {
    emit(io, args, false, outcome.reason, outcome.detail);
    return CLI_EXIT_CODES.userInputError;
  }

  const summary = summarizeRunCapsule(outcome.value);
  if (args.json) {
    io.writeStdout(`${JSON.stringify({ ok: true, summary })}\n`);
    return CLI_EXIT_CODES.ok;
  }
  if (!args.quiet) {
    io.writeStdout(`${summary}\n`);
  }
  return CLI_EXIT_CODES.ok;
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
    io.writeStdout(`${reasonOrSummary}\n`);
  } else {
    const suffix = detail ? `: ${detail}` : '';
    io.writeStderr(`lingua capsule validate: ${reasonOrSummary}${suffix}\n`);
  }
}
