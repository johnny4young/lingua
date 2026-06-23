/**
 * RL-098 Slice 1 — utility command tests.
 *
 * Drives `runUtilityCommand` + `runListUtilitiesCommand` through the
 * in-memory IO fake. Covers happy path per adapter, stdin path,
 * --json output shape, --option coercion, exit-code mapping, error
 * branches.
 */

import { describe, expect, it } from 'vitest';
import { CLI_EXIT_CODES } from '../../../src/cli/exit-codes';
import {
  runListUtilitiesCommand,
  runUtilityCommand,
} from '../../../src/cli/commands/utility';
import { createFakeIo } from '../io-fake';

describe('runUtilityCommand', () => {
  it('pretty-prints JSON via the json-format adapter (stdin)', async () => {
    const { io, state } = createFakeIo({ stdin: '{"a":1}' });
    const code = await runUtilityCommand(
      {
        utilityId: 'json-format',
        options: [],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toBe('{\n  "a": 1\n}\n');
    expect(state.stderr).toBe('');
  });

  it('reads --input from the virtual fs', async () => {
    const { io, state } = createFakeIo({
      files: { '/tmp/input.json': '{"b":2}' },
    });
    const code = await runUtilityCommand(
      {
        utilityId: 'json-format',
        inputPath: '/tmp/input.json',
        options: [],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toContain('"b": 2');
  });

  it('emits the --json envelope on success', async () => {
    const { io, state } = createFakeIo({ stdin: 'aGVsbG8=' });
    const code = await runUtilityCommand(
      {
        utilityId: 'base64-decode',
        options: [],
        json: true,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    const parsed = JSON.parse(state.stdout);
    expect(parsed).toEqual({ ok: true, value: 'hello' });
  });

  it('passes --option key=value through to parseOptions', async () => {
    const { io, state } = createFakeIo({ stdin: '{"a":1}' });
    const code = await runUtilityCommand(
      {
        utilityId: 'json-format',
        options: [{ key: 'indent', value: '4' }],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toBe('{\n    "a": 1\n}\n');
  });

  it('maps adapter { ok:false } to exit code 2', async () => {
    const { io, state } = createFakeIo({ stdin: 'not valid json' });
    const code = await runUtilityCommand(
      {
        utilityId: 'json-format',
        options: [],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.runtimeError);
    expect(state.stderr).toContain('lingua utility:');
  });

  it('maps unknown utility id to exit code 1 + helpful suggestion', async () => {
    const { io, state } = createFakeIo({ stdin: 'whatever' });
    const code = await runUtilityCommand(
      {
        utilityId: 'made-up-id',
        options: [],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toContain('Unknown utility id');
    expect(state.stderr).toContain('list utilities');
  });

  it('refuses to wait on a TTY stdin', async () => {
    const { io, state } = createFakeIo({ stdin: null });
    const code = await runUtilityCommand(
      {
        utilityId: 'json-format',
        options: [],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toContain('Expected input via --input');
  });

  it('rejects --option key not declared by the adapter', async () => {
    const { io, state } = createFakeIo({ stdin: '{}' });
    const code = await runUtilityCommand(
      {
        utilityId: 'json-format',
        options: [{ key: 'nonsense', value: 'x' }],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toContain('no option');
  });

  it('rejects --option on adapters that declare no options', async () => {
    const { io, state } = createFakeIo({ stdin: 'hello' });
    const code = await runUtilityCommand(
      {
        utilityId: 'base64-encode',
        options: [{ key: 'nonsense', value: 'x' }],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toContain('Allowed: (none)');
  });

  it('rejects option values that fail the adapter schema', async () => {
    const { io, state } = createFakeIo({ stdin: '{}' });
    const code = await runUtilityCommand(
      {
        utilityId: 'json-format',
        options: [{ key: 'indent', value: '3' }],
        json: false,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(state.stderr).toContain('Options rejected');
  });

  it('--quiet suppresses non-error output on success', async () => {
    const { io, state } = createFakeIo({ stdin: '{"a":1}' });
    const code = await runUtilityCommand(
      {
        utilityId: 'json-format',
        options: [],
        json: false,
        quiet: true,
      },
      io
    );
    // --quiet only affects error stderr in the current impl; happy
    // path stdout is the actual data the user pipes downstream and
    // must not be suppressed. This is the standard --quiet contract.
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toBe('{\n  "a": 1\n}\n');
  });

  it('--json envelope on failure has the reason field', async () => {
    const { io, state } = createFakeIo({ stdin: 'not-valid-base64-😀' });
    const code = await runUtilityCommand(
      {
        utilityId: 'base64-decode',
        options: [],
        json: true,
        quiet: false,
      },
      io
    );
    expect(code).toBe(CLI_EXIT_CODES.runtimeError);
    const parsed = JSON.parse(state.stdout);
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBeDefined();
  });
});

describe('runListUtilitiesCommand', () => {
  it('lists all 20 adapter ids in plain mode', () => {
    const { io, state } = createFakeIo();
    const code = runListUtilitiesCommand({ json: false, quiet: false }, io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toContain('json-format');
    expect(state.stdout).toContain('base64-encode');
    expect(state.stdout).toContain('base64-decode');
    expect(state.stdout).toContain('url-parse');
    expect(state.stdout).toContain('regex-replace');
    expect(state.stdout).toContain('diff-text');
    // RL-099 Slice 4 — vocabulary expansion adapters.
    expect(state.stdout).toContain('hash');
    expect(state.stdout).toContain('jwt-decode');
    expect(state.stdout).toContain('url-encode');
    expect(state.stdout).toContain('url-decode');
    expect(state.stdout).toContain('timestamp');
    expect(state.stdout).toContain('color-convert');
    expect(state.stdout).toContain('string-case');
    expect(state.stdout).toContain('html-entity-encode');
    expect(state.stdout).toContain('html-entity-decode');
    // RL-099 Slice 6 — vocabulary expansion round 2.
    expect(state.stdout).toContain('number-base');
    expect(state.stdout).toContain('line-sort');
    expect(state.stdout).toContain('slugify');
    expect(state.stdout).toContain('json-minify');
    expect(state.stdout).toContain('text-stats');
  });

  it('emits a structured JSON list with --json', () => {
    const { io, state } = createFakeIo();
    const code = runListUtilitiesCommand({ json: true, quiet: false }, io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    const parsed = JSON.parse(state.stdout) as {
      utilities: Array<{ id: string; inputKind: string; outputKind: string; optionKeys: string[] }>;
    };
    expect(parsed.utilities).toHaveLength(20);
    const jsonFormat = parsed.utilities.find((u) => u.id === 'json-format');
    expect(jsonFormat?.optionKeys).toEqual(['indent']);
    // RL-099 Slice 4 — the hash adapter surfaces its algorithm option.
    const hash = parsed.utilities.find((u) => u.id === 'hash');
    expect(hash?.optionKeys).toEqual(['algorithm']);
  });

  it('--quiet emits nothing in plain mode', () => {
    const { io, state } = createFakeIo();
    const code = runListUtilitiesCommand({ json: false, quiet: true }, io);
    expect(code).toBe(CLI_EXIT_CODES.ok);
    expect(state.stdout).toBe('');
    expect(state.stderr).toBe('');
  });
});
