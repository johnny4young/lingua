# AI agent integration

Lingua ships a portable `lingua-verify` Agent Skill that teaches compatible AI
agents to collect local, machine-readable evidence with the existing CLI. The
integration is intentionally instruction-only: it adds no background process,
MCP server, hook, credential, or automatic installer.

The public Agent Plugins 1.0 package is rooted at [`plugin.json`](../plugin.json)
and discovers the skill from
[`skills/lingua-verify/SKILL.md`](../skills/lingua-verify/SKILL.md). Private
maintainer workflows under `.agents/` remain machine-local and are not part of
the product integration.

## Prerequisites

The skill is portable Markdown, but using it still needs a supported agent,
the Lingua CLI, and any runtime required by the target code.

### Install the CLI

Choose one installation channel and confirm that `lingua` is on `PATH`:

```bash
# macOS
brew install johnny4young/tap/lingua-cli

# Windows, Linux, or macOS with Node.js 24 and npm
npm install -g @linguacode/cli

lingua --version
```

The Homebrew formula requires Homebrew and installs `node@24` automatically.
The npm channel requires Node.js 24.x, npm, network access to the registry, and
a user-writable global npm prefix whose bin directory is on `PATH`. Do not work
around a permissions error with an unreviewed `sudo npm install`; fix the npm
prefix or use a user-scoped Node installation instead.

Stable releases also include standalone Windows x64 and Linux x64 archives.
They need no separate Node installation for utilities or Capsule validation,
but JavaScript and TypeScript execution still resolves Node.js 24 from `PATH`.
Other operating systems and architectures should use npm.

The skill requires Lingua CLI 1.3.0 or later. It never installs the CLI on the
user's behalf.

### Check the agent client

| Client                   | Required before installing the skill                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------- |
| VS Code + GitHub Copilot | Current VS Code with Copilot access, Git, HTTPS access to GitHub, and `chat.plugins.enabled: true`   |
| Codex                    | A Codex build with the built-in `$skill-installer`, GitHub network access, and a writable skills dir |
| Claude Code              | Current Claude Code with `claude plugin`, Git, and HTTPS access to GitHub                            |

URL-based installers read the repository's default branch. To test unpublished
plugin work, use a local checkout or pin the branch/ref when the client supports
it; a bare repository URL does not install a pull-request head.

### Check target runtimes

Utilities and Capsule validation do not require a language toolchain. Running
or replaying code does:

| Target                  | Runtime on `PATH`                                       |
| ----------------------- | ------------------------------------------------------- |
| JavaScript / TypeScript | Node.js 24.x                                            |
| Python                  | Project `.venv`, `PYTHON`, `python3`, `python`, or `py` |
| Go                      | `go`                                                    |
| Rust file / project     | `rustc` / `cargo`                                       |
| Ruby                    | `ruby`                                                  |
| Lua                     | `lua`                                                   |

## Install the skill

### VS Code and GitHub Copilot

In VS Code, run **Chat: Install Plugin From Source** from the Command Palette
and enter:

```text
https://github.com/johnny4young/lingua
```

VS Code recognizes the root `plugin.json`, validates the Agent Plugins 1.0
manifest, and discovers `skills/lingua-verify/SKILL.md`. Review and trust the
repository before enabling it. If the command is missing, update VS Code,
confirm GitHub Copilot access, and enable `chat.plugins.enabled`.

### Codex

In Codex, invoke the built-in skill installer and ask it to install the public
skill directory from this repository:

```text
$skill-installer
Install skills/lingua-verify from https://github.com/johnny4young/lingua
```

The installed skill is available as `$lingua-verify` on the next Codex turn.
Codex may also activate it automatically when a request matches its
description.

### Claude Code

Claude Code loads the same standards-compliant `SKILL.md` through Lingua's
native plugin and marketplace. Add the marketplace, then install the plugin.
The commands are identical in macOS, Linux, and Windows terminals:

```bash
claude plugin marketplace add https://raw.githubusercontent.com/johnny4young/lingua/main/.claude-plugin/marketplace.json --scope user
claude plugin install lingua@linguacode --scope user
```

Start a new Claude Code session after a shell installation, or run
`/reload-plugins` inside an existing session. Invoke the namespaced skill as
`/lingua:lingua-verify`, or ask Claude to verify a trusted local script with
Lingua.

Claude owns the installed plugin's update and removal lifecycle:

```bash
claude plugin update lingua@linguacode
claude plugin uninstall lingua@linguacode
```

To preview unpublished changes from a local checkout without installing them or
changing personal configuration:

```bash
claude --plugin-dir ./skills
```

Then invoke `/lingua:lingua-verify`. The public marketplace follows the default
branch, so it does not install a pull-request head until that change is merged.
In a managed environment that blocks third-party marketplaces, an administrator
can review and copy `skills/lingua-verify` into the approved Claude skills
directory. That fallback gives up Claude's native update and uninstall
lifecycle.

## What the skill does

The skill selects the narrowest existing CLI command for the requested proof:

| User goal                     | Lingua command                              |
| ----------------------------- | ------------------------------------------- |
| Run a trusted file or project | `lingua run <target> --json`                |
| Validate without executing    | `lingua capsule validate <file> --json`     |
| Reproduce a trusted capture   | `lingua capsule replay <file> --json`       |
| Discover transformations      | `lingua list utilities --json`              |
| Apply a pure transformation   | `lingua utility <id> --input <file> --json` |

The agent must interpret both the process exit code and the JSON body. It may
claim verification only when the command exits successfully and the structured
result supports that claim. A successful Capsule replay whose
`comparison.matches` value is `false` is output drift, not a matching result.

## Execution boundary

`lingua run` and `lingua capsule replay` start local programs without shell
interpolation, with an allow-listed inherited environment, bounded output, and
a parent-owned timeout. Those controls reduce accidental injection and runaway
output, but the target still runs with the current operating-system user's
filesystem and network permissions.

The skill therefore:

- verifies `lingua --version` before use;
- executes only the target the user asked to verify in the active workspace;
- never installs software or forwards environment values silently;
- prefers `--json` over parsing prose;
- reports timeouts, non-zero exits, unsupported runtimes, truncation, and output
  drift instead of manufacturing a green result;
- treats Capsule validation as non-executing and replay as executing.

Run untrusted code inside a sandbox or container you control. The skill does
not create one.

## Relationship to local MCP

The Agent Skill and the desktop MCP server solve different problems:

- `lingua-verify` helps shell-capable coding agents invoke the existing CLI and
  understand its evidence.
- Lingua Desktop's local MCP server provides a loopback, session-only,
  read-only view of one explicitly approved project.

This plugin does not bundle `mcp.json`. A future stdio MCP adapter must justify
its additional maintenance and define a separate permission boundary before it
can expose execution or replay.

## Maintainer validation

The repository gates pin the portable contract:

- `plugin.json.version` equals `package.json.version`;
- the Claude plugin and marketplace versions equal `package.json.version`;
- the license included in the sparse Claude plugin matches the repository
  license;
- Claude discovers exactly one skill and no agents, hooks, MCP servers, or LSP
  servers from the native plugin;
- the manifest uses the canonical Agent Plugins 1.0 schema and only supported
  fields;
- the skill directory matches its frontmatter `name`;
- every documented command and flag exists in the CLI help catalog;
- the skill contains no hook, MCP configuration, automatic installation, or
  hidden environment forwarding;
- English and Spanish website guides expose the same route and safety claims.

Run the root and website gates from [`DEVELOPMENT.md`](./DEVELOPMENT.md) before
publishing a change to the plugin or CLI contract.
