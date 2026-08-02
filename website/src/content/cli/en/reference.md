---
title: Command and option reference
description: Scan every Lingua CLI command, shared option, limit, output mode, and stable exit code in one place.
order: 60
group: reference
keywords: [reference, command, flag, option, exit codes, help, version, color, quiet, json]
---

This reference follows the same structured catalog used to generate `lingua --help`. The website build fails if its committed catalog snapshot drifts from the CLI source.

## Commands

| Command | Purpose |
| --- | --- |
| `lingua utility <utility-id>` | Run one shared developer-utility adapter. |
| `lingua capsule validate <file>` | Validate a `RunCapsuleV1` without execution. |
| `lingua capsule replay <file>` | Verify and replay a trusted single-source Capsule. |
| `lingua run <file-or-directory>` | Execute a source file or conventional project root. |
| `lingua list utilities` | Print the live utility registry. |
| `lingua completion bash\|zsh\|fish` | Generate shell completion source. |
| `lingua --version` | Print the build-time CLI version. |
| `lingua --help` | Print terminal help. |

## Options

| Option | Used by | Meaning |
| --- | --- | --- |
| `--input <file>` | `utility` | Read utility input from a file instead of stdin. |
| `--option key=value` | `utility` | Repeat to pass adapter-specific options. |
| `--stdin <file>` | `run` | Forward file contents as program stdin. |
| `--timeout <ms>` | `run`, `capsule replay` | Stop after 100–300000 ms. |
| `--env NAME=value` | `run`, `capsule replay` | Repeat to add an explicit environment value. |
| `--json` | data-producing commands | Emit one structured JSON document. |
| `--quiet` | data-producing commands | Suppress Lingua diagnostics, not command output. |
| `--color <auto\|always\|never>` | all commands | Control human diagnostic styling. |
| `--` | `run` | Forward every remaining token to the program. |
| `--help`, `-h` | all commands | Show help. |
| `--version`, `-v` | top level | Print the CLI version. |

## Exit codes

| Code | Name | Meaning |
| --- | --- | --- |
| 0 | `ok` | Command completed successfully. |
| 1 | `userInputError` | Arguments, input, file, or shape are invalid. |
| 2 | `runtimeError` | Execution failed, timed out, stopped, or exited non-zero. |
| 3 | `unsupportedCapability` | Runtime, mode, toolchain, or output is unsupported. |
| 4 | `internal` | An unexpected exception reached the CLI boundary. |

## Output contract

Human failures use a grep-friendly form:

```text
lingua run: error[missing-runtime]: Required runtime "lua" is not available on PATH.
```

With `--json`, the same stable reason moves to stdout:

```json
{
  "ok": false,
  "reason": "missing-runtime",
  "detail": "Required runtime \"lua\" is not available on PATH."
}
```

Command-specific success envelopes are documented in the task guides. Existing exit codes are never renumbered.
