/**
 * implementation — argv parser tests.
 *
 * Pin the CLI's user-input surface. Adding new flags is allowed via
 * code change; silent acceptance of unknown flags is not.
 */

import { describe, expect, it } from 'vitest';
import { CLI_EXIT_CODES } from '../../src/cli/exit-codes';
import { CliUsageError, parseArgs } from '../../src/cli/parseArgs';

describe('CLI_EXIT_CODES', () => {
  it('pins the exit-code contract (regression guard)', () => {
    // CI scripts depend on these numbers — adding new codes is OK,
    // renumbering existing ones breaks downstream consumers.
    expect(CLI_EXIT_CODES).toEqual({
      ok: 0,
      userInputError: 1,
      runtimeError: 2,
      unsupportedCapability: 3,
      internal: 4,
    });
  });
});

describe('parseArgs', () => {
  it('returns help when no args given', () => {
    expect(parseArgs([])).toEqual({
      command: 'help',
      positionals: [],
      flags: { json: false, quiet: false, options: [], help: false },
    });
  });

  it('returns version on --version', () => {
    const parsed = parseArgs(['--version']);
    expect(parsed.command).toBe('version');
  });

  it('returns version on -v', () => {
    expect(parseArgs(['-v']).command).toBe('version');
  });

  it('rejects --version with extra args', () => {
    expect(() => parseArgs(['--version', 'extra'])).toThrow(CliUsageError);
  });

  it('returns help on --help', () => {
    const parsed = parseArgs(['--help']);
    expect(parsed.command).toBe('help');
    expect(parsed.flags.help).toBe(true);
  });

  describe('utility', () => {
    it('requires a positional utility id', () => {
      expect(() => parseArgs(['utility'])).toThrow(CliUsageError);
    });

    it('accepts a single utility id', () => {
      const parsed = parseArgs(['utility', 'json-format']);
      expect(parsed.command).toBe('utility');
      expect(parsed.positionals).toEqual(['json-format']);
    });

    it('rejects more than one positional', () => {
      expect(() => parseArgs(['utility', 'a', 'b'])).toThrow(CliUsageError);
    });

    it('parses --input as the next arg', () => {
      const parsed = parseArgs(['utility', 'json-format', '--input', '/tmp/x.json']);
      expect(parsed.flags.input).toBe('/tmp/x.json');
    });

    it('parses --input=path form', () => {
      const parsed = parseArgs(['utility', 'json-format', '--input=/tmp/x.json']);
      expect(parsed.flags.input).toBe('/tmp/x.json');
    });

    it('rejects --input without a value', () => {
      expect(() => parseArgs(['utility', 'json-format', '--input'])).toThrow(CliUsageError);
    });

    it('parses repeated --option key=value pairs', () => {
      const parsed = parseArgs([
        'utility',
        'regex-replace',
        '--option',
        'pattern=\\d+',
        '--option',
        'flags=g',
        '--option=replacement=N',
      ]);
      expect(parsed.flags.options).toEqual([
        { key: 'pattern', value: '\\d+' },
        { key: 'flags', value: 'g' },
        { key: 'replacement', value: 'N' },
      ]);
    });

    it('preserves "=" inside the value', () => {
      const parsed = parseArgs([
        'utility',
        'regex-replace',
        '--option',
        'replacement=a=b=c',
      ]);
      expect(parsed.flags.options[0]).toEqual({ key: 'replacement', value: 'a=b=c' });
    });

    it('rejects --option without a key', () => {
      expect(() =>
        parseArgs(['utility', 'json-format', '--option', '=value'])
      ).toThrow(CliUsageError);
    });

    it('rejects --option without an =', () => {
      expect(() =>
        parseArgs(['utility', 'json-format', '--option', 'noequals'])
      ).toThrow(CliUsageError);
    });

    it('rejects unknown flags', () => {
      expect(() =>
        parseArgs(['utility', 'json-format', '--magic'])
      ).toThrow(CliUsageError);
    });

    it('parses --json and --quiet together', () => {
      const parsed = parseArgs(['utility', 'json-format', '--json', '--quiet']);
      expect(parsed.flags.json).toBe(true);
      expect(parsed.flags.quiet).toBe(true);
    });
  });

  describe('capsule validate', () => {
    it('requires a file positional', () => {
      expect(() => parseArgs(['capsule', 'validate'])).toThrow(CliUsageError);
    });

    it('accepts a single file', () => {
      const parsed = parseArgs(['capsule', 'validate', '/tmp/run.json']);
      expect(parsed.command).toBe('capsule-validate');
      expect(parsed.positionals).toEqual(['/tmp/run.json']);
    });

    it('rejects unknown subcommand', () => {
      expect(() => parseArgs(['capsule', 'destroy', '/tmp/x'])).toThrow(CliUsageError);
    });

    it('rejects unknown flags', () => {
      expect(() =>
        parseArgs(['capsule', 'validate', '/tmp/x', '--input', '/tmp/y'])
      ).toThrow(CliUsageError);
    });

    it('parses --json + --quiet', () => {
      const parsed = parseArgs(['capsule', 'validate', '/tmp/x', '--json', '--quiet']);
      expect(parsed.flags.json).toBe(true);
      expect(parsed.flags.quiet).toBe(true);
    });
  });

  describe('list utilities', () => {
    it('requires the "utilities" subcommand', () => {
      expect(() => parseArgs(['list'])).toThrow(CliUsageError);
      expect(() => parseArgs(['list', 'pipelines'])).toThrow(CliUsageError);
    });

    it('returns help for list --help', () => {
      const parsed = parseArgs(['list', '--help']);
      expect(parsed.command).toBe('list-utilities');
      expect(parsed.flags.help).toBe(true);
    });

    it('parses list utilities --json', () => {
      const parsed = parseArgs(['list', 'utilities', '--json']);
      expect(parsed.command).toBe('list-utilities');
      expect(parsed.flags.json).toBe(true);
    });

    it('rejects unknown flags', () => {
      expect(() =>
        parseArgs(['list', 'utilities', '--input', 'foo'])
      ).toThrow(CliUsageError);
    });
  });

  it('rejects unknown top-level commands', () => {
    expect(() => parseArgs(['build'])).toThrow(CliUsageError);
  });
});
