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
 *   lingua list utilities [--json] [--quiet]            (implementation note)
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

import { runValidateCapsuleCommand } from './commands/capsule';
import { runListUtilitiesCommand, runUtilityCommand } from './commands/utility';
import { CLI_EXIT_CODES, type CliExitCode } from './exit-codes';
import { createDefaultIo, type CliIo } from './io';
import { CliUsageError, parseArgs, type ParsedArgs } from './parseArgs';

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

const HELP_TEXT = `lingua — local code runner CLI

Usage:
  lingua utility <utility-id> [--input <file>] [--json] [--quiet] [--option key=value ...]
  lingua capsule validate <file> [--json] [--quiet]
  lingua list utilities [--json] [--quiet]
  lingua --version
  lingua --help

Commands:
  utility            Run a single utility adapter against stdin or --input.
  capsule validate   Validate a RunCapsuleV1 JSON blob; exits 0 on success.
  list utilities     Print the available utility ids + their input/output kinds.

Flags:
  --input <file>     Read input from <file> instead of stdin. (utility only)
  --option key=value Repeated. Pass adapter options. (utility only)
  --json             Emit a structured JSON body instead of plain text.
  --quiet            Suppress non-error output. Useful in CI pipelines.
  --help, -h         Show this help.
  --version, -v      Print the CLI version.

Exit codes:
  0  ok
  1  user input error (bad args, unknown id, missing file, bad shape)
  2  runtime error (adapter returned { ok: false })
  3  unsupported capability (e.g. binary output kind)
  4  internal (caught exception we didn't classify)

Examples:
  echo '{"a":1}' | lingua utility json-format
  lingua utility base64-encode --input README.md
  lingua utility regex-replace --input src.ts \\
    --option pattern=foo --option flags=g --option replacement=bar
  lingua capsule validate ./run.capsule.json
  lingua list utilities --json
`;

/**
 * Top-level dispatcher. Always settles to a `CliExitCode`. The
 * caller is responsible for `process.exit(code)`.
 */
export async function dispatch(
  argv: ReadonlyArray<string>,
  io: CliIo
): Promise<CliExitCode> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof CliUsageError) {
      io.writeStderr(`lingua: ${err.message}\n`);
      return CLI_EXIT_CODES.userInputError;
    }
    const detail = err instanceof Error ? err.message : String(err);
    io.writeStderr(`lingua: internal error during argv parsing: ${detail}\n`);
    return CLI_EXIT_CODES.internal;
  }

  if (parsed.flags.help || parsed.command === 'help') {
    io.writeStdout(HELP_TEXT);
    return CLI_EXIT_CODES.ok;
  }

  if (parsed.command === 'version') {
    io.writeStdout(`${resolveCliVersion()}\n`);
    return CLI_EXIT_CODES.ok;
  }

  if (parsed.command === 'list-utilities') {
    return runListUtilitiesCommand(
      { json: parsed.flags.json, quiet: parsed.flags.quiet },
      io
    );
  }

  if (parsed.command === 'utility') {
    const utilityId = parsed.positionals[0];
    if (utilityId === undefined) {
      io.writeStderr('lingua: utility command missing <utility-id>\n');
      return CLI_EXIT_CODES.userInputError;
    }
    return runUtilityCommand(
      {
        utilityId,
        ...(parsed.flags.input !== undefined ? { inputPath: parsed.flags.input } : {}),
        options: parsed.flags.options,
        json: parsed.flags.json,
        quiet: parsed.flags.quiet,
      },
      io
    );
  }

  if (parsed.command === 'capsule-validate') {
    const filePath = parsed.positionals[0];
    if (filePath === undefined) {
      io.writeStderr('lingua: capsule validate missing <file>\n');
      return CLI_EXIT_CODES.userInputError;
    }
    return runValidateCapsuleCommand(
      { filePath, json: parsed.flags.json, quiet: parsed.flags.quiet },
      io
    );
  }

  // Exhaustiveness check — TypeScript catches unhandled command names
  // at compile time; this branch is unreachable.
  const exhaustive: never = parsed.command;
  io.writeStderr(`lingua: unreachable command ${String(exhaustive)}\n`);
  return CLI_EXIT_CODES.internal;
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
