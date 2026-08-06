---
title: Use Lingua without opening a window
description: Meet the headless Lingua CLI, build it today, and turn a first command into a repeatable local workflow.
order: 1
group: start
keywords: [install, npm, terminal, quickstart, headless, offline, help]
---

The Lingua CLI is for the moment when a useful action needs to leave the app and become a terminal command, a shell pipe, or a CI step. It runs the same utility adapters and Run Capsule schema as Lingua, but it does **not** start Electron or React.

It is local, scriptable, and intentionally small. Use it to format a payload on stdin, execute a trusted source file, validate a Capsule in CI, or replay a captured run.

## Install it

`@linguacode/cli` is published on npm. It has no dependencies and needs Node 24.x:

```bash
npm install -g @linguacode/cli
lingua --help
```

Prefer not to install anything? Run it once with `npx`:

```bash
npx @linguacode/cli --help
```

Machines without Node can use the standalone `lingua-cli-*-linux-x64.tar.gz` and `-windows-x64.tar.gz` archives attached to every stable [GitHub Release](https://github.com/johnny4young/lingua/releases/latest).

## Build it from source

Contributors, and anyone tracking `main` ahead of a release, build from the repository:

```bash
git clone https://github.com/johnny4young/lingua.git
cd lingua
corepack enable
pnpm install
pnpm run build:cli
node dist/cli/lingua.cjs --help
```

For local development, expose the `lingua` command on your `PATH`:

```bash
pnpm link --global
lingua --version
```

This link points at your checkout. Run `pnpm run build:cli` after changing CLI source.

## Run your first useful command

Format JSON directly from another program:

```bash
curl -s https://api.github.com/repos/johnny4young/lingua \
  | lingua utility json-format
```

Or run a source file through the toolchain already installed on your machine:

```bash
lingua run ./scripts/check.ts -- --verbose
```

Everything after `--` belongs to your program, not Lingua.

## Choose the right command

| You want to… | Start with |
| --- | --- |
| transform or inspect one value | `lingua utility` |
| execute a file or conventional project | `lingua run` |
| check a Capsule without running it | `lingua capsule validate` |
| reproduce a captured single-file run | `lingua capsule replay` |
| discover utilities and their options | `lingua list utilities --json` |
| enable tab completion | `lingua completion` |

## A safe mental model

The CLI never interpolates your command through a shell, but code executed by `lingua run` still has your operating-system permissions. Run only code you trust. For untrusted code, place the CLI inside a container or sandbox you control.

The CLI itself does not need a network. Your program can still use the network, and a missing language toolchain remains a local setup requirement.

## Continue by task

- [Run files and projects](/cli/run-code)
- [Pipe through developer utilities](/cli/utilities)
- [Validate and replay Run Capsules](/cli/capsules)
- [Use Lingua in scripts and CI](/cli/automation)
- [Fix PATH, runtime, and output problems](/cli/troubleshooting)
- [Review every command, flag, and exit code](/cli/reference)
