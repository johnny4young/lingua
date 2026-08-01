/**
 * implementation — argv parser.
 *
 * Tiny hand-rolled parser (no commander dep) covering the implementation
 * surface:
 *
 *   lingua utility <utility-id> [--input <file>] [--json] [--quiet]
 *                               [--option key=value ...]
 *   lingua capsule validate <file> [--json] [--quiet]
 *   lingua capsule replay <file> [--timeout <ms>] [--json] [--quiet]
 *   lingua run <file-or-directory> [--stdin <file>] [--timeout <ms>]
 *              [--env NAME=value ...] [--json] [--quiet] [-- args...]
 *   lingua list utilities [--json]            (implementation note)
 *   lingua --version                          (implementation note)
 *   lingua --help | lingua <cmd> --help
 *
 * Anything unrecognized throws a `CliUsageError` so the entry can
 * map it to exit code 1 with a clean message. The closed flag
 * whitelist per command keeps drift detectable — adding a new flag
 * is a code change in this file, not a silent acceptance.
 */

export class CliUsageError extends Error {
  /** Marker so the dispatcher can branch without `instanceof` brittleness. */
  readonly isCliUsageError = true;
  constructor(message: string) {
    super(message);
    this.name = 'CliUsageError';
  }
}

export type CliCommandName =
  | 'utility'
  | 'capsule-validate'
  | 'capsule-replay'
  | 'run'
  | 'list-utilities'
  | 'help'
  | 'version';

export interface ParsedArgs {
  command: CliCommandName;
  /**
   * Positional arguments left over after subcommand identification.
   * For `utility`, this is `[utilityId]`. For `capsule validate`
   * it's `[filePath]`. For `list utilities` + `version` it's `[]`.
   */
  positionals: ReadonlyArray<string>;
  flags: {
    json: boolean;
    quiet: boolean;
    /** `--input <path>`. Only used by the `utility` command. */
    input?: string;
    /** `--stdin <path>`. Only used by `run`. */
    stdin?: string;
    /** Parent-owned execution timeout in milliseconds. */
    timeoutMs?: number;
    /** Explicit environment entries passed to an executed program. */
    env: ReadonlyArray<{ key: string; value: string }>;
    /** Arguments after `--`, forwarded byte-for-byte to `run` targets. */
    programArgs: ReadonlyArray<string>;
    /** `--option key=value` repeated. Only used by the `utility` command. */
    options: ReadonlyArray<{ key: string; value: string }>;
    /** `--help` requested anywhere in the argv. */
    help: boolean;
  };
}

interface InProgressFlags {
  json: boolean;
  quiet: boolean;
  input?: string;
  stdin?: string;
  timeoutMs?: number;
  env: Array<{ key: string; value: string }>;
  programArgs: string[];
  options: Array<{ key: string; value: string }>;
  help: boolean;
}

/** Flags every command accepts. */
const GLOBAL_FLAGS = new Set(['--json', '--quiet', '--help', '-h']);
/** Flags ONLY the `utility` subcommand accepts. */
const UTILITY_ONLY_FLAGS = new Set(['--input', '--option']);

/** Parse the argv tail (after the node bin + script path). */
export function parseArgs(argv: ReadonlyArray<string>): ParsedArgs {
  const args = [...argv];

  // No args at all → top-level help.
  if (args.length === 0) {
    return finalize('help', [], freshFlags());
  }

  const first = args[0]!;
  if (first === '--version' || first === '-v') {
    if (args.length > 1) {
      throw new CliUsageError(
        `--version does not accept additional arguments (got: ${args.slice(1).join(' ')})`
      );
    }
    return finalize('version', [], freshFlags());
  }
  if (first === '--help' || first === '-h') {
    return finalize('help', [], { ...freshFlags(), help: true });
  }

  // Subcommand dispatch.
  if (first === 'utility') {
    return parseUtility(args.slice(1));
  }
  if (first === 'run') {
    return parseRun(args.slice(1));
  }
  if (first === 'capsule') {
    return parseCapsule(args.slice(1));
  }
  if (first === 'list') {
    return parseList(args.slice(1));
  }

  throw new CliUsageError(`Unknown command "${first}". Run "lingua --help" for usage.`);
}

function freshFlags(): InProgressFlags {
  return {
    json: false,
    quiet: false,
    options: [],
    env: [],
    programArgs: [],
    help: false,
  };
}

function finalize(
  command: CliCommandName,
  positionals: ReadonlyArray<string>,
  flags: InProgressFlags
): ParsedArgs {
  return {
    command,
    positionals,
    flags: {
      json: flags.json,
      quiet: flags.quiet,
      ...(flags.input !== undefined ? { input: flags.input } : {}),
      ...(flags.stdin !== undefined ? { stdin: flags.stdin } : {}),
      ...(flags.timeoutMs !== undefined ? { timeoutMs: flags.timeoutMs } : {}),
      options: flags.options,
      env: flags.env,
      programArgs: flags.programArgs,
      help: flags.help,
    },
  };
}

