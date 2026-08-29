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

## Prerequisite

Install the headless CLI and confirm that it is on `PATH`:

```bash
# macOS
brew install johnny4young/tap/lingua-cli

# Any platform supported by Node.js 24
npm install -g @linguacode/cli

lingua --version
```

The skill requires Lingua CLI 1.3.0 or later. It never installs the CLI on the
user's behalf.

## Install the skill

### VS Code and GitHub Copilot

In VS Code, run **Chat: Install Plugin From Source** from the Command Palette
and enter:

```text
https://github.com/johnny4young/lingua
```

VS Code recognizes the root `plugin.json`, validates the Agent Plugins 1.0
manifest, and discovers `skills/lingua-verify/SKILL.md`. Review and trust the
repository before enabling it.

### Codex

In Codex, invoke the built-in skill installer and ask it to install the public
skill directory from this repository:

```text
$skill-installer
Install skills/lingua-verify from https://github.com/johnny4young/lingua
```

The installed skill is available as `$lingua-verify`. Codex may also activate
it automatically when a request matches its description.

### Claude Code

Claude Code can load the same standards-compliant `SKILL.md` as a personal
skill. Clone or download this repository, then copy or symlink the
`skills/lingua-verify` directory to:

```text
~/.claude/skills/lingua-verify
```

Restart Claude Code if the directory did not exist when the session started.
Invoke the installed skill as `/lingua-verify` or ask Claude to verify a trusted
local script with Lingua.

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
- the manifest uses the canonical Agent Plugins 1.0 schema and only supported
  fields;
- the skill directory matches its frontmatter `name`;
- every documented command and flag exists in the CLI help catalog;
- the skill contains no hook, MCP configuration, automatic installation, or
  hidden environment forwarding;
- English and Spanish website guides expose the same route and safety claims.

Run the root and website gates from [`DEVELOPMENT.md`](./DEVELOPMENT.md) before
publishing a change to the plugin or CLI contract.
