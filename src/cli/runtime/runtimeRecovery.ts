// SPDX-License-Identifier: MIT
/** Actionable, platform-aware recovery for host runtimes used by `lingua run`. */

import path from 'node:path';

export const CLI_RUNTIME_HELP_URL =
  'https://linguacode.dev/cli/troubleshooting#missing-runtimes';

export interface CliRuntimeRecovery {
  runtime: string;
  executable: string;
  installCommand?: string;
  installGuide: string;
  verifyCommand: string;
}

interface RuntimeDescriptor {
  name: string;
  verifyExecutable: string;
  homebrewFormula?: string;
  installGuide: string;
}

const RUNTIMES: Readonly<Record<string, RuntimeDescriptor>> = {
  python: {
    name: 'Python',
    verifyExecutable: 'python3',
    homebrewFormula: 'python',
    installGuide: 'https://www.python.org/downloads/',
  },
  go: {
    name: 'Go',
    verifyExecutable: 'go',
    homebrewFormula: 'go',
    installGuide: 'https://go.dev/doc/install',
  },
  rust: {
    name: 'Rust',
    verifyExecutable: 'rustc',
    homebrewFormula: 'rust',
    installGuide: 'https://www.rust-lang.org/tools/install',
  },
  ruby: {
    name: 'Ruby',
    verifyExecutable: 'ruby',
    homebrewFormula: 'ruby',
    installGuide: 'https://www.ruby-lang.org/en/documentation/installation/',
  },
  lua: {
    name: 'Lua',
    verifyExecutable: 'lua',
    homebrewFormula: 'lua',
    installGuide: 'https://www.lua.org/download.html',
  },
  node: {
    name: 'Node.js',
    verifyExecutable: 'node',
    homebrewFormula: 'node@24',
    installGuide: 'https://nodejs.org/en/download',
  },
};

export function buildMissingRuntimeRecovery(
  command: string,
  runtime: string,
  platform: NodeJS.Platform = process.platform
): { detail: string; recovery: CliRuntimeRecovery } {
  const executable = executableName(command);
  const key = runtimeKey(executable, runtime);
  const descriptor = RUNTIMES[key] ?? {
    name: runtime || executable,
    verifyExecutable: executable,
    installGuide: CLI_RUNTIME_HELP_URL,
  };
  const verifyExecutable = key === 'python' ? executable : descriptor.verifyExecutable;
  const installCommand =
    platform === 'darwin' && descriptor.homebrewFormula
      ? `brew install ${descriptor.homebrewFormula}`
      : undefined;
  const verifyCommand = `${verifyExecutable} --version`;
  const recovery: CliRuntimeRecovery = {
    runtime: descriptor.name,
    executable,
    ...(installCommand ? { installCommand } : {}),
    installGuide: descriptor.installGuide,
    verifyCommand,
  };
  const install = installCommand
    ? `Install on macOS with Homebrew:\n  ${installCommand}`
    : `Install ${descriptor.name} for your operating system:\n  ${descriptor.installGuide}`;
  const guide = descriptor.installGuide === CLI_RUNTIME_HELP_URL ? '' : `\nSetup guide:\n  ${descriptor.installGuide}`;

  return {
    detail: [
      `${descriptor.name} is required for this run, but Lingua could not find \`${executable}\` on PATH.`,
      install,
      `Verify the setup:\n  ${verifyCommand}`,
      `Then retry the same Lingua command.${guide}`,
      `Lingua runtime help:\n  ${CLI_RUNTIME_HELP_URL}`,
    ].join('\n\n'),
    recovery,
  };
}

function executableName(command: string): string {
  const basename = path.basename(command).toLowerCase();
  return basename.replace(/\.exe$/u, '').replace(/\.cmd$/u, '');
}

function runtimeKey(executable: string, runtime: string): string {
  const normalizedRuntime = runtime.toLowerCase();
  if (
    executable === 'py' ||
    executable.startsWith('python') ||
    normalizedRuntime.startsWith('python')
  ) {
    return 'python';
  }
  if (executable === 'go' || normalizedRuntime.startsWith('go')) return 'go';
  if (['rustc', 'cargo'].includes(executable) || normalizedRuntime.startsWith('rust')) return 'rust';
  if (executable === 'ruby' || normalizedRuntime.startsWith('ruby')) return 'ruby';
  if (executable === 'lua' || normalizedRuntime.startsWith('lua')) return 'lua';
  if (['node', 'npm', 'npx'].includes(executable) || normalizedRuntime.startsWith('node')) {
    return 'node';
  }
  return normalizedRuntime;
}
