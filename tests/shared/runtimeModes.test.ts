/**
 * RL-019 Slice 1 unit tests for the shared `runtimeModes` module.
 *
 * Pins the closed enum, the per-language default helper, the
 * implementation-status guard, the rehydrate coercion, and the
 * cycle helper used by the `Mod+Alt+M` shortcut (fold D).
 */

import { describe, expect, it } from 'vitest';
import {
  RUNTIME_MODES,
  coerceRuntimeMode,
  cycleRuntimeMode,
  defaultRuntimeModeFor,
  isRuntimeModeImplemented,
  languageHasRuntimeModes,
} from '#src/shared/runtimeModes';

describe('RUNTIME_MODES enum', () => {
  it('has exactly three modes in the expected order', () => {
    expect([...RUNTIME_MODES]).toEqual(['worker', 'node', 'browser-preview']);
  });
});

describe('languageHasRuntimeModes', () => {
  it.each([
    ['javascript', true],
    ['typescript', true],
    ['python', false],
    ['go', false],
    ['rust', false],
    ['ruby', false],
    ['markdown', false],
    [undefined, false],
    ['' as string, false],
  ])('returns %s for %s', (language, expected) => {
    expect(languageHasRuntimeModes(language as string | undefined)).toBe(expected);
  });
});

describe('defaultRuntimeModeFor', () => {
  it('returns worker for JS/TS', () => {
    expect(defaultRuntimeModeFor('javascript')).toBe('worker');
    expect(defaultRuntimeModeFor('typescript')).toBe('worker');
  });

  it('returns null for non-JS/TS so the field stays absent', () => {
    expect(defaultRuntimeModeFor('python')).toBeNull();
    expect(defaultRuntimeModeFor('go')).toBeNull();
    expect(defaultRuntimeModeFor(undefined)).toBeNull();
  });
});

describe('isRuntimeModeImplemented (Slice 1)', () => {
  it('only worker is implemented today', () => {
    expect(isRuntimeModeImplemented('worker')).toBe(true);
    expect(isRuntimeModeImplemented('node')).toBe(false);
    expect(isRuntimeModeImplemented('browser-preview')).toBe(false);
  });
});

describe('coerceRuntimeMode (rehydrate defensive)', () => {
  it('preserves worker on JS/TS', () => {
    expect(coerceRuntimeMode('worker', 'javascript')).toBe('worker');
    expect(coerceRuntimeMode('worker', 'typescript')).toBe('worker');
  });

  it('coerces unimplemented persisted values back to worker for JS/TS', () => {
    expect(coerceRuntimeMode('node', 'javascript')).toBe('worker');
    expect(coerceRuntimeMode('browser-preview', 'typescript')).toBe('worker');
  });

  it('coerces unknown strings to worker for JS/TS', () => {
    expect(coerceRuntimeMode('lol-injected', 'javascript')).toBe('worker');
    expect(coerceRuntimeMode(42, 'javascript')).toBe('worker');
    expect(coerceRuntimeMode(null, 'javascript')).toBe('worker');
    expect(coerceRuntimeMode(undefined, 'javascript')).toBe('worker');
  });

  it('returns null for non-JS/TS regardless of input', () => {
    expect(coerceRuntimeMode('worker', 'python')).toBeNull();
    expect(coerceRuntimeMode('node', 'go')).toBeNull();
    expect(coerceRuntimeMode(undefined, 'rust')).toBeNull();
  });
});

describe('parity with telemetry RUNTIME_MODE_VALUES', () => {
  it('RUNTIME_MODES stays in sync with telemetry value-validator enum', async () => {
    // The redactor in `src/shared/telemetry.ts` uses a private
    // `RUNTIME_MODE_VALUES` Set to validate the `mode` property of
    // `runtime.mode_changed` events. The two arrays must equal each
    // other byte-for-byte so a new mode added to one side cannot be
    // silently rejected by the other.
    //
    // We grep the source for the RUNTIME_MODE_VALUES literal
    // because the Set is module-private. `process.cwd()` is the
    // repo root under vitest. If a future refactor exposes the Set
    // via an export, replace this with a structural import.
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const filePath = path.resolve(process.cwd(), 'src/shared/telemetry.ts');
    const telemetrySource = await fs.readFile(filePath, 'utf-8');
    const setLine = telemetrySource.match(
      /const\s+RUNTIME_MODE_VALUES\s*=\s*new\s+Set\(\s*\[([^\]]+)\]\s*\)/u
    );
    expect(setLine, 'RUNTIME_MODE_VALUES literal not found in shared/telemetry.ts').not.toBeNull();
    const literalValues = [...(setLine![1] ?? '').matchAll(/'([^']+)'/gu)]
      .map((match) => match[1]!)
      .sort();
    const enumValues = [...RUNTIME_MODES].sort();
    expect(literalValues).toEqual(enumValues);
  });
});

describe('cycleRuntimeMode (fold D)', () => {
  it('is a no-op when only one mode is implemented (Slice 1)', () => {
    // Slice 1 ships only `worker`. The cycle helper guards against
    // an infinite loop and returns `current` unchanged.
    expect(cycleRuntimeMode('worker')).toBe('worker');
  });

  it('returns the only implemented mode when current is an unimplemented value', () => {
    // Defensive — caller shouldn't hand `node` to the cycle helper
    // today, but if a future regression does, the helper picks the
    // first implemented option instead of crashing.
    expect(cycleRuntimeMode('node')).toBe('worker');
    expect(cycleRuntimeMode('browser-preview')).toBe('worker');
  });
});
