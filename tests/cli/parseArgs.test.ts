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
      flags: {
        json: false,
        quiet: false,
        color: 'auto',
        options: [],
        env: [],
        programArgs: [],
        help: false,
        yes: false,
        dryRun: false,
      },
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

  it('parses one global color policy before or after the command', () => {
    expect(parseArgs(['--color=always', 'run', './index.js']).flags.color).toBe('always');
    expect(parseArgs(['run', './index.js', '--color', 'never']).flags.color).toBe('never');
  });

  it('rejects invalid or repeated color policies', () => {
    expect(() => parseArgs(['--color=sometimes', '--help'])).toThrow(CliUsageError);
    expect(() => parseArgs(['--color=always', '--color=never', '--help'])).toThrow(CliUsageError);
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
      const parsed = parseArgs(['utility', 'regex-replace', '--option', 'replacement=a=b=c']);
      expect(parsed.flags.options[0]).toEqual({ key: 'replacement', value: 'a=b=c' });
    });

    it('rejects --option without a key', () => {
      expect(() => parseArgs(['utility', 'json-format', '--option', '=value'])).toThrow(
        CliUsageError
      );
    });

    it('rejects --option without an =', () => {
      expect(() => parseArgs(['utility', 'json-format', '--option', 'noequals'])).toThrow(
        CliUsageError
      );
    });

    it('rejects unknown flags', () => {
      expect(() => parseArgs(['utility', 'json-format', '--magic'])).toThrow(CliUsageError);
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
      expect(() => parseArgs(['capsule', 'validate', '/tmp/x', '--input', '/tmp/y'])).toThrow(
        CliUsageError
      );
    });

    it('parses --json + --quiet', () => {
      const parsed = parseArgs(['capsule', 'validate', '/tmp/x', '--json', '--quiet']);
      expect(parsed.flags.json).toBe(true);
      expect(parsed.flags.quiet).toBe(true);
    });
  });

  describe('run', () => {
    it('parses execution controls and forwards args only after the separator', () => {
      const parsed = parseArgs([
        'run',
        './script.js',
        '--stdin',
        'input.txt',
        '--timeout=1500',
        '--env',
        'MODE=test',
        '--json',
        '--',
        '--name',
        'Lingua',
      ]);
      expect(parsed.command).toBe('run');
      expect(parsed.positionals).toEqual(['./script.js']);
      expect(parsed.flags.stdin).toBe('input.txt');
      expect(parsed.flags.timeoutMs).toBe(1500);
      expect(parsed.flags.env).toEqual([{ key: 'MODE', value: 'test' }]);
      expect(parsed.flags.programArgs).toEqual(['--name', 'Lingua']);
      expect(parsed.flags.json).toBe(true);
    });

    it('preserves --color after the program-argument separator', () => {
      const parsed = parseArgs(['run', './script.js', '--', '--color=always']);
      expect(parsed.flags.color).toBe('auto');
      expect(parsed.flags.programArgs).toEqual(['--color=always']);
    });

    it('rejects missing or multiple targets', () => {
      expect(() => parseArgs(['run'])).toThrow(CliUsageError);
      expect(() => parseArgs(['run', 'one.js', 'two.js'])).toThrow(CliUsageError);
    });

    it('rejects unsafe timeout and malformed environment syntax', () => {
      expect(() => parseArgs(['run', 'one.js', '--timeout', '99'])).toThrow(CliUsageError);
      expect(() => parseArgs(['run', 'one.js', '--timeout', 'forever'])).toThrow(CliUsageError);
      expect(() => parseArgs(['run', 'one.js', '--env', '1BAD=value'])).toThrow(CliUsageError);
    });
  });

  describe('capsule replay', () => {
    it('parses a replay target with timeout and explicit environment', () => {
      const parsed = parseArgs([
        'capsule',
        'replay',
        './run.capsule.json',
        '--timeout',
        '2000',
        '--env=MODE=replay',
        '--quiet',
      ]);
      expect(parsed.command).toBe('capsule-replay');
      expect(parsed.positionals).toEqual(['./run.capsule.json']);
      expect(parsed.flags.timeoutMs).toBe(2000);
      expect(parsed.flags.env).toEqual([{ key: 'MODE', value: 'replay' }]);
      expect(parsed.flags.quiet).toBe(true);
    });

    it('rejects passthrough arguments because replay preserves recorded args', () => {
      expect(() => parseArgs(['capsule', 'replay', './run.json', '--', '--override'])).toThrow(
        CliUsageError
      );
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
      expect(() => parseArgs(['list', 'utilities', '--input', 'foo'])).toThrow(CliUsageError);
    });
  });

  describe('completion', () => {
    it.each(['bash', 'zsh', 'fish'] as const)('accepts the %s shell', shell => {
      const parsed = parseArgs(['completion', shell]);
      expect(parsed.command).toBe('completion');
      expect(parsed.positionals).toEqual([shell]);
    });

    it('routes a missing target or install to the guided installer', () => {
      expect(parseArgs(['completion']).command).toBe('completion-install');
      expect(parseArgs(['completion', 'install']).command).toBe('completion-install');
      const approved = parseArgs(['completion', 'install', '--yes']);
      expect(approved.flags.yes).toBe(true);
      const preview = parseArgs(['completion', '--dry-run']);
      expect(preview.flags.dryRun).toBe(true);
    });

    it('rejects an unknown target or install-only flags on generators', () => {
      expect(() => parseArgs(['completion', 'powershell'])).toThrow(CliUsageError);
      expect(() => parseArgs(['completion', 'zsh', '--yes'])).toThrow(CliUsageError);
    });
  });

  it('rejects unknown top-level commands', () => {
    expect(() => parseArgs(['build'])).toThrow(CliUsageError);
  });
});
