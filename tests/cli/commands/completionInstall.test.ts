import { describe, expect, it } from 'vitest';
import {
  detectCompletionTargets,
  runCompletionInstallCommand,
  type CompletionInstallDependencies,
} from '../../../src/cli/commands/completionInstall';
import { CLI_EXIT_CODES } from '../../../src/cli/exit-codes';
import { createFakeIo } from '../io-fake';

function createDependencies(executables: ReadonlyArray<string>) {
  const files = new Map<string, string>();
  const directories: string[] = [];
  const dependencies: CompletionInstallDependencies = {
    homedir: () => '/home/fallback',
    async isExecutable(filePath) {
      return executables.includes(filePath);
    },
    async mkdir(directoryPath) {
      directories.push(directoryPath);
    },
    async writeFile(filePath, contents) {
      files.set(filePath, contents);
    },
    async readFileIfPresent(filePath) {
      return files.get(filePath) ?? null;
    },
    async appendFile(filePath, contents) {
      files.set(filePath, `${files.get(filePath) ?? ''}${contents}`);
    },
  };
  return { dependencies, directories, files };
}

const environment = {
  HOME: '/home/tester',
  SHELL: '/bin/zsh',
  PATH: '/bin:/opt/bin',
};

describe('completion install', () => {
  it('detects every supported shell on PATH and marks the current shell', async () => {
    const { io } = createFakeIo({ environment });
    const { dependencies } = createDependencies(['/bin/bash', '/bin/zsh', '/opt/bin/fish']);

    const targets = await detectCompletionTargets(io, dependencies);

    expect(targets).toEqual([
      expect.objectContaining({
        shell: 'bash',
        executablePath: '/bin/bash',
        completionPath: '/home/tester/.local/share/bash-completion/completions/lingua',
        current: false,
      }),
      expect.objectContaining({
        shell: 'zsh',
        executablePath: '/bin/zsh',
        completionPath: '/home/tester/.zfunc/_lingua',
        activationPath: '/home/tester/.zshrc',
        current: true,
      }),
      expect.objectContaining({
        shell: 'fish',
        executablePath: '/opt/bin/fish',
        completionPath: '/home/tester/.config/fish/completions/lingua.fish',
        current: false,
      }),
    ]);
  });

  it('offers one confirmation and installs every detected completion idempotently', async () => {
    const fake = createFakeIo({ environment, confirm: true });
    const system = createDependencies(['/bin/bash', '/bin/zsh', '/opt/bin/fish']);
    system.files.set('/home/tester/.zshrc', 'export EDITOR=vim\n');

    const first = await runCompletionInstallCommand(
      { assumeYes: false, dryRun: false },
      fake.io,
      system.dependencies
    );
    const second = await runCompletionInstallCommand(
      { assumeYes: true, dryRun: false },
      fake.io,
      system.dependencies
    );

    expect(first).toBe(CLI_EXIT_CODES.ok);
    expect(second).toBe(CLI_EXIT_CODES.ok);
    expect(fake.state.prompts).toEqual(['Install completion support for bash, zsh, fish?']);
    expect(system.files.get('/home/tester/.local/share/bash-completion/completions/lingua')).toContain(
      '# lingua bash completion'
    );
    expect(system.files.get('/home/tester/.zfunc/_lingua')).toContain('# lingua zsh completion');
    expect(system.files.get('/home/tester/.config/fish/completions/lingua.fish')).toContain(
      '# lingua fish completion'
    );
    const zshrc = system.files.get('/home/tester/.zshrc') ?? '';
    expect(zshrc).toContain('export EDITOR=vim');
    expect(zshrc.match(/# >>> lingua completion >>>/gu)).toHaveLength(1);
    expect(zshrc).toContain('fpath=("${ZDOTDIR:-$HOME}/.zfunc" $fpath)');
  });

  it('does not write when the user declines or requests a dry run', async () => {
    const declined = createFakeIo({ environment, confirm: false });
    const declinedSystem = createDependencies(['/bin/zsh']);
    expect(
      await runCompletionInstallCommand(
        { assumeYes: false, dryRun: false },
        declined.io,
        declinedSystem.dependencies
      )
    ).toBe(CLI_EXIT_CODES.ok);
    expect(declinedSystem.files.size).toBe(0);
    expect(declined.state.stdout).toContain('Cancelled. No files were changed.');

    const dryRun = createFakeIo({ environment });
    const dryRunSystem = createDependencies(['/bin/zsh']);
    expect(
      await runCompletionInstallCommand(
        { assumeYes: false, dryRun: true },
        dryRun.io,
        dryRunSystem.dependencies
      )
    ).toBe(CLI_EXIT_CODES.ok);
    expect(dryRunSystem.files.size).toBe(0);
    expect(dryRun.state.prompts).toEqual([]);
    expect(dryRun.state.stdout).toContain('Dry run: no files were changed.');
  });

  it('fails closed without a TTY unless --yes is provided', async () => {
    const fake = createFakeIo({ environment, confirm: null });
    const { dependencies, files } = createDependencies(['/bin/zsh']);

    const code = await runCompletionInstallCommand(
      { assumeYes: false, dryRun: false },
      fake.io,
      dependencies
    );

    expect(code).toBe(CLI_EXIT_CODES.userInputError);
    expect(files.size).toBe(0);
    expect(fake.state.stderr).toContain('confirmation-required');
    expect(fake.state.stderr).toContain('completion install --yes');
  });

  it('reports when no supported shell is available', async () => {
    const fake = createFakeIo({ environment: { HOME: '/home/tester', PATH: '/empty' } });
    const { dependencies } = createDependencies([]);

    const code = await runCompletionInstallCommand(
      { assumeYes: true, dryRun: false },
      fake.io,
      dependencies
    );

    expect(code).toBe(CLI_EXIT_CODES.unsupportedCapability);
    expect(fake.state.stderr).toContain('no-supported-shells');
  });
});
