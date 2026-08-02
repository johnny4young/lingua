---
title: Troubleshoot the CLI
description: Resolve command-not-found, missing toolchain, timeout, argument, Capsule, color, and output issues without hiding failures.
order: 50
group: automation
keywords: [troubleshooting, PATH, command not found, missing runtime, timeout, invalid arguments, no color, output]
---

Start with the exact exit code and the stable reason inside `error[...]` or the JSON envelope. They distinguish user input, runtime failures, and unavailable capabilities.

## The lingua command is not found

When working from source, rebuild and link from the repository root:

```bash
pnpm run build:cli
pnpm link --global
command -v lingua
lingua --version
```

If `pnpm link --global` succeeds but your shell cannot find the command, inspect `pnpm bin --global` and add that directory to your shell's `PATH`. Restart the shell after changing its profile.

## A runtime is missing

Confirm that the same shell can find the toolchain:

```bash
node --version
python3 --version
go version
rustc --version
ruby --version
lua -v
```

Desktop applications and login shells can inherit different PATH values. The CLI uses the environment of the shell that launched it, so test in that exact terminal.

## My program flag is rejected by Lingua

Separate the two argument domains:

```bash
lingua run ./server.ts --timeout 60000 -- --json --port 4000
```

Before `--`, options belong to Lingua. After it, every token belongs to your program.

## The command timed out

Increase the limit within the 100–300000 ms range:

```bash
lingua run ./slow-analysis.py --timeout 120000
```

If the target is a long-running server, run its framework command directly. Lingua's bounded run command is designed for tasks that eventually finish.

## Output was truncated

Each stdout and stderr stream has a 1 MiB budget. Reduce verbose output, write large results to a file from the target program, or divide the work. `--json` does not increase the budget.

## CI logs contain color codes

```bash
NO_COLOR=1 lingua run ./check.ts
lingua run ./check.ts --color=never
```

`--color=never` wins explicitly. JSON and completion output are always unstyled.

## A Capsule validates but replay differs

Validation proves the file matches the schema; it does not promise deterministic program behavior. Time, random values, local dependencies, network responses, and toolchain versions can change output. Inspect `comparison` in JSON mode rather than treating every mismatch as CLI failure.