function parseRun(rest: ReadonlyArray<string>): ParsedArgs {
  const separator = rest.indexOf('--');
  const commandArgs = separator >= 0 ? rest.slice(0, separator) : rest;
  const flags = freshFlags();
  if (separator >= 0) flags.programArgs = rest.slice(separator + 1);
  const positionals: string[] = [];

  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index]!;
    if (parseGlobalFlag(arg, flags)) continue;
    if (arg === '--stdin') {
      flags.stdin = requireFlagValue(commandArgs, index, '--stdin');
      index += 1;
      continue;
    }
    if (arg.startsWith('--stdin=')) {
      flags.stdin = nonEmptyInlineValue(arg, '--stdin');
      continue;
    }
    if (arg === '--timeout') {
      flags.timeoutMs = parseTimeout(requireFlagValue(commandArgs, index, '--timeout'));
      index += 1;
      continue;
    }
    if (arg.startsWith('--timeout=')) {
      flags.timeoutMs = parseTimeout(nonEmptyInlineValue(arg, '--timeout'));
      continue;
    }
    if (arg === '--env') {
      flags.env.push(parseEnvironmentKv(requireFlagValue(commandArgs, index, '--env')));
      index += 1;
      continue;
    }
    if (arg.startsWith('--env=')) {
      flags.env.push(parseEnvironmentKv(nonEmptyInlineValue(arg, '--env')));
      continue;
    }
    if (arg.startsWith('-')) {
      throw new CliUsageError(
        `Unknown flag "${arg}" for "lingua run". Allowed: --stdin, --timeout, --env, --json, --quiet, --help, --`
      );
    }
    positionals.push(arg);
  }

  assertSingleTarget('lingua run', positionals, flags.help, '<file-or-directory>');
  return finalize('run', positionals, flags);
}

function parseUtility(rest: ReadonlyArray<string>): ParsedArgs {
  const flags = freshFlags();
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--quiet') {
      flags.quiet = true;
      continue;
    }
    if (arg === '--input') {
      const next = rest[i + 1];
      if (next === undefined) {
        throw new CliUsageError('--input requires a file path');
      }
      flags.input = next;
      i += 1;
      continue;
    }
    if (arg.startsWith('--input=')) {
      flags.input = arg.slice('--input='.length);
      continue;
    }
    if (arg === '--option') {
      const next = rest[i + 1];
      if (next === undefined) {
        throw new CliUsageError('--option requires a key=value pair');
      }
      flags.options.push(parseOptionKv(next));
      i += 1;
      continue;
    }
    if (arg.startsWith('--option=')) {
      flags.options.push(parseOptionKv(arg.slice('--option='.length)));
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliUsageError(
        `Unknown flag "${arg}" for "lingua utility". Allowed: ${[
          ...GLOBAL_FLAGS,
          ...UTILITY_ONLY_FLAGS,
        ]
          .filter(flag => flag !== '-h')
          .sort()
          .join(', ')}`
      );
    }
    positionals.push(arg);
  }
  if (!flags.help && positionals.length === 0) {
    throw new CliUsageError(
      'lingua utility requires a <utility-id> positional. Run "lingua list utilities" to see the available ids.'
    );
  }
  if (positionals.length > 1) {
    throw new CliUsageError(
      `lingua utility accepts a single <utility-id>; got ${positionals.length}: ${positionals.join(', ')}`
    );
  }
  return finalize('utility', positionals, flags);
}

function parseCapsule(rest: ReadonlyArray<string>): ParsedArgs {
  if (rest.length === 0) {
    throw new CliUsageError(
      'lingua capsule requires a subcommand. Available: validate <file>, replay <file>'
    );
  }
  const sub = rest[0]!;
  if (sub === '--help' || sub === '-h') {
    return finalize('capsule-validate', [], { ...freshFlags(), help: true });
  }
  if (sub === 'replay') {
    return parseCapsuleReplay(rest.slice(1));
  }
  if (sub !== 'validate') {
    throw new CliUsageError(
      `Unknown capsule subcommand "${sub}". Available: validate <file>, replay <file>`
    );
  }
  const flags = freshFlags();
  const positionals: string[] = [];
  for (let i = 1; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--quiet') {
      flags.quiet = true;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliUsageError(
        `Unknown flag "${arg}" for "lingua capsule validate". Allowed: --json, --quiet, --help`
      );
    }
    positionals.push(arg);
  }
  if (!flags.help && positionals.length === 0) {
    throw new CliUsageError('lingua capsule validate requires a <file> positional.');
  }
  if (positionals.length > 1) {
    throw new CliUsageError(
      `lingua capsule validate accepts a single <file>; got ${positionals.length}: ${positionals.join(', ')}`
    );
  }
  return finalize('capsule-validate', positionals, flags);
}

