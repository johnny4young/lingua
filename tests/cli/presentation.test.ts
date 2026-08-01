// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import { emitCliFailure, shouldUseColor } from '../../src/cli/presentation';
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
