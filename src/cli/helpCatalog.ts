// SPDX-License-Identifier: MIT
/**
 * User-facing CLI catalog shared by terminal help and generated documentation.
 * Keep this module dependency-free so Node can load it without booting the CLI.
 */

export interface CliHelpExample {
  command: string;
  description: string;
}

export interface CliHelpCommand {
  id: string;
  topLevel: string;
  invocation: string;
  summary: string;
  description: string;
  flags: ReadonlyArray<string>;
  examples: ReadonlyArray<CliHelpExample>;
}

export interface CliHelpFlag {
  id: string;
  syntax: string;
  summary: string;
  commands: ReadonlyArray<string>;
}

export interface CliHelpExitCode {
  code: number;
  name: string;
  summary: string;
}

export const CLI_HELP_CATALOG = {
  schemaVersion: 1,
  title: 'lingua — local code runner CLI',
  commands: [
    {
      id: 'utility',
      topLevel: 'utility',
      invocation:
        'lingua utility <utility-id> [--input <file>] [--json] [--quiet] [--option key=value ...]',
      summary: 'Run a focused developer utility from a pipe or file.',
      description:
        'Uses the same shared utility adapters as the desktop app without loading Electron or a renderer.',
      flags: ['input', 'option', 'json', 'quiet', 'color', 'help'],
      examples: [
        { command: `echo '{"a":1}' | lingua utility json-format`, description: 'Format piped JSON.' },
        {
          command: `echo 'cada 3 dias 8am' | lingua utility cron-phrase`,
          description: 'Turn a plain-words schedule (English or Spanish) into a cron expression.',
        },
        {
          command: 'lingua utility base64-encode --input README.md',
          description: 'Encode a file without opening the app.',
        },
      ],
    },
    {
      id: 'capsule-validate',
      topLevel: 'capsule',
      invocation: 'lingua capsule validate <file> [--json] [--quiet]',
      summary: 'Validate a RunCapsuleV1 file without executing it.',
      description:
        'Checks size, JSON shape, schema compatibility, and required fields through the same validator used by Lingua.',
      flags: ['json', 'quiet', 'color', 'help'],
      examples: [
        {
          command: 'lingua capsule validate ./run.capsule.json',
          description: 'Validate a capsule for a person reading terminal output.',
        },
        {
          command: 'lingua capsule validate ./run.capsule.json --json',
          description: 'Return a stable machine-readable result.',
        },
      ],
    },
    {
      id: 'capsule-replay',
      topLevel: 'capsule',
      invocation:
        'lingua capsule replay <file> [--timeout <ms>] [--env NAME=value ...] [--json] [--quiet]',
      summary: 'Verify and replay the single source stored in a Run Capsule.',
      description:
        'Verifies the recorded source hash, executes through the matching local runtime, and compares the fresh result with the recording.',
      flags: ['timeout', 'env', 'json', 'quiet', 'color', 'help'],
      examples: [
        {
          command: 'lingua capsule replay ./run.capsule.json --json',
          description: 'Replay and inspect the comparison envelope.',
        },
      ],
    },
    {
      id: 'run',
      topLevel: 'run',
      invocation:
        'lingua run <file-or-directory> [--stdin <file>] [--timeout <ms>] [--env NAME=value ...] [--json] [--quiet] [-- args...]',
      summary: 'Run a source file or conventional project root.',
      description:
        'Executes trusted code with installed host toolchains, bounded output, a parent-owned timeout, and no shell interpolation.',
      flags: ['stdin', 'timeout', 'env', 'json', 'quiet', 'color', 'separator', 'help'],
      examples: [
        {
          command: 'lingua run ./script.py --stdin input.txt -- --verbose',
          description: 'Run Python with file-backed stdin and a forwarded argument.',
        },
        {
          command: 'lingua run ./my-project --timeout 60000',
          description: 'Detect and run a conventional project root.',
        },
      ],
    },
    {
      id: 'list-utilities',
      topLevel: 'list',
      invocation: 'lingua list utilities [--json] [--quiet]',
      summary: 'Discover utility ids, input kinds, output kinds, and options.',
      description:
        'Prints the live utility registry so people and scripts do not need to guess adapter names or supported options.',
      flags: ['json', 'quiet', 'color', 'help'],
      examples: [
        { command: 'lingua list utilities --json', description: 'Inspect the registry from a script.' },
      ],
    },
    {
      id: 'completion',
      topLevel: 'completion',
      invocation: 'lingua completion bash|zsh|fish',
      summary: 'Generate a deterministic shell completion script.',
      description:
        'Prints network-free Bash, Zsh, or Fish completion source without ANSI styling.',
      flags: ['color', 'help'],
      examples: [
        {
          command: 'lingua completion zsh > ~/.zfunc/_lingua',
          description: 'Install the Zsh completion file.',
        },
      ],
    },
  ] satisfies ReadonlyArray<CliHelpCommand>,
  flags: [
    { id: 'input', syntax: '--input <file>', summary: 'Read utility input from a file instead of stdin.', commands: ['utility'] },
    { id: 'stdin', syntax: '--stdin <file>', summary: 'Forward a file as program stdin.', commands: ['run'] },
    { id: 'timeout', syntax: '--timeout <ms>', summary: 'Stop run or replay after 100–300000 ms.', commands: ['run', 'capsule-replay'] },
    { id: 'env', syntax: '--env NAME=value', summary: 'Repeat to add an explicit child-process environment value.', commands: ['run', 'capsule-replay'] },
    { id: 'option', syntax: '--option key=value', summary: 'Repeat to pass an adapter option.', commands: ['utility'] },
    { id: 'json', syntax: '--json', summary: 'Emit a stable structured JSON body instead of plain text.', commands: ['utility', 'capsule-validate', 'capsule-replay', 'run', 'list-utilities'] },
    { id: 'quiet', syntax: '--quiet', summary: 'Suppress Lingua diagnostics while preserving command output.', commands: ['utility', 'capsule-validate', 'capsule-replay', 'run', 'list-utilities'] },
    { id: 'color', syntax: '--color <auto|always|never>', summary: 'Control diagnostic color. The default is auto.', commands: ['utility', 'capsule-validate', 'capsule-replay', 'run', 'list-utilities', 'completion'] },
    { id: 'separator', syntax: '--', summary: 'Forward every remaining token to the executed program unchanged.', commands: ['run'] },
    { id: 'help', syntax: '--help, -h', summary: 'Show help.', commands: ['utility', 'capsule-validate', 'capsule-replay', 'run', 'list-utilities', 'completion'] },
    { id: 'version', syntax: '--version, -v', summary: 'Print the CLI version.', commands: [] },
  ] satisfies ReadonlyArray<CliHelpFlag>,
  exitCodes: [
    { code: 0, name: 'ok', summary: 'Command completed successfully.' },
    { code: 1, name: 'userInputError', summary: 'Arguments, input, file, or shape are invalid.' },
    { code: 2, name: 'runtimeError', summary: 'Execution failed, timed out, stopped, or exited non-zero.' },
    { code: 3, name: 'unsupportedCapability', summary: 'Runtime, mode, toolchain, or output is unsupported.' },
    { code: 4, name: 'internal', summary: 'An unexpected exception reached the CLI boundary.' },
  ] satisfies ReadonlyArray<CliHelpExitCode>,
} as const;

function pad(value: string, width: number): string {
  return value.padEnd(width, ' ');
}

export function renderCliHelpText(): string {
  const usage = CLI_HELP_CATALOG.commands.map(command => `  ${command.invocation}`).join('\n');
  const commands = CLI_HELP_CATALOG.commands
    .map(command => `  ${pad(command.id.replace('-', ' '), 18)} ${command.summary}`)
    .join('\n');
  const flags = CLI_HELP_CATALOG.flags
    .map(flag => `  ${pad(flag.syntax, 30)} ${flag.summary}`)
    .join('\n');
  const exitCodes = CLI_HELP_CATALOG.exitCodes
    .map(exitCode => `  ${exitCode.code}  ${exitCode.summary}`)
    .join('\n');
  const examples = CLI_HELP_CATALOG.commands
    .flatMap(command => command.examples.slice(0, 1))
    .map(example => `  ${example.command}`)
    .join('\n');

  return `${CLI_HELP_CATALOG.title}\n\nUsage:\n${usage}\n  lingua --version\n  lingua --help\n\nCommands:\n${commands}\n\nFlags:\n${flags}\n\nExit codes:\n${exitCodes}\n\nExamples:\n${examples}\n`;
}
