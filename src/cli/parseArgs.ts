/**
 * implementation — argv parser.
 *
 * Tiny hand-rolled parser (no commander dep) covering the implementation
 * surface:
 *
 *   lingua utility <utility-id> [--input <file>] [--json] [--quiet]
 *                               [--option key=value ...]
 *   lingua capsule validate <file> [--json] [--quiet]
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
  if (first === 'capsule') {
    return parseCapsule(args.slice(1));
  }
  if (first === 'list') {
    return parseList(args.slice(1));
  }

  throw new CliUsageError(
    `Unknown command "${first}". Run "lingua --help" for usage.`
  );
}

function freshFlags(): InProgressFlags {
  return { json: false, quiet: false, options: [], help: false };
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
      options: flags.options,
      help: flags.help,
    },
  };
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
          .filter((flag) => flag !== '-h')
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
      'lingua capsule requires a subcommand. implementation ships: validate <file>'
    );
  }
  const sub = rest[0]!;
  if (sub === '--help' || sub === '-h') {
    return finalize('capsule-validate', [], { ...freshFlags(), help: true });
  }
  if (sub !== 'validate') {
    throw new CliUsageError(
      `Unknown capsule subcommand "${sub}". implementation ships: validate <file>`
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
    throw new CliUsageError(
      'lingua capsule validate requires a <file> positional.'
    );
  }
  if (positionals.length > 1) {
    throw new CliUsageError(
      `lingua capsule validate accepts a single <file>; got ${positionals.length}: ${positionals.join(', ')}`
    );
  }
  return finalize('capsule-validate', positionals, flags);
}

function parseList(rest: ReadonlyArray<string>): ParsedArgs {
  if (rest.length === 0) {
    throw new CliUsageError(
      'lingua list requires a subcommand. implementation ships: utilities'
    );
  }
  const sub = rest[0]!;
  if (sub === '--help' || sub === '-h') {
    return finalize('list-utilities', [], { ...freshFlags(), help: true });
  }
  if (sub !== 'utilities') {
    throw new CliUsageError(
      `Unknown list subcommand "${sub}". implementation ships: utilities`
    );
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
