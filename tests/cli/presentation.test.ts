// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import {
  emitCliFailure,
  neutralizeControlCharacters,
  renderCliNotice,
  shouldUseColor,
} from '../../src/cli/presentation';
import { createFakeIo } from './io-fake';

describe('CLI presentation', () => {
  it('uses destination capabilities in auto mode', () => {
    const { io } = createFakeIo({ stdoutSupportsColor: true, stderrSupportsColor: false });
    expect(shouldUseColor(io, 'auto', 'stdout')).toBe(true);
    expect(shouldUseColor(io, 'auto', 'stderr')).toBe(false);
  });

  it('honors NO_COLOR in auto mode while allowing an explicit override', () => {
    const { io } = createFakeIo({
      stderrSupportsColor: true,
      environment: { NO_COLOR: '' },
    });
    expect(shouldUseColor(io, 'auto', 'stderr')).toBe(false);
    expect(shouldUseColor(io, 'always', 'stderr')).toBe(true);
  });

  it('emits one stable human failure shape', () => {
    const { io, state } = createFakeIo();
    emitCliFailure(
      io,
      { json: false, quiet: false, color: 'never' },
      { label: 'lingua run', reason: 'missing-runtime', detail: 'Lua is unavailable.' }
    );
    expect(state.stderr).toBe('lingua run: error[missing-runtime]: Lua is unavailable.\n');
  });

  it('never writes ANSI into structured JSON', () => {
    const { io, state } = createFakeIo({ stdoutSupportsColor: true });
    emitCliFailure(
      io,
      { json: true, quiet: false, color: 'always' },
      { label: 'lingua', reason: 'invalid-arguments', detail: 'Bad input.' }
    );
    expect(state.stdout).not.toContain('\u001b[');
    expect(JSON.parse(state.stdout)).toEqual({
      ok: false,
      reason: 'invalid-arguments',
      detail: 'Bad input.',
    });
  });
});

describe('neutralizeControlCharacters', () => {
  it.each([
    ['ESC sequences and carriage returns', 'a\u001b[2K\rb', 'a\\x1b[2K\\x0db'],
    ['C1 control introducers', 'x\u009by', 'x\\x9by'],
    ['DEL', 'x\u007fy', 'x\\x7fy'],
  ])('escapes %s', (_name, input, expected) => {
    expect(neutralizeControlCharacters(input)).toBe(expected);
  });

  it('keeps newlines, tabs and non-ASCII text', () => {
    expect(neutralizeControlCharacters('línea 1\n\tcafé ☕')).toBe('línea 1\n\tcafé ☕');
  });
});

describe('diagnostics built from untrusted text', () => {
  it('neutralizes control characters in a human failure detail', () => {
    const { io, state } = createFakeIo();

    emitCliFailure(
      io,
      { json: false, quiet: false, color: 'never' },
      {
        label: 'lingua repro review',
        reason: 'invalid-json',
        detail: 'Unexpected token \u001b]52;c;',
      }
    );

    expect(state.stderr).toBe(
      'lingua repro review: error[invalid-json]: Unexpected token \\x1b]52;c;\n'
    );
  });

  it('neutralizes control characters in a notice', () => {
    const { io } = createFakeIo();

    expect(renderCliNotice(io, 'never', 'removed \u001b[2Kstaging')).toBe(
      'removed \\x1b[2Kstaging'
    );
  });
});
