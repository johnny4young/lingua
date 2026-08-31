---
title: Verify AI-generated code with an agent
description: Install Lingua's portable Agent Skill and turn local CLI runs, Capsule checks, and utility transformations into honest structured evidence.
order: 45
group: automation
heroCommand: --version
keywords:
  [agent, agents, ai, verification, codex, claude code, copilot, skill, plugin, json, evidence, mcp]
---

Lingua already gives shell-capable agents the important part: a local CLI with stable JSON,
deterministic exit codes, bounded output, and explicit runtime failures. The portable
`lingua-verify` skill teaches an agent to use that contract instead of guessing whether generated
code worked.

The integration is instruction-only. It does not add a background service, MCP server, hook,
credential, or automatic installer.

## Check the prerequisites

The skill contains instructions, not the CLI or language runtimes. You need:

- an agent client that can run local terminal commands;
- HTTPS access to GitHub while installing the skill;
- Lingua CLI 1.3.0 or later on `PATH`;
- the command-line runtime used by the code you want to execute.

| Client                   | Installation requirements                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| VS Code + GitHub Copilot | Current VS Code, Copilot access, Git, and `chat.plugins.enabled: true`                    |
| Codex                    | Built-in `$skill-installer`, GitHub network access, and a writable personal skills folder |
| Claude Code              | Current Claude Code with `claude plugin`, Git, and HTTPS access to GitHub                 |

## Install the CLI first

On macOS, Homebrew installs the CLI and Node.js 24:

```bash
brew install johnny4young/tap/lingua-cli
lingua --version
```

On Windows, Linux, or macOS with Node.js 24 and npm:

```bash
npm install -g @linguacode/cli
lingua --version
```

The Homebrew formula installs Node.js 24. The npm option requires Node.js 24.x, npm, and a
user-writable global package location whose bin directory is on `PATH`. Do not use an unreviewed
`sudo npm install` to hide a permissions problem; fix the npm prefix or use a user-scoped Node
installation.

Standalone Windows x64 and Linux x64 archives can run utilities and validate Capsules without a
separate Node installation. Running or replaying JavaScript or TypeScript still requires Node.js 24
on `PATH`. The skill requires Lingua CLI 1.3.0 or later, checks the version, and never installs
software on your behalf.

Execution also needs the target runtime:

| Target                  | Runtime on `PATH`                                       |
| ----------------------- | ------------------------------------------------------- |
| JavaScript / TypeScript | Node.js 24.x                                            |
| Python                  | Project `.venv`, `PYTHON`, `python3`, `python`, or `py` |
| Go                      | `go`                                                    |
| Rust file / project     | `rustc` / `cargo`                                       |
| Ruby                    | `ruby`                                                  |
| Lua                     | `lua`                                                   |

## Install the Agent Skill

### VS Code and GitHub Copilot

Run **Chat: Install Plugin From Source** from the Command Palette, then enter:

```text
https://github.com/johnny4young/lingua
```

Review and trust the repository before enabling the plugin. VS Code discovers the root
`plugin.json` and its `skills/lingua-verify` directory. If the command is missing, update VS Code,
confirm GitHub Copilot access, and enable `chat.plugins.enabled`.

### Codex

Invoke the built-in skill installer and ask it to install the public skill directory:

```text
$skill-installer
Install skills/lingua-verify from https://github.com/johnny4young/lingua
```

The installed skill becomes available on your next Codex turn. Then mention `$lingua-verify`, or
ask Codex to verify a trusted local script with Lingua.

### Claude Code

Add Lingua's marketplace, then install the native plugin. These commands are the same in macOS,
Linux, and Windows terminals:

```bash
claude plugin marketplace add https://raw.githubusercontent.com/johnny4young/lingua/main/.claude-plugin/marketplace.json --scope user
claude plugin install lingua@linguacode --scope user
```

Start a new Claude Code session after a shell installation, or run `/reload-plugins` inside an
existing session. Invoke the namespaced skill as `/lingua:lingua-verify`, or describe a matching
verification task. Claude manages the plugin cache, updates, and removal:

```bash
claude plugin update lingua@linguacode
claude plugin uninstall lingua@linguacode
```

To preview the plugin from a local checkout, without installing or changing your personal config:

```bash
claude --plugin-dir ./skills
```

Then invoke `/lingua:lingua-verify`. The public marketplace resolves the repository's default
branch, so a pull-request head is not installable through the public URL until it is merged. In a
managed environment that blocks third-party marketplaces, an administrator can instead review and
copy `skills/lingua-verify` into the approved Claude skills directory; that fallback gives up the
native update and uninstall lifecycle.

## Give the agent a bounded task

Good prompts name the trusted target and the evidence you want:

```text
Use Lingua to run ./scripts/normalize.ts with --check as its program argument.
Report the exact runtime, exit code, stdout, stderr, duration, and any truncation.
```

```text
Validate ./artifacts/run.capsule.json without executing it. If it is valid, stop before replay.
```

```text
Use Lingua's json-format utility on ./fixtures/payload.json and report structured failures.
```

The skill chooses the narrowest command:

| Goal                          | Command                                     |
| ----------------------------- | ------------------------------------------- |
| Run a trusted file or project | `lingua run <target> --json`                |
| Validate without execution    | `lingua capsule validate <file> --json`     |
| Reproduce a trusted capture   | `lingua capsule replay <file> --json`       |
| Discover transformations      | `lingua list utilities --json`              |
| Apply one transformation      | `lingua utility <id> --input <file> --json` |

It does not replace the repository's own lint, typecheck, or test gates.

## Read the evidence, not just the exit

The agent checks the process exit code and the JSON body:

| Exit | Meaning                                                                        |
| ---- | ------------------------------------------------------------------------------ |
| `0`  | Command completed; inspect the structured result before claiming verification. |
| `1`  | Invalid arguments or input.                                                    |
| `2`  | Runtime failure, timeout, stop, or non-zero program exit.                      |
| `3`  | Unsupported capability or missing runtime.                                     |
| `4`  | Unclassified internal failure.                                                 |

A Capsule replay can exit successfully while `comparison.matches` is `false`. That is reproducible
output drift, not a matching result.

## Keep the execution boundary explicit

`lingua run` and `lingua capsule replay` execute with your operating-system permissions. Lingua
avoids shell interpolation, filters inherited environment values, caps output, and owns the
timeout, but it is not an OS sandbox.

- Run only a target you trust inside the active workspace.
- Do not let an agent install Lingua or a missing runtime silently.
- Do not forward secrets through `--env`.
- Prefer Capsule validation when execution is unnecessary.
- Put untrusted code in a sandbox or container you control.

## Why this is not another MCP server

The CLI is already the shortest path for coding agents that have a terminal. The skill adds
workflow knowledge and honest evidence without another process or permission surface. Lingua
Desktop's existing local MCP remains the read-only option for exposing one explicitly approved
project to a trusted MCP client.

A future stdio MCP adapter should exist only if structured tool discovery proves more useful than
this CLI-first path, and execution would require a separate permission design.