function parseCapsuleReplay(rest: ReadonlyArray<string>): ParsedArgs {
  const flags = freshFlags();
  const positionals: string[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index]!;
    if (parseGlobalFlag(arg, flags)) continue;
    if (arg === '--timeout') {
      flags.timeoutMs = parseTimeout(requireFlagValue(rest, index, '--timeout'));
      index += 1;
      continue;
    }
    if (arg.startsWith('--timeout=')) {
      flags.timeoutMs = parseTimeout(nonEmptyInlineValue(arg, '--timeout'));
      continue;
    }
    if (arg === '--env') {
      flags.env.push(parseEnvironmentKv(requireFlagValue(rest, index, '--env')));
      index += 1;
      continue;
    }
    if (arg.startsWith('--env=')) {
      flags.env.push(parseEnvironmentKv(nonEmptyInlineValue(arg, '--env')));
      continue;
    }
    if (arg.startsWith('-')) {
      throw new CliUsageError(
        `Unknown flag "${arg}" for "lingua capsule replay". Allowed: --timeout, --env, --json, --quiet, --help`
      );
    }
    positionals.push(arg);
  }
  assertSingleTarget('lingua capsule replay', positionals, flags.help, '<file>');
  return finalize('capsule-replay', positionals, flags);
}

function parseList(rest: ReadonlyArray<string>): ParsedArgs {
  if (rest.length === 0) {
    throw new CliUsageError('lingua list requires a subcommand. implementation ships: utilities');
  }
  const sub = rest[0]!;
  if (sub === '--help' || sub === '-h') {
    return finalize('list-utilities', [], { ...freshFlags(), help: true });
  }
  if (sub !== 'utilities') {
    throw new CliUsageError(`Unknown list subcommand "${sub}". implementation ships: utilities`);
  }
  const flags = freshFlags();
  for (let i = 1; i < rest.length; i += 1) {
    const arg = rest[i]!;
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
      continue;
    }
    if (arg === '--json') {
      flags.json = true;
      continue;
    }
    if (arg === '--quiet') {
      flags.quiet = true;
      continue;
    }
    throw new CliUsageError(
      `Unknown argument "${arg}" for "lingua list utilities". Allowed: --json, --quiet, --help`
    );
  }
  return finalize('list-utilities', [], flags);
}

/** Parse a `key=value` token. Rejects empty keys but allows `=` inside the value. */
function parseOptionKv(raw: string): { key: string; value: string } {
  const eq = raw.indexOf('=');
  if (eq <= 0) {
    throw new CliUsageError(
      `--option expects "key=value" (got "${raw}"). Example: --option indent=4`
    );
  }
  return { key: raw.slice(0, eq), value: raw.slice(eq + 1) };
}

function parseGlobalFlag(arg: string, flags: InProgressFlags): boolean {
  if (arg === '--help' || arg === '-h') {
    flags.help = true;
    return true;
  }
  if (arg === '--json') {
    flags.json = true;
    return true;
  }
  if (arg === '--quiet') {
    flags.quiet = true;
    return true;
  }
  return false;
}

function requireFlagValue(args: ReadonlyArray<string>, index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new CliUsageError(`${flag} requires a value`);
  }
  return value;
}

function nonEmptyInlineValue(arg: string, flag: string): string {
  const value = arg.slice(`${flag}=`.length);
  if (!value) throw new CliUsageError(`${flag} requires a value`);
  return value;
}

function parseTimeout(raw: string): number {
  if (!/^\d+$/u.test(raw)) {
    throw new CliUsageError(`--timeout expects integer milliseconds; got "${raw}"`);
  }
  const timeoutMs = Number(raw);
  if (timeoutMs < 100 || timeoutMs > 300_000) {
    throw new CliUsageError('--timeout must be between 100 and 300000 milliseconds');
  }
  return timeoutMs;
}

function parseEnvironmentKv(raw: string): { key: string; value: string } {
  const parsed = parseOptionKv(raw);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(parsed.key)) {
    throw new CliUsageError(`--env has an invalid variable name "${parsed.key}"`);
  }
  return parsed;
}

function assertSingleTarget(
  command: string,
  positionals: ReadonlyArray<string>,
  help: boolean,
  label: string
): void {
  if (!help && positionals.length === 0) {
    throw new CliUsageError(`${command} requires a ${label} positional.`);
  }
  if (positionals.length > 1) {
    throw new CliUsageError(
      `${command} accepts one ${label}; got ${positionals.length}: ${positionals.join(', ')}`
    );
  }
}
