---
title: Practical recipes for everyday development
description: Copy working Lingua CLI patterns for APIs, data cleanup, local scripts, Git hooks, CI, containers, Capsules, Bash, and PowerShell.
order: 35
group: guides
keywords: [recipes, examples, api, curl, jq, git hook, github actions, npm scripts, makefile, docker, powershell, ci]
---

These recipes solve small, common developer tasks with commands you can copy and adapt. They assume `lingua --version` works and that every file or program you execute is trusted.

## Pick a recipe by outcome

| You need to… | Recipe |
| --- | --- |
| inspect an API response | [Format JSON from curl](#format-json-from-curl) |
| inspect a token without uploading it | [Read a JWT header and payload](#read-a-jwt-header-and-payload) |
| create a URL query safely | [Encode one URL component](#encode-one-url-component) |
| normalize generated files | [Guard JSON in a Git hook](#guard-json-in-a-git-hook) |
| run a repository check | [Expose Lingua through package.json](#expose-lingua-through-packagejson) |
| add a CI gate | [Pin the CLI in GitHub Actions](#pin-the-cli-in-github-actions) |
| reproduce a captured run | [Require an exact Capsule replay](#require-an-exact-capsule-replay) |
| use Lingua from Windows | [Keep the exit code in PowerShell](#keep-the-exit-code-in-powershell) |

## Work with API and web data

### Format JSON from curl

Keep the transformed JSON on stdout so it can continue into `jq`:

```bash
curl -fsSL https://api.github.com/repos/johnny4young/lingua \
  | lingua utility json-format --quiet \
  | jq '{name, stargazers_count, open_issues_count}'
```

`curl -f` makes HTTP errors fail the pipeline. In Bash CI jobs, add `set -o pipefail` so an earlier failure cannot be hidden by a later command.

### Minify a JSON release artifact

```bash
lingua utility json-minify --input config/runtime.json --quiet \
  > dist/runtime.min.json
```

The command parses before writing, so malformed JSON fails instead of producing a partially transformed artifact.

### Read a JWT header and payload

```bash
printf '%s' "$ACCESS_TOKEN" \
  | lingua utility jwt-decode --quiet \
  | jq '{algorithm: .header.alg, subject: .payload.sub, expires: .payload.exp}'
```

This decodes local text only. It does **not** verify the signature, issuer, audience, expiry, or authorization. Never treat decoded claims as trusted identity.

### Encode one URL component

```bash
query=$(printf '%s' 'state:open label:"good first issue"' \
  | lingua utility url-encode --quiet)

curl -fsSL "https://api.github.com/search/issues?q=${query}" | jq '.total_count'
```

`url-encode` is for a component such as one query value, not for re-encoding an entire URL.

### Break an absolute URL into fields

```bash
printf '%s' 'https://example.com:8443/api/items?limit=20#results' \
  | lingua utility url-parse --quiet \
  | jq '{origin, pathname, searchParams}'
```

`url-parse` rejects relative URLs deliberately. Resolve a relative path against its base before passing it to the utility.

### Encode or decode text as Base64

```bash
encoded=$(printf '%s' 'local developer value' | lingua utility base64-encode --quiet)
printf '%s' "$encoded" | lingua utility base64-decode --quiet
```

The CLI contract is UTF-8 text. Base64 is an encoding, not encryption, and this recipe is not intended for arbitrary binary files or secrets.

### Escape a snippet for safe HTML text

```bash
printf '%s' '<button data-id="42">Run & inspect</button>' \
  | lingua utility html-entity-encode --quiet
```

This escapes text content. It does not sanitize an HTML document or make untrusted markup safe to execute.

## Normalize text and developer data

### Compute a text digest

```bash
digest=$(lingua utility hash \
  --input release-notes.md \
  --option algorithm=SHA-256 \
  --quiet)
printf 'release-notes.md  %s\n' "$digest"
```

The digest covers the UTF-8 text read by the CLI. Use an operating-system checksum tool when byte-for-byte hashing of arbitrary binary files is required.

### Sort and deduplicate changed paths

```bash
git diff --name-only origin/main...HEAD \
  | lingua utility line-sort \
      --option unique=true \
      --option caseInsensitive=true \
      --quiet
```

Add `--option numeric=true` when values such as `fixture2` and `fixture10` should use natural ordering.

### Produce a stable identifier style

```bash
printf '%s' 'HTTP response cache key' \
  | lingua utility string-case --option target=snake --quiet

printf '%s' 'Guía rápida para equipos' \
  | lingua utility slugify --option separator=hyphen --quiet
```

Use `string-case` for code-oriented naming (`camel`, `snake`, `kebab`, and others). Use `slugify` for an ASCII URL or filename segment.

### Replace a repeated source pattern

```bash
lingua utility regex-replace \
  --input src/legacy.ts \
  --option pattern='console\\.log' \
  --option flags=g \
  --option replacement=logger.info \
  --quiet > /tmp/legacy.updated.ts

diff -u src/legacy.ts /tmp/legacy.updated.ts
```

Preview the diff before replacing the original file. Quote the pattern so the shell does not interpret backslashes or metacharacters.

### Inspect suspicious Unicode

```bash
git log -1 --pretty=%B | lingua utility string-inspect --quiet
```

The result distinguishes graphemes, code points, UTF-16 units, UTF-8 bytes, zero-width characters, and bidirectional controls—useful when two strings look identical but compare differently.

### Convert a timestamp during incident review

```bash
printf '%s' '1735689600' | lingua utility timestamp --quiet
```

The result includes ISO 8601, epoch milliseconds, and epoch seconds. Record the original timezone separately when it matters; a Unix epoch represents an instant, not the author's timezone.

### Convert an integer without losing precision

```bash
printf '%s' '9007199254740993' \
  | lingua utility number-base \
      --option from=10 \
      --option to=16 \
      --option prefixOutput=true \
      --quiet
```

The converter uses integer arithmetic rather than floating-point conversion, so values above JavaScript's safe-integer limit remain exact.

### Generate test identifiers

```bash
printf 'generator-input-is-ignored' \
  | lingua utility uuid \
      --option format=v7 \
      --option count=5 \
      --quiet
```

`uuid` is a generator: it still receives stdin because every utility has one text-input contract, but it intentionally ignores that input. Generated values are not deterministic snapshots.

### Translate a schedule into cron

```bash
printf '%s' 'weekdays at 9:30' \
  | lingua utility cron-phrase --option annotate=true --quiet
```

Keep `annotate=true` while reviewing the expression: the extra comment lines surface assumptions and cron caveats. Test the final schedule in the timezone and cron implementation that will run it.

### Inspect a design token color

```bash
printf '%s' 'rgba(14, 165, 233, 0.75)' \
  | lingua utility color-convert --quiet
```

The output presents equivalent HEX, RGB/RGBA, and HSL forms for quick comparison.

## Run repository tools consistently

### Pass a fixture as stdin

```bash
lingua run ./scripts/normalize.py \
  --stdin ./fixtures/raw-event.json \
  --timeout 45000
```

Use `--stdin` when the input already has a path. It avoids a fragile shell pipeline and makes the fixture visible in the invocation.

### Forward arguments to the program

```bash
lingua run ./scripts/check.ts \
  --timeout 60000 \
  -- --changed-only --format=json
```

Everything after `--` belongs to `check.ts`. Lingua does not parse or reorder those tokens.

### Run a conventional project root

```bash
lingua run ./tools/release-audit --timeout 120000
```

Directory detection supports conventional `package.json`, `go.mod`, `Cargo.toml`, and common single-file entry points. Run the framework command directly when a repository needs custom orchestration or a permanent server.

### Expose Lingua through package.json

Pin the CLI in `devDependencies`, then give collaborators one memorable script:

```json
{
  "devDependencies": {
    "@linguacode/cli": "1.4.1"
  },
  "scripts": {
    "check:local": "lingua run ./scripts/check.ts --timeout 60000 -- --changed-only",
    "check:capsules": "lingua capsule validate ./artifacts/latest.capsule.json --quiet"
  }
}
```

```bash
npm run check:local
```

Commit the lockfile. Upgrade the pinned version only after the same checks pass in your repository.

### Add a Make target

```make
.PHONY: verify-fixtures
verify-fixtures:
	lingua run ./scripts/verify-fixtures.py --stdin ./fixtures/events.ndjson --timeout 90000
```

The recipe line must begin with a tab. Make preserves Lingua's exit code, so a failed run fails the target.

### Guard JSON in a Git hook

Use a temporary file instead of rewriting a staged file automatically:

```bash
#!/usr/bin/env bash
set -euo pipefail

tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

lingua utility json-format --input config/app.json --option indent=2 --quiet > "$tmp"
if ! cmp -s config/app.json "$tmp"; then
  echo 'config/app.json is not in canonical format' >&2
  diff -u config/app.json "$tmp" || true
  exit 1
fi
```

Install it with your repository's existing hook manager. Hooks can be bypassed, so keep the same invariant in CI.

## Put Lingua in automation

### Pin the CLI in GitHub Actions

```yaml
name: CLI checks
on: [pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npx --no-install lingua run ./scripts/check.ts --json
      - run: npx --no-install lingua capsule validate ./artifacts/example.capsule.json --quiet
```

This assumes `@linguacode/cli` is pinned in the repository and lockfile, as in the `package.json` recipe. Install each language toolchain explicitly when the target is not JavaScript or TypeScript.

### Preserve structured output and the exit code

```bash
#!/usr/bin/env bash
set -uo pipefail

result=$(lingua run ./scripts/healthcheck.ts --json)
status=$?

printf '%s\n' "$result" | jq .
if (( status != 0 )); then
  printf 'Lingua failed with exit code %d\n' "$status" >&2
fi
exit "$status"
```

Do not append `|| true` to a gate unless failure is intentionally advisory. The JSON body explains the failure; the exit code decides whether automation continues.

### Offer missing-runtime recovery without parsing prose

```bash
result=$(lingua run ./worker.py --json)
status=$?

if (( status == 3 )); then
  printf '%s\n' "$result" | jq '{reason, recovery}' >&2
fi
exit "$status"
```

Exit code 3 means a capability is unavailable. The structured `recovery` object can contain the runtime, executable, install command or guide, and verification command.

### Validate every Capsule artifact

```bash
#!/usr/bin/env bash
set -euo pipefail

while IFS= read -r -d '' capsule; do
  lingua capsule validate "$capsule" --quiet
done < <(find artifacts -name '*.capsule.json' -type f -print0)
```

This validates shape and limits without executing stored source. Use `-print0` so filenames containing spaces remain one item; `set -e` stops on the first invalid artifact.

### Require an exact Capsule replay

```bash
lingua capsule replay ./artifacts/release-check.capsule.json \
  --timeout 60000 \
  --json \
  | jq -e '.ok == true and .comparison.matches == true'
```

Replay itself can exit 0 when the program ran successfully but differed from the recorded result. `jq -e` turns exact comparison into an explicit CI policy. Replay only trusted Capsules.

### Build a small container image

```dockerfile
FROM node:24-bookworm-slim

RUN npm install --global @linguacode/cli@1.4.1
WORKDIR /workspace
ENTRYPOINT ["lingua"]
CMD ["--help"]
```

```bash
docker build -t local/lingua-cli .
docker run --rm -i local/lingua-cli utility json-format --quiet \
  < fixtures/payload.json
```

Mount trusted source plus the required language toolchain when using `lingua run`. The container is the isolation boundary; Lingua is not an OS sandbox by itself.

## Use native shell patterns

### Bootstrap completion on a workstation

```bash
lingua completion --dry-run
lingua completion
```

The first command shows every detected shell and target file. The second asks once before writing. Homebrew installations place Bash, Zsh, and Fish completion files automatically.

### Keep the exit code in PowerShell

```powershell
$result = lingua run .\scripts\check.ts --json | ConvertFrom-Json
$status = $LASTEXITCODE

$result | ConvertTo-Json -Depth 8
if ($status -ne 0) {
  Write-Error "Lingua failed with exit code $status"
}
exit $status
```

Capture `$LASTEXITCODE` immediately after `lingua`; another native command can replace it.

### Format a file in PowerShell

```powershell
Get-Content .\config\app.json -Raw |
  lingua utility json-format --option indent=4 --quiet |
  Set-Content .\config\app.formatted.json -Encoding utf8

if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Write to a second file first. Review or compare it before replacing the original.

## Discover what your installed version supports

The installed registry is the source of truth when scripts must work across CLI versions:

```bash
lingua list utilities --json \
  | jq -r '.utilities[] | [.id, (.optionKeys | join(","))] | @tsv'

lingua --help
lingua utility --help
lingua run --help
```

Prefer discovery over guessing an adapter option. For stable automation, pin the CLI version and commit your package lockfile or immutable installer metadata.
