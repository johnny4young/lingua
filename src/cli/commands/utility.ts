/**
 * RL-098 Slice 1 — `lingua utility <utility-id>` subcommand.
 *
 * Runs a single utility adapter from the shared registry against an
 * input (stdin or `--input <file>`). The adapter shape comes from
 * `src/shared/utilities/types.ts` and the registry from
 * `src/shared/utilities/registry.ts` — both extracted by RL-099
 * Slice 1 specifically so the CLI can consume them without React.
 *
 * Exit contract:
 *
 *   - `0` ok — adapter returned `{ ok: true }`.
 *   - `1` user input error — unknown id, missing input, malformed
 *     `--option key=value`, options shape rejected by `parseOptions`.
 *   - `2` runtime error — adapter returned `{ ok: false, reason }`.
 *   - `3` unsupported capability — adapter `outputKind === 'binary'`
 *     (Slice 1 ships only text adapters; this branch is reserved for
 *     when RL-099 Slice 2+ adds binary ones).
 *
 * `--json` output shape (snapshot-stable per fold F):
 *
 *   { ok: true, value: string }
 *   { ok: false, reason: string, detail?: string }
 */

import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import {
  UTILITY_ADAPTER_IDS,
  type UtilityAdapter,
  type UtilityAdapterId,
} from '../../shared/utilities/types';
import { getAdapter, listAdapters } from '../../shared/utilities/registry';
import type { CliIo } from '../io';

export interface RunUtilityArgs {
  utilityId: string;
  inputPath?: string;
  options: ReadonlyArray<{ key: string; value: string }>;
  json: boolean;
  quiet: boolean;
}

export async function runUtilityCommand(
  args: RunUtilityArgs,
  io: CliIo
): Promise<CliExitCode> {
  // 1. Resolve the adapter.
  const adapter = getAdapter(args.utilityId);
  if (!adapter) {
    const known = (UTILITY_ADAPTER_IDS as readonly string[]).slice().sort();
    const truncated =
      known.length <= 6 ? known.join(', ') : `${known.slice(0, 5).join(', ')}, ...`;
    emitError(
      io,
      args,
      'unknown-utility-id',
      `Unknown utility id "${args.utilityId}". Available: ${truncated}. Run "lingua list utilities" for the full set.`
    );
    return CLI_EXIT_CODES.userInputError;
  }

  // 2. Slice 1 declines binary outputs cleanly; the engine has a
  // `binary` enum branch reserved for Slice 2+ adapters that don't
  // exist yet.
  if (adapter.outputKind === 'binary') {
    emitError(
      io,
      args,
      'unsupported-output-kind',
      `Adapter "${args.utilityId}" produces a binary output, which the Slice 1 CLI cannot stream safely.`
    );
    return CLI_EXIT_CODES.unsupportedCapability;
  }

  // 3. Read the input.
  let input: string;
  if (args.inputPath !== undefined) {
    try {
      input = await io.readFile(args.inputPath);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      emitError(
        io,
        args,
        'input-read-failed',
        `Failed to read --input "${args.inputPath}": ${detail}`
      );
      return CLI_EXIT_CODES.userInputError;
    }
  } else {
    let piped: string | null;
    try {
      piped = await io.readStdin();
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      emitError(io, args, 'stdin-read-failed', `Failed to read stdin: ${detail}`);
      return CLI_EXIT_CODES.userInputError;
    }
    if (piped === null) {
      emitError(
        io,
        args,
        'no-input',
        'Expected input via --input <file> or stdin pipe. Refusing to wait on TTY.'
      );
      return CLI_EXIT_CODES.userInputError;
    }
    input = piped;
  }

  // 4. Merge --option key=value pairs with the adapter's default options.
  let parsedOptions: unknown;
  try {
    parsedOptions = buildOptionsBlob(adapter, args.options);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    emitError(io, args, 'malformed-option', detail);
    return CLI_EXIT_CODES.userInputError;
  }

  const guardedOptions = adapter.parseOptions(parsedOptions);
  if (guardedOptions === null) {
    emitError(
      io,
      args,
      'invalid-options',
      `Options rejected by adapter "${adapter.id}" schema. Run "lingua list utilities --json" to inspect the supported option keys.`
    );
    return CLI_EXIT_CODES.userInputError;
  }

  // 5. Run + serialize the outcome.
  let outcome: Awaited<ReturnType<typeof adapter.run>>;
  try {
    outcome = await adapter.run(input, guardedOptions);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    emitError(io, args, 'execution-error', detail);
    return CLI_EXIT_CODES.internal;
  }

  if (outcome.ok) {
    if (args.json) {
      io.writeStdout(`${JSON.stringify({ ok: true, value: outcome.value })}\n`);
    } else {
      // Keep a trailing newline only if the value doesn't end with one
      // already. CI scripts that pipe utility output into another
      // adapter want byte-stable output.
      io.writeStdout(outcome.value);
      if (!outcome.value.endsWith('\n')) io.writeStdout('\n');
    }
    return CLI_EXIT_CODES.ok;
  }

  emitError(
    io,
    args,
    outcome.reason,
    outcome.detail ?? `adapter "${args.utilityId}" rejected: ${outcome.reason}`
  );
  return CLI_EXIT_CODES.runtimeError;
}

