// SPDX-License-Identifier: MIT
/** Guided, idempotent shell-completion installation for the headless CLI. */

import { constants } from 'node:fs';
import { access, appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CLI_COMPLETION_SHELLS,
  type CliCompletionShell,
} from '../commandModel';
import { renderCompletion } from '../completion';
import { CLI_EXIT_CODES, type CliExitCode } from '../exit-codes';
import type { CliIo } from '../io';
import { emitCliFailure } from '../presentation';

const ZSH_BLOCK_START = '# >>> lingua completion >>>';
const ZSH_BLOCK_END = '# <<< lingua completion <<<';
const ZSH_BLOCK = `${ZSH_BLOCK_START}
fpath=("\${ZDOTDIR:-$HOME}/.zfunc" $fpath)
autoload -Uz compinit
compinit
${ZSH_BLOCK_END}`;

export interface CompletionInstallOptions {
  assumeYes: boolean;
  dryRun: boolean;
}
export interface CompletionInstallTarget {
  shell: CliCompletionShell;
  executablePath: string;
  completionPath: string;
  current: boolean;
  activationPath?: string;
}

export interface CompletionInstallDependencies {
  homedir(): string;
  isExecutable(filePath: string): Promise<boolean>;
  mkdir(directoryPath: string): Promise<void>;
  writeFile(filePath: string, contents: string): Promise<void>;
  readFileIfPresent(filePath: string): Promise<string | null>;
  appendFile(filePath: string, contents: string): Promise<void>;
}

