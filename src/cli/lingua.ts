/**
 * implementation — Lingua CLI entry.
 *
 * Pure shared/main code. NO renderer imports — an ESLint rule
 * enforces this so the bundled CJS stays React-free + Electron-free.
 *
 * Subcommands:
 *
 *   lingua utility <id> [--input <file>] [--json] [--quiet]
 *                       [--option key=value ...]
 *   lingua capsule validate <file> [--json] [--quiet]
 *   lingua capsule replay <file> [--timeout <ms>] [--json] [--quiet]
 *   lingua run <file-or-directory> [--stdin <file>] [--timeout <ms>]
 *              [--env NAME=value ...] [--json] [--quiet] [-- args...]
 *   lingua list utilities [--json] [--quiet]            (implementation note)
 *   lingua completion [bash|zsh|fish|install] [--yes] [--dry-run]
 *   lingua --version                                    (implementation note)
 *   lingua --help | <cmd> --help
 *
 * implementation note — the bundled artifact is prefixed with `#!/usr/bin/env node`
 * at bundle time by `scripts/build-cli.mjs` (esbuild `banner.js`),
 * then chmod +x'd, so the binary is directly executable on Unix.
 * The shebang is NOT in this source file because it would interfere
 * with the test transformer + double up in the bundle.
 *
 * The compile-time `__LINGUA_CLI_VERSION__` placeholder is replaced
 * by `scripts/build-cli.mjs` with the value from `package.json` at
 * bundle time — no `fs.readFile` at runtime, so the bundle stays
 * portable across install locations.
 */

import { runReplayCapsuleCommand, runValidateCapsuleCommand } from './commands/capsule';
import { runCompletionInstallCommand } from './commands/completionInstall';
import { runTargetCommand } from './commands/run';
import { runListUtilitiesCommand, runUtilityCommand } from './commands/utility';
import { isCliColorMode, type CliColorMode } from './commandModel';
import { renderCompletion } from './completion';
import { renderCliHelpText } from './helpCatalog';
import { CLI_EXIT_CODES, type CliExitCode } from './exit-codes';
import { createDefaultIo, type CliIo } from './io';
import { CliUsageError, getCompletionShell, parseArgs, type ParsedArgs } from './parseArgs';
import { emitCliFailure, renderCliHelp, type CliOutputOptions } from './presentation';

declare const __LINGUA_CLI_VERSION__: string | undefined;

/**
 * Resolve the build-time version. esbuild's `--define` rewrites the
 * placeholder identifier with the literal string from
 * package.json. When the CLI runs as raw TS (tests / dev), the
 * fallback below kicks in and we read the major version metadata
 * only via the bundled string — never `fs.readFile`.
 */
function resolveCliVersion(): string {
  if (typeof __LINGUA_CLI_VERSION__ === 'string' && __LINGUA_CLI_VERSION__.length > 0) {
    return __LINGUA_CLI_VERSION__;
  }
  return '0.0.0-dev';
}

const HELP_TEXT = renderCliHelpText();

/**
 * Top-level dispatcher. Always settles to a `CliExitCode`. The
 * caller is responsible for `process.exit(code)`.
 */
