/**
 * RL-030 locked the capability matrix as the decision record for where each
 * capability runs (browser WASM, browser interpreter, WebContainer, desktop
 * native, hybrid). The acceptance criterion is that every runtime and shell
 * feature has a documented recommended execution class. This test guards
 * that coverage so a silent doc edit cannot drop a decision without it
 * failing CI. It does not assert phrasing or opinions — only that each
 * required section is present and that the promotion rules haven't been
 * removed.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MATRIX_PATH = resolve(__dirname, '../../docs/CAPABILITY_MATRIX.md');
const matrix = readFileSync(MATRIX_PATH, 'utf-8');

const RUNTIME_CAPABILITIES = [
  'JavaScript execution',
  'TypeScript execution',
  'Python execution',
  'Go execution',
  'Rust execution',
  'Lua execution',
];

const SHELL_CAPABILITIES = [
  'Filesystem access',
  'File watching',
  'Updates',
  'Plugin discovery/load',
  'Deep-link protocol',
  'Local AI inference',
  'Formatter binaries',
];

const DECISION_SECTIONS = [
  'JavaScript and TypeScript',
  'Python',
  'Go',
  'Rust',
  'Lua',
  'Filesystem access',
  'File watching',
  'Updates',
  'Plugin discovery / loading',
  'Local AI inference',
];

describe('CAPABILITY_MATRIX.md', () => {
  it('names every execution class the RL-030 scope calls out', () => {
    for (const cls of [
      'Browser WASM',
      'Browser interpreter',
      'WebContainer',
      'Desktop native',
      'Hybrid',
    ]) {
      expect(matrix).toContain(cls);
    }
  });

  it('lists every runtime capability in the runtime matrix', () => {
    for (const capability of RUNTIME_CAPABILITIES) {
      expect(matrix).toContain(capability);
    }
  });

  it('lists every shell-level capability', () => {
    for (const capability of SHELL_CAPABILITIES) {
      expect(matrix).toContain(capability);
    }
  });

  it('keeps a decision record section per runtime and critical shell feature', () => {
    for (const section of DECISION_SECTIONS) {
      expect(matrix).toContain(`### ${section}`);
    }
  });

  it('retains the promotion rules section with the portability/privacy/maintainability bar', () => {
    expect(matrix).toContain('## Promotion rules');
    expect(matrix).toContain('Portability win');
    expect(matrix).toContain('Privacy win');
    expect(matrix).toContain('Maintainability win');
  });
});