const defaultDependencies: CompletionInstallDependencies = {
  homedir: os.homedir,
  async isExecutable(filePath) {
    try {
      await access(filePath, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(directoryPath) {
    await mkdir(directoryPath, { recursive: true });
  },
  async writeFile(filePath, contents) {
    await writeFile(filePath, contents, 'utf8');
  },
  async readFileIfPresent(filePath) {
    try {
      return await readFile(filePath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  },
  async appendFile(filePath, contents) {
    await appendFile(filePath, contents, 'utf8');
  },
};

function shellFromExecutable(executablePath: string | undefined): CliCompletionShell | undefined {
  if (!executablePath) return undefined;
  const name = path.basename(executablePath);
  return (CLI_COMPLETION_SHELLS as readonly string[]).includes(name)
    ? (name as CliCompletionShell)
    : undefined;
}

function completionPathForShell(
  shell: CliCompletionShell,
  io: CliIo,
  dependencies: CompletionInstallDependencies
): { completionPath: string; activationPath?: string } {
  const home = io.getEnvironmentValue('HOME') || dependencies.homedir();
  switch (shell) {
    case 'bash': {
      const dataHome = io.getEnvironmentValue('XDG_DATA_HOME') || path.join(home, '.local/share');
      return {
        completionPath: path.join(dataHome, 'bash-completion/completions/lingua'),
      };
    }
    case 'zsh': {
      const zshHome = io.getEnvironmentValue('ZDOTDIR') || home;
      return {
        completionPath: path.join(zshHome, '.zfunc/_lingua'),
        activationPath: path.join(zshHome, '.zshrc'),
      };
    }
    case 'fish': {
      const configHome = io.getEnvironmentValue('XDG_CONFIG_HOME') || path.join(home, '.config');
      return {
        completionPath: path.join(configHome, 'fish/completions/lingua.fish'),
      };
    }
  }
}

async function resolveExecutable(
  shell: CliCompletionShell,
  io: CliIo,
  dependencies: CompletionInstallDependencies
): Promise<string | undefined> {
  const currentShellPath = io.getEnvironmentValue('SHELL');
  if (
    shellFromExecutable(currentShellPath) === shell &&
    currentShellPath !== undefined &&
    (await dependencies.isExecutable(currentShellPath))
  ) {
    return currentShellPath;
  }

  const pathEntries = (io.getEnvironmentValue('PATH') || '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const directory of pathEntries) {
    const candidate = path.join(directory, shell);
    if (await dependencies.isExecutable(candidate)) return candidate;
  }
  return undefined;
}

export async function detectCompletionTargets(
  io: CliIo,
  dependencies: CompletionInstallDependencies = defaultDependencies
): Promise<CompletionInstallTarget[]> {
  const currentShell = shellFromExecutable(io.getEnvironmentValue('SHELL'));
  const targets: CompletionInstallTarget[] = [];
  for (const shell of CLI_COMPLETION_SHELLS) {
    const executablePath = await resolveExecutable(shell, io, dependencies);
    if (!executablePath) continue;
    const paths = completionPathForShell(shell, io, dependencies);
    targets.push({
      shell,
      executablePath,
      completionPath: paths.completionPath,
      current: shell === currentShell,
      ...(paths.activationPath ? { activationPath: paths.activationPath } : {}),
    });
  }
  return targets;
}

function renderPlan(targets: ReadonlyArray<CompletionInstallTarget>): string {
  const lines = ['Lingua detected these supported shells:'];
  for (const target of targets) {
    lines.push(
      `  ${target.current ? '●' : '○'} ${target.shell}${target.current ? ' (current)' : ''}`,
      `    completion: ${target.completionPath}`
    );
    if (target.activationPath) lines.push(`    activation: ${target.activationPath}`);
  }
  return `${lines.join('\n')}\n`;
}

async function ensureZshActivation(
  rcPath: string,
  dependencies: CompletionInstallDependencies
): Promise<void> {
  const current = await dependencies.readFileIfPresent(rcPath);
  if (current?.includes(ZSH_BLOCK_START) && current.includes(ZSH_BLOCK_END)) {
    const start = current.indexOf(ZSH_BLOCK_START);
    const end = current.indexOf(ZSH_BLOCK_END, start) + ZSH_BLOCK_END.length;
    const updated = `${current.slice(0, start)}${ZSH_BLOCK}${current.slice(end)}`;
    if (updated !== current) await dependencies.writeFile(rcPath, updated);
    return;
  }

  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  await dependencies.appendFile(rcPath, `${prefix}${ZSH_BLOCK}\n`);
}

export async function runCompletionInstallCommand(
  options: CompletionInstallOptions,
  io: CliIo,
  dependencies: CompletionInstallDependencies = defaultDependencies
): Promise<CliExitCode> {
  try {
    const targets = await detectCompletionTargets(io, dependencies);
    if (targets.length === 0) {
      emitCliFailure(io, { json: false, quiet: false, color: 'auto' }, {
        label: 'lingua completion',
        reason: 'no-supported-shells',
        detail:
          'Lingua could not find bash, zsh, or fish on PATH. Install a supported shell or run `lingua completion <shell>` to print its script.',
      });
      return CLI_EXIT_CODES.unsupportedCapability;
    }

    io.writeStdout(renderPlan(targets));
    if (options.dryRun) {
      io.writeStdout('Dry run: no files were changed.\n');
      return CLI_EXIT_CODES.ok;
    }

    if (!options.assumeYes) {
      const shellNames = targets.map(target => target.shell).join(', ');
      const confirmed = await io.confirm(
        `Install completion support for ${shellNames}?`,
        true
      );
      if (confirmed === null) {
        emitCliFailure(io, { json: false, quiet: false, color: 'auto' }, {
          label: 'lingua completion',
          reason: 'confirmation-required',
          detail:
            'Interactive confirmation is unavailable. Re-run `lingua completion install --yes` to approve these changes, or use `--dry-run` to inspect them.',
        });
        return CLI_EXIT_CODES.userInputError;
      }
      if (!confirmed) {
        io.writeStdout('Cancelled. No files were changed.\n');
        return CLI_EXIT_CODES.ok;
      }
    }

    for (const target of targets) {
      await dependencies.mkdir(path.dirname(target.completionPath));
      await dependencies.writeFile(target.completionPath, renderCompletion(target.shell));
      if (target.shell === 'zsh' && target.activationPath) {
        await ensureZshActivation(target.activationPath, dependencies);
      }
    }

    io.writeStdout(
      `Installed completion support for ${targets.map(target => target.shell).join(', ')}.\n` +
        'Start a new shell session to load it.\n'
    );
    return CLI_EXIT_CODES.ok;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emitCliFailure(io, { json: false, quiet: false, color: 'auto' }, {
      label: 'lingua completion',
      reason: 'completion-install-failed',
      detail: `Could not install shell completion: ${detail}`,
    });
    return CLI_EXIT_CODES.runtimeError;
  }
}
