---
title: Pipe through developer utilities
description: Discover utility ids, transform stdin or files, pass adapter options, and keep shell pipelines predictable.
order: 20
group: guides
keywords: [utility, pipe, input, option, json-format, base64, regex, list utilities]
---

`lingua utility` brings focused transformations to the terminal. The adapters are shared with Lingua's developer-utilities panels, but the CLI keeps the contract text-based and automation-friendly.

## Discover before you guess

```bash
lingua list utilities
lingua list utilities --json | jq '.utilities[] | {id, options}'
```

The JSON registry is the safest way for scripts to discover ids, input/output kinds, and accepted options.

## Read from stdin

```bash
echo '{"team":["Ada","Grace"]}' | lingua utility json-format
printf 'hello world' | lingua utility base64-encode
```

Stdin makes utilities compose naturally with `curl`, `git`, `jq`, and other programs.

## Read a file

```bash
lingua utility json-format --input package.json --option indent=4
lingua utility base64-encode --input README.md
```

`--input` belongs only to `utility`. For an executed program's stdin, use `lingua run --stdin` instead.

## Repeat adapter options

```bash
lingua utility regex-replace --input src.ts \
  --option pattern='console\\.log' \
  --option flags=g \
  --option replacement=logger.info
```

Each `--option` accepts one `key=value` pair. Quote values that contain spaces or shell metacharacters so your shell passes one argument.

## Keep pipelines clean

`--quiet` removes Lingua diagnostics but preserves successful output:

```bash
lingua utility json-format --input raw.json --quiet > normalized.json
```

Use `--json` for a structured Lingua envelope, not when you want the transformed bytes directly:

```bash
lingua utility json-format --input raw.json --json | jq -r '.value'
```

Binary utility output is intentionally unsupported in this headless text contract and exits with code 3 rather than corrupting a terminal stream.

For option-aware examples covering APIs, JWTs, hashes, Unicode, identifiers,
cron, source rewrites, and more, continue with [Practical recipes for everyday
development](/cli/recipes).