/**
 * Compose the options blob from `defaultOptions()` + the `--option`
 * CLI pairs. Values are kept as strings — `parseOptions` is
 * responsible for shape validation per adapter.
 */
function buildOptionsBlob(
  adapter: UtilityAdapter<unknown>,
  cliOptions: ReadonlyArray<{ key: string; value: string }>
): Record<string, unknown> {
  const blob: Record<string, unknown> = {
    ...(adapter.defaultOptions() as Record<string, unknown>),
  };
  const allowedKeys = new Set(adapter.optionsSchema.map((field) => field.key));
  for (const { key, value } of cliOptions) {
    if (!allowedKeys.has(key)) {
      throw new Error(
        `Adapter "${adapter.id}" has no option "${key}". Allowed: ${[...allowedKeys].sort().join(', ') || '(none)'}`
      );
    }
    blob[key] = coerceOptionValue(adapter, key, value);
  }
  return blob;
}

/** Cast a string CLI value into the adapter's declared field type. */
function coerceOptionValue(
  adapter: UtilityAdapter<unknown>,
  key: string,
  raw: string
): unknown {
  const field = adapter.optionsSchema.find((entry) => entry.key === key);
  if (!field) return raw;
  switch (field.type) {
    case 'text':
    case 'textarea':
    case 'select':
      return raw;
    case 'boolean': {
      if (raw === 'true' || raw === '1' || raw === 'yes') return true;
      if (raw === 'false' || raw === '0' || raw === 'no') return false;
      throw new Error(
        `Option "${key}" expects a boolean (true|false|1|0|yes|no); got "${raw}"`
      );
    }
  }
}

function emitError(
  io: CliIo,
  args: RunUtilityArgs,
  reason: string,
  detail: string
): void {
  if (args.json) {
    io.writeStdout(`${JSON.stringify({ ok: false, reason, detail })}\n`);
    return;
  }
  if (args.quiet) return;
  io.writeStderr(`lingua utility: ${detail}\n`);
}

/**
 * Fold B — `lingua list utilities` prints the registry. Pure
 * presentation: id, kinds, title (English fallback when an i18n
 * `titleKey` is declared but not resolvable in CLI land).
 */
export function runListUtilitiesCommand(
  args: { json: boolean; quiet: boolean },
  io: CliIo
): CliExitCode {
  const entries = listAdapters().map((adapter) => ({
    id: adapter.id satisfies UtilityAdapterId,
    inputKind: adapter.inputKind,
    outputKind: adapter.outputKind,
    titleKey: adapter.titleKey,
    descriptionKey: adapter.descriptionKey,
    optionKeys: adapter.optionsSchema.map((field) => field.key),
  }));
  if (args.json) {
    io.writeStdout(`${JSON.stringify({ utilities: entries }, null, 2)}\n`);
    return CLI_EXIT_CODES.ok;
  }
  if (args.quiet) return CLI_EXIT_CODES.ok;
  for (const entry of entries) {
    io.writeStdout(
      `${entry.id}\t${entry.inputKind} → ${entry.outputKind}` +
        (entry.optionKeys.length > 0
          ? `\toptions: ${entry.optionKeys.join(', ')}`
          : '') +
        '\n'
    );
  }
  return CLI_EXIT_CODES.ok;
}
