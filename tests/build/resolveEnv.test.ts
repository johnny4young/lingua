/**
 * Precedence contract for the shared build-time env cascade
 * (`build/resolveEnv.mts`): process.env NAME beats process.env
 * VITE_NAME beats .env-file NAME beats .env-file VITE_NAME beats ''.
 * The order matters — dev launchers rely on process.env overriding the
 * baked `.env.production` values without a rebuild.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { resolveBuildTimeEnvVar } from '../../build/resolveEnv.mts';

const NAME = 'LINGUA_TEST_RESOLVE_ENV_VAR';
const VITE_NAME = `VITE_${NAME}`;

afterEach(() => {
  delete process.env[NAME];
  delete process.env[VITE_NAME];
});

describe('resolveBuildTimeEnvVar', () => {
  it('prefers process.env NAME over every other source', () => {
    process.env[NAME] = 'proc-plain';
    process.env[VITE_NAME] = 'proc-vite';
    const fileEnv = { [NAME]: 'file-plain', [VITE_NAME]: 'file-vite' };
    expect(resolveBuildTimeEnvVar(fileEnv, NAME)).toBe('proc-plain');
  });

  it('falls back to process.env VITE_NAME', () => {
    process.env[VITE_NAME] = 'proc-vite';
    const fileEnv = { [NAME]: 'file-plain', [VITE_NAME]: 'file-vite' };
    expect(resolveBuildTimeEnvVar(fileEnv, NAME)).toBe('proc-vite');
  });

  it('falls back to the .env file plain name', () => {
    const fileEnv = { [NAME]: 'file-plain', [VITE_NAME]: 'file-vite' };
    expect(resolveBuildTimeEnvVar(fileEnv, NAME)).toBe('file-plain');
  });

  it('falls back to the .env file VITE alias', () => {
    const fileEnv = { [VITE_NAME]: 'file-vite' };
    expect(resolveBuildTimeEnvVar(fileEnv, NAME)).toBe('file-vite');
  });

  it('resolves to the empty string when no source provides the variable (fail closed)', () => {
    expect(resolveBuildTimeEnvVar({}, NAME)).toBe('');
  });

  it('treats an empty-string source as unset and keeps cascading', () => {
    process.env[NAME] = '';
    const fileEnv = { [VITE_NAME]: 'file-vite' };
    expect(resolveBuildTimeEnvVar(fileEnv, NAME)).toBe('file-vite');
  });
});
