// SPDX-License-Identifier: MIT

import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CLI_TOP_LEVEL_COMMANDS } from '../../src/cli/commandModel';
import { renderCompletion } from '../../src/cli/completion';
import { UTILITY_ADAPTER_IDS } from '../../src/shared/utilities/types';

describe('shell completions', () => {
  it.each(['bash', 'zsh', 'fish'] as const)('renders deterministic %s output', shell => {
    const first = renderCompletion(shell);
    expect(first).toBe(renderCompletion(shell));
    expect(first.endsWith('\n')).toBe(true);
    expect(first).toContain('completion');
    expect(first).toContain('auto');
    expect(first).toContain('always');
    expect(first).toContain('never');
    expect(first).not.toContain('\u001b[');
  });

  it.each(UTILITY_ADAPTER_IDS)('offers the %s utility', utilityId => {
    expect(renderCompletion('bash')).toContain(utilityId);
    expect(renderCompletion('zsh')).toContain(utilityId);
    expect(renderCompletion('fish')).toContain(utilityId);
  });

  it.each(CLI_TOP_LEVEL_COMMANDS)('offers the %s top-level command in every shell', command => {
    expect(renderCompletion('bash')).toContain(command);
    expect(renderCompletion('zsh')).toContain(command);
    expect(renderCompletion('fish')).toContain(command);
  });

  it('passes bash syntax validation', () => {
    const result = spawnSync('bash', ['-n'], {
      input: renderCompletion('bash'),
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('completes commands and utilities after a global color option in bash', () => {
    const script = `${renderCompletion('bash')}
COMP_WORDS=(lingua --color always utility json-f)
COMP_CWORD=4
_lingua
printf '%s\\n' "\${COMPREPLY[@]}"
`;
    const result = spawnSync('bash', [], { input: script, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe('json-format');
  });

  it('passes zsh syntax validation when zsh is installed', () => {
    const available = spawnSync('zsh', ['--version'], { encoding: 'utf8' }).status === 0;
    if (!available) return;
    const result = spawnSync('zsh', ['-n'], {
      input: renderCompletion('zsh'),
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  });

  it('passes fish syntax validation when fish is installed', () => {
    const available = spawnSync('fish', ['--version'], { encoding: 'utf8' }).status === 0;
    if (!available) return;
    const result = spawnSync('fish', ['--no-config', '--no-execute'], {
      input: renderCompletion('fish'),
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  });
});