export async function dispatch(argv: ReadonlyArray<string>, io: CliIo): Promise<CliExitCode> {
  const fallbackOutput = sniffOutputOptions(argv);
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      emitCliFailure(io, fallbackOutput, {
        label: 'lingua',
        reason: 'invalid-arguments',
        detail: err.message,
      });
      return CLI_EXIT_CODES.userInputError;
    }
    const detail = err instanceof Error ? err.message : String(err);
    emitCliFailure(io, fallbackOutput, {
      label: 'lingua',
      reason: 'internal-argument-parser-error',
      detail: `Internal error during argv parsing: ${detail}`,
    });
    return CLI_EXIT_CODES.internal;
  }

  if (parsed.flags.help || parsed.command === 'help') {
    io.writeStdout(renderCliHelp(io, parsed.flags.color, HELP_TEXT));
    return CLI_EXIT_CODES.ok;
  }

  if (parsed.command === 'version') {
    io.writeStdout(`${resolveCliVersion()}\n`);
    return CLI_EXIT_CODES.ok;
  }

  if (parsed.command === 'list-utilities') {
    return runListUtilitiesCommand(
      { json: parsed.flags.json, quiet: parsed.flags.quiet, color: parsed.flags.color },
      io
    );
  }

  if (parsed.command === 'completion') {
    const shell = getCompletionShell(parsed);
    if (shell === undefined) {
      emitCliFailure(io, parsed.flags, {
        label: 'lingua completion',
        reason: 'missing-shell',
        detail: 'Expected one of: bash, zsh, fish.',
      });
      return CLI_EXIT_CODES.userInputError;
    }
    io.writeStdout(renderCompletion(shell));
    return CLI_EXIT_CODES.ok;
  }

  if (parsed.command === 'completion-install') {
    return runCompletionInstallCommand(
      { assumeYes: parsed.flags.yes, dryRun: parsed.flags.dryRun },
      io
    );
  }

  if (parsed.command === 'utility') {
    const utilityId = parsed.positionals[0];
    if (utilityId === undefined) {
      emitCliFailure(io, parsed.flags, {
        label: 'lingua utility',
        reason: 'missing-utility-id',
        detail: 'Expected a <utility-id> positional.',
      });
      return CLI_EXIT_CODES.userInputError;
    }
    return runUtilityCommand(
      {
        utilityId,
        ...(parsed.flags.input !== undefined ? { inputPath: parsed.flags.input } : {}),
        options: parsed.flags.options,
        json: parsed.flags.json,
        quiet: parsed.flags.quiet,
        color: parsed.flags.color,
      },
      io
    );
  }

  if (parsed.command === 'run') {
    const target = parsed.positionals[0];
    if (target === undefined) {
      emitCliFailure(io, parsed.flags, {
        label: 'lingua run',
        reason: 'missing-target',
        detail: 'Expected a <file-or-directory> positional.',
      });
      return CLI_EXIT_CODES.userInputError;
    }
    return runTargetCommand(
      {
        target,
        ...(parsed.flags.stdin !== undefined ? { stdinPath: parsed.flags.stdin } : {}),
        ...(parsed.flags.timeoutMs !== undefined ? { timeoutMs: parsed.flags.timeoutMs } : {}),
        env: parsed.flags.env,
        programArgs: parsed.flags.programArgs,
        json: parsed.flags.json,
        quiet: parsed.flags.quiet,
        color: parsed.flags.color,
      },
      io
    );
  }

  if (parsed.command === 'capsule-validate') {
    const filePath = parsed.positionals[0];
    if (filePath === undefined) {
      emitCliFailure(io, parsed.flags, {
        label: 'lingua capsule validate',
        reason: 'missing-file',
        detail: 'Expected a <file> positional.',
      });
      return CLI_EXIT_CODES.userInputError;
    }
    return runValidateCapsuleCommand(
      {
        filePath,
        json: parsed.flags.json,
        quiet: parsed.flags.quiet,
        color: parsed.flags.color,
      },
      io
    );
  }

  if (parsed.command === 'capsule-replay') {
    const filePath = parsed.positionals[0];
    if (filePath === undefined) {
      emitCliFailure(io, parsed.flags, {
        label: 'lingua capsule replay',
        reason: 'missing-file',
        detail: 'Expected a <file> positional.',
      });
      return CLI_EXIT_CODES.userInputError;
    }
    return runReplayCapsuleCommand(
      {
        filePath,
        ...(parsed.flags.timeoutMs !== undefined ? { timeoutMs: parsed.flags.timeoutMs } : {}),
        env: parsed.flags.env,
        json: parsed.flags.json,
        quiet: parsed.flags.quiet,
        color: parsed.flags.color,
      },
      io
    );
  }

  // Exhaustiveness check — TypeScript catches unhandled command names
  // at compile time; this branch is unreachable.
  const exhaustive: never = parsed.command;
  emitCliFailure(io, parsed.flags, {
    label: 'lingua',
    reason: 'internal-unreachable-command',
    detail: `Unreachable command ${String(exhaustive)}.`,
  });
  return CLI_EXIT_CODES.internal;
}

/** Best-effort output intent used even when the strict parser rejects argv. */
function sniffOutputOptions(argv: ReadonlyArray<string>): CliOutputOptions {
  const separator = argv.indexOf('--');
  const scan = separator >= 0 ? argv.slice(0, separator) : argv;
  let color: CliColorMode = 'auto';
  for (let index = 0; index < scan.length; index += 1) {
    const arg = scan[index]!;
    const raw =
      arg === '--color'
        ? scan[index + 1]
        : arg.startsWith('--color=')
          ? arg.slice('--color='.length)
          : undefined;
    if (raw !== undefined && isCliColorMode(raw)) color = raw;
    if (arg === '--color') index += 1;
  }
  return {
    json: scan.includes('--json'),
    quiet: scan.includes('--quiet'),
    color,
  };
}

async function main(): Promise<void> {
  const io = createDefaultIo();
  // `process.argv` is `[node-bin, script-path, ...userArgs]`. implementation
  // past the first two so command handlers see the user's tail.
  const code = await dispatch(process.argv.slice(2), io);
  // Use `process.exitCode` instead of `process.exit(code)` so any
  // pending stdout writes flush before Node terminates. The
  // synchronous `process.exit()` truncates output on a busy pipe
  // (e.g. when piping into `head -c` or another CLI) — the standard
  // Node CLI idiom is to set `exitCode` and let the event loop drain
  // naturally. Since `dispatch()` resolves only after every io.write
  // has been issued and we hold no open handles, the loop drains
  // immediately and Node exits with the chosen code.
  process.exitCode = code;
}

// Bundler entry: only invoke main() when this module IS the entry —
// not when imported by tests via vitest. esbuild bundles `require`
// access, so the explicit check below stays a single line.
if (require.main === module) {
  void main();
}
