---
title: Run files and projects
description: Execute trusted JavaScript, TypeScript, Python, Go, Rust, Ruby, or Lua with explicit stdin, arguments, timeouts, and environment values.
order: 10
group: guides
keywords: [run, project, stdin, argv, timeout, env, javascript, typescript, python, go, rust, ruby, lua]
---

`lingua run` turns a source file or conventional project directory into one predictable command. Lingua selects an installed host runtime, starts it without a shell, bounds output, and owns the timeout.

## Run one file

```bash
lingua run ./hello.js
lingua run ./analysis.py
lingua run ./hello.go
lingua run ./hello.rs --timeout 60000
```

JavaScript and TypeScript use Node.js. Python, Go, Rust, Ruby, and Lua use their matching command-line toolchains. If a runtime is missing, Lingua exits with code 3 and names the missing capability.

## Pass stdin without a fragile pipe

Use `--stdin` when the input already lives in a file:

```bash
lingua run ./normalize.py --stdin fixtures/raw.txt
```

A normal pipe also works:

```bash
printf 'Ada\nGrace\n' | lingua run ./greet.js
```

An interactive terminal sends EOF when there is no pipe, so a program that reads stdin does not hang waiting for invisible input.

## Forward program arguments

Place Lingua options before `--`. Every later token reaches the target unchanged:

```bash
lingua run ./scripts/check.ts --timeout 45000 -- --verbose --fix src
```

This is the workaround when your program has an option named `--json` or `--quiet`; after the separator, those flags belong to the program.

## Add explicit environment values

```bash
lingua run ./worker.py \
  --env MODE=development \
  --env FEATURE_X=enabled
```

`--env` is repeatable. Lingua does not blindly inherit every parent variable, and it blocks dynamic-loader injection keys plus `NODE_OPTIONS`. Pass secrets only when the program genuinely needs them; command histories and CI logs can expose arguments.

## Run a conventional project

```bash
lingua run ./my-project
```

Detection follows a fixed order:

1. `package.json`: `scripts.start`, then `scripts.dev`, then a valid `main`.
2. `go.mod`: `go run .`.
3. `Cargo.toml`: `cargo run --quiet --`.
4. Conventional entries such as `main.py`, `index.js`, or `src/index.ts`.

If a framework requires a special launcher, run that launcher yourself or point Lingua at an independently runnable source file. Lingua does not guess framework-specific commands.

## Make automation deterministic

Use `--json` when another program consumes the result and inspect the process exit code:

```bash
if result=$(lingua run ./healthcheck.ts --json); then
  printf '%s\n' "$result" | jq -r '.run.stdout'
else
  printf '%s\n' "$result" | jq -r '.reason' >&2
fi
```

Plain mode streams while the program runs. JSON mode buffers the same bounded output into one parseable document.
