---
title: Automate with stable output
description: Use JSON envelopes, quiet mode, exit codes, completions, and bounded execution to make scripts and CI jobs dependable.
order: 40
group: automation
keywords: [ci, automation, json, quiet, exit code, completion, bash, zsh, fish, no color]
---

The CLI separates data on stdout from human diagnostics on stderr. Add stable exit codes, `--json`, and bounded execution, and it becomes a dependable CI building block.

## Pick plain text or JSON deliberately

Plain mode is best when Lingua's output is the next program's input:

```bash
lingua utility json-format --input raw.json --quiet > normalized.json
```

JSON mode is best when a script needs status and metadata:

```bash
result=$(lingua run ./check.ts --json) || status=$?
printf '%s\n' "$result" | jq .
exit "${status:-0}"
```

Structured output never contains ANSI escapes, even if `--color=always` is present.

## Depend on exit-code families

| Code | Meaning | Typical response |
| --- | --- | --- |
| 0 | success | continue |
| 1 | invalid arguments or input | fix the invocation or artifact |
| 2 | runtime failure or timeout | inspect program output |
| 3 | unsupported or missing capability | install/choose a runtime |
| 4 | unexpected internal failure | capture diagnostics and report it |

## Prevent stuck jobs

```bash
lingua run ./integration-check.py --timeout 90000 --json
```

The allowed range is 100–300000 ms, with a 30000 ms default. Timeout and Ctrl+C terminate the subprocess tree.

## Install shell completion

Homebrew installs Bash, Zsh, and Fish completion files automatically. For
other install channels, let Lingua detect the supported shells on `PATH`, show
the exact target files, and ask once before writing:

```bash
lingua completion
lingua completion --dry-run
lingua completion install --yes # explicit non-interactive approval
```

The installer marks the current shell, configures standard Bash and Fish user
directories, and maintains one delimited Zsh block in `.zshrc`. It refuses to
write from CI or a pipe unless `--yes` is present.

You can still generate one deterministic script manually:

```bash
lingua completion bash
lingua completion zsh
lingua completion fish
```

Completion generation is deterministic and network-free, so package scripts can install it without contacting a service.
