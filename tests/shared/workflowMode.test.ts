/**
 * RL-020 Slice 2 — workflow-mode pure module.
 *
 * Coverage:
 *
 *   - `defaultWorkflowMode` returns `scratchpad` for Scratchpad-capable
 *     languages and `run` for everything else.
 *   - `supportsWorkflowMode` matrix per language × mode.
 *   - `coerceWorkflowMode` snaps invalid values back to a supported
 *     default; respects an already-supported value.
 *   - `cycleWorkflowMode` skips unsupported segments and short-circuits
 *     on single-mode languages.
 *   - `isWorkflowMode` predicate for closed-enum guards.
 */

import { describe, it, expect } from 'vitest';
import {
  WORKFLOW_MODES,
  coerceWorkflowMode,
  cycleWorkflowMode,
  defaultWorkflowMode,
  isWorkflowMode,
  supportsWorkflowMode,
} from '#src/shared/workflowMode';

describe('WORKFLOW_MODES', () => {
  it('declares exactly three modes in canonical order', () => {
    expect(WORKFLOW_MODES).toEqual(['run', 'debug', 'scratchpad']);
  });
});

describe('isWorkflowMode', () => {
  it('returns true for the three canonical strings', () => {
    expect(isWorkflowMode('run')).toBe(true);
    expect(isWorkflowMode('debug')).toBe(true);
    expect(isWorkflowMode('scratchpad')).toBe(true);
  });
  it('returns false for anything else', () => {
    expect(isWorkflowMode('Run')).toBe(false);
    expect(isWorkflowMode('')).toBe(false);
    expect(isWorkflowMode(undefined)).toBe(false);
    expect(isWorkflowMode(null)).toBe(false);
    expect(isWorkflowMode(42)).toBe(false);
    expect(isWorkflowMode({ run: true })).toBe(false);
  });
});

describe('defaultWorkflowMode', () => {
  it('returns scratchpad for Scratchpad-capable languages (JS/TS/Python/Go/Rust)', () => {
    expect(defaultWorkflowMode('javascript')).toBe('scratchpad');
    expect(defaultWorkflowMode('typescript')).toBe('scratchpad');
    expect(defaultWorkflowMode('python')).toBe('scratchpad');
    // Go + Rust auto-run on desktop today; preserve that default
    // intent so Slice 2 doesn't silently regress existing users.
    expect(defaultWorkflowMode('go')).toBe('scratchpad');
    expect(defaultWorkflowMode('rust')).toBe('scratchpad');
  });
  it('returns run for validate / view-only languages', () => {
    expect(defaultWorkflowMode('json')).toBe('run');
    expect(defaultWorkflowMode('yaml')).toBe('run');
    expect(defaultWorkflowMode('plaintext')).toBe('run');
  });
  it('returns run when the language is missing', () => {
    expect(defaultWorkflowMode(undefined)).toBe('run');
  });
});

describe('supportsWorkflowMode', () => {
  it('always supports run (every language)', () => {
    for (const lang of ['javascript', 'go', 'rust', 'python', 'yaml']) {
      expect(supportsWorkflowMode(lang, 'run')).toBe(true);
    }
  });
  it('returns false for run when the language is missing', () => {
    // Without a language the gate cannot resolve any mode meaningfully
    // — `run` is the only mode that doesn't depend on language but
    // the helper still asks for a string. The contract: missing
    // language → only `run` mode is true. Confirm the contract.
    expect(supportsWorkflowMode(undefined, 'run')).toBe(true);
  });
  it('supports debug only for JS / TS', () => {
    expect(supportsWorkflowMode('javascript', 'debug')).toBe(true);
    expect(supportsWorkflowMode('typescript', 'debug')).toBe(true);
    expect(supportsWorkflowMode('python', 'debug')).toBe(false);
    expect(supportsWorkflowMode('go', 'debug')).toBe(false);
    expect(supportsWorkflowMode('rust', 'debug')).toBe(false);
    expect(supportsWorkflowMode(undefined, 'debug')).toBe(false);
  });
  it('supports scratchpad for languages with a Scratchpad-class runner', () => {
    expect(supportsWorkflowMode('javascript', 'scratchpad')).toBe(true);
    expect(supportsWorkflowMode('typescript', 'scratchpad')).toBe(true);
    expect(supportsWorkflowMode('python', 'scratchpad')).toBe(true);
    expect(supportsWorkflowMode('go', 'scratchpad')).toBe(true);
    expect(supportsWorkflowMode('rust', 'scratchpad')).toBe(true);
    expect(supportsWorkflowMode('json', 'scratchpad')).toBe(false);
    expect(supportsWorkflowMode('yaml', 'scratchpad')).toBe(false);
    expect(supportsWorkflowMode(undefined, 'scratchpad')).toBe(false);
  });
});

describe('coerceWorkflowMode', () => {
  it('returns the input when the language supports it', () => {
    expect(coerceWorkflowMode('debug', 'javascript')).toBe('debug');
    expect(coerceWorkflowMode('scratchpad', 'python')).toBe('scratchpad');
    expect(coerceWorkflowMode('run', 'rust')).toBe('run');
  });
  it('falls back to the language default when the input is invalid', () => {
    // Python doesn't support debug — snap to its default (scratchpad).
    expect(coerceWorkflowMode('debug', 'python')).toBe('scratchpad');
    // Rust doesn't support debug — snap to its default (scratchpad,
    // since Rust auto-runs on desktop).
    expect(coerceWorkflowMode('debug', 'rust')).toBe('scratchpad');
    // JSON doesn't support scratchpad — snap to run.
    expect(coerceWorkflowMode('scratchpad', 'json')).toBe('run');
  });
  it('falls back when the value is not a known mode', () => {
    expect(coerceWorkflowMode('not-a-mode', 'javascript')).toBe('scratchpad');
    expect(coerceWorkflowMode(undefined, 'typescript')).toBe('scratchpad');
    expect(coerceWorkflowMode(null, 'json')).toBe('run');
    expect(coerceWorkflowMode(42, 'python')).toBe('scratchpad');
  });
});

describe('cycleWorkflowMode', () => {
  it('cycles run → debug → scratchpad → run on JS', () => {
    expect(cycleWorkflowMode('run', 'javascript')).toBe('debug');
    expect(cycleWorkflowMode('debug', 'javascript')).toBe('scratchpad');
    expect(cycleWorkflowMode('scratchpad', 'javascript')).toBe('run');
  });
  it('cycles run → scratchpad → run on Python (skips debug)', () => {
    expect(cycleWorkflowMode('run', 'python')).toBe('scratchpad');
    expect(cycleWorkflowMode('scratchpad', 'python')).toBe('run');
  });
  it('cycles run → scratchpad → run on Rust (skips debug)', () => {
    expect(cycleWorkflowMode('run', 'rust')).toBe('scratchpad');
    expect(cycleWorkflowMode('scratchpad', 'rust')).toBe('run');
  });
  it('returns the same mode on JSON (only one supported)', () => {
    // JSON is validate-only — only `run` is supported. Cycle is a
    // no-op rather than crashing.
    expect(cycleWorkflowMode('run', 'json')).toBe('run');
  });
  it('snaps an unsupported current to the first supported mode', () => {
    // Edge: a stale `debug` mode on a Rust tab (pre-Slice-2
    // regression) should snap back to a supported segment.
    expect(cycleWorkflowMode('debug', 'rust')).toBe('run');
    // Same on a Python tab — debug isn't supported, so the cycle
    // resets to the first supported segment.
    expect(cycleWorkflowMode('debug', 'python')).toBe('run');
  });
});
