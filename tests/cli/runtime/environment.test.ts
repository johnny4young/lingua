// SPDX-License-Identifier: MIT

import { afterEach, describe, expect, it } from 'vitest';

import {
  CliEnvironmentError,
  buildCliRuntimeEnvironment,
} from '../../../src/cli/runtime/environment';

const originalSecret = process.env.LINGUA_CLI_TEST_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.LINGUA_CLI_TEST_SECRET;
  else process.env.LINGUA_CLI_TEST_SECRET = originalSecret;
});

describe('CLI runtime environment', () => {
  it('does not leak arbitrary parent secrets and layers explicit values', () => {
    process.env.LINGUA_CLI_TEST_SECRET = 'must-not-leak';
    const env = buildCliRuntimeEnvironment([
      { key: 'MODE', value: 'test' },
      { key: 'MODE', value: 'last-wins' },
    ]);
    expect(env.LINGUA_CLI_TEST_SECRET).toBeUndefined();
    expect(env.MODE).toBe('last-wins');
    expect(env.PATH).toBe(process.env.PATH);
  });

  it('blocks dynamic-loader and Node option injection', () => {
    for (const key of ['NODE_OPTIONS', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES']) {
      expect(() => buildCliRuntimeEnvironment([{ key, value: 'inject' }])).toThrow(
        CliEnvironmentError
      );
    }
  });
});
