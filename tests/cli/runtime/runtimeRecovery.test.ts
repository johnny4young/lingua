// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  buildMissingRuntimeRecovery,
  CLI_RUNTIME_HELP_URL,
} from '../../../src/cli/runtime/runtimeRecovery';

describe('CLI missing runtime recovery', () => {
  it.each([
    ['python3', 'python', 'Python', 'brew install python', 'python3 --version'],
    ['go', 'go-project', 'Go', 'brew install go', 'go --version'],
    ['rustc', 'rust', 'Rust', 'brew install rust', 'rustc --version'],
    ['cargo', 'cargo', 'Rust', 'brew install rust', 'rustc --version'],
    ['ruby', 'ruby', 'Ruby', 'brew install ruby', 'ruby --version'],
    ['lua', 'lua', 'Lua', 'brew install lua', 'lua --version'],
  ])(
    'provides an actionable macOS path for %s',
    (command, runtime, name, installCommand, verifyCommand) => {
      const result = buildMissingRuntimeRecovery(command, runtime, 'darwin');

      expect(result.recovery).toMatchObject({
        runtime: name,
        executable: command,
        installCommand,
        verifyCommand,
      });
      expect(result.detail).toContain(`${name} is required for this run`);
      expect(result.detail).toContain(`  ${installCommand}`);
      expect(result.detail).toContain(`  ${verifyCommand}`);
      expect(result.detail).toContain(CLI_RUNTIME_HELP_URL);
    }
  );

  it('uses the official setup guide without claiming Homebrew on other platforms', () => {
    const result = buildMissingRuntimeRecovery('python3', 'python', 'linux');

    expect(result.recovery.installCommand).toBeUndefined();
    expect(result.detail).toContain('https://www.python.org/downloads/');
    expect(result.detail).not.toContain('brew install');
  });

  it('keeps unknown executables actionable without inventing an installer', () => {
    const result = buildMissingRuntimeRecovery('custom-tool', 'custom', 'darwin');

    expect(result.recovery).toEqual({
      runtime: 'custom',
      executable: 'custom-tool',
      installGuide: CLI_RUNTIME_HELP_URL,
      verifyCommand: 'custom-tool --version',
    });
    expect(result.detail).not.toContain('brew install');
  });
});
