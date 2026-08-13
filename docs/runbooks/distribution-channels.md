# Distribution channels: npm, Homebrew, and winget

How Lingua reaches CLI, `brew`, and `winget` users, which public state is
already in place, and exactly what unblocks each remaining promotion.

Start every distribution pass with the read-only public probe:

```bash
pnpm run distribution:status
pnpm run distribution:status -- --format json --output output/distribution-status.json
pnpm run distribution:status -- --input output/distribution-status.json --format html --locale es --output output/distribution-es.html
```

The probe reads public GitHub and npm endpoints plus the generated local
manifests. It does not read credentials, publish, update the tap, or submit a
registry package. A saved JSON report can be rendered repeatedly in either
language without spending more public API quota. Use `--output` for JSON when
running through pnpm so package-manager progress does not mix with the
machine-readable document on stdout.

Manifests are never hand-edited. `scripts/generate-distribution-manifests.mjs`
derives the Desktop cask, headless CLI formula, and winget documents from a
published release's `SHA256SUMS.txt`, so a digest can never drift from the
artifact it describes:

```bash
node scripts/generate-distribution-manifests.mjs --tag v0.15.0 --release-date 2026-07-28
```

Outputs `packaging/homebrew/Casks/lingua.rb`,
`packaging/homebrew/Formula/lingua-cli.rb`, and the three
`packaging/winget/Johnny4young.Lingua*.yaml` documents.

## npm CLI

`@linguacode/cli` is not public yet. Do not publish `0.15.0` retroactively:
the public `v0.15.0` tag predates the CLI artifact pipeline, while the current
post-release branch contains newer product behavior under the same root
version. Reusing `0.15.0` would make npm and the immutable GitHub tag disagree.

The manual `Publish CLI to npm` workflow (`.github/workflows/publish-cli.yml`)
is the sole registry mutation owner. It never rebuilds the CLI. Instead, it:

1. accepts only a published, non-prerelease `vX.Y.Z` GitHub Release whose
   GitHub release attestation proves that release immutability is enabled;
2. downloads that release's `linguacode-cli-X.Y.Z.tgz` and `SHA256SUMS.txt`,
   then verifies both assets against the signed release attestation;
3. verifies the checksum, exact four-file package allowlist, public manifest,
   repository identity, release version, and exact operator confirmation in an
   unprivileged preflight job, then preserves that evidence for review;
4. waits for approval on a separate `npm-production` promotion job, downloads
   the verified candidate, and repeats the checksum/content/manifest checks
   before any registry request can mutate state;
5. bootstraps a missing package, stages a new version through OIDC, or skips
   mutation when the exact version is already public; and
6. installs the exact public version into a clean prefix and runs `--version`
   plus a real utility smoke whenever the version is public.

The environment approval is deliberately attached only to the promotion job.
Reviewers can inspect the preflight summary and evidence before granting access
to the one-time secret or OIDC token; approval is not wasted on malformed or
unattested candidates.

### Authenticated read-only prerequisite check

Before cutting the release, run:

```bash
pnpm run check:cli-publish-prereqs
pnpm run check:cli-publish-prereqs -- --format json --output output/cli-publish-prereqs.json
```

The command requires an authenticated `gh` session and reads the repository's
immutable-release setting, `npm-production` environment protection metadata,
environment secret **names**, and the public npm package. It never requests a
secret value and never changes GitHub or npm. A missing package requires the
bootstrap secret to exist; after the package is public, leaving that secret in
the environment becomes a blocking failure. npm does not expose the trusted
publisher policy through this probe, so the post-bootstrap report keeps its
stage-only workflow/action restriction as an explicit manual review instead of
claiming readiness from indirect evidence.

The probe uses GitHub's read endpoints for
[repository release immutability](https://docs.github.com/en/rest/repos/repos#check-if-immutable-releases-are-enabled-for-a-repository)
and [deployment environments](https://docs.github.com/en/rest/deployments/environments#get-an-environment).

### One-time bootstrap

npm requires a package to exist before trusted publishing or staged publishing
can be configured. For the first valid version from the next stable release:

1. Create the `@linguacode` npm organization, require 2FA, and confirm the
   maintainer can publish public packages in that scope.
2. Enable GitHub release immutability for `johnny4young/lingua`. It applies only
   to future releases, so do this before cutting the first CLI-bearing release.
3. Create the GitHub environment `npm-production` with required reviewers.
4. Create a short-lived granular npm token with read/write access to the
   `@linguacode` scope and Bypass 2FA enabled for this one bootstrap only, then
   store it only as the environment secret `NPM_PUBLISH_TOKEN`.
5. Rerun `pnpm run check:cli-publish-prereqs`; the automated status must be
   `Ready` before dispatching the workflow.
6. Dispatch `publish-cli.yml` with the stable tag plus the exact confirmation
   `@linguacode/cli@X.Y.Z`. Inspect the completed preflight summary and its
   immutable candidate artifact, then approve the waiting `npm-production` job.
7. Confirm the promotion job repeated verification, used the `bootstrap` path,
   emitted provenance, and passed the clean public-install smoke.

The workflow refuses bootstrap without the one-time secret. It also refuses a
draft, prerelease, mutable/unattested release, asset-attestation failure,
checksum mismatch, unexpected tarball file, manifest drift, or confirmation
mismatch before npm receives any mutation request.

### Tokenless subsequent releases

Immediately after bootstrap:

1. Configure npm trusted publishing for `johnny4young/lingua`, workflow file
   `publish-cli.yml`, GitHub environment `npm-production`, and **only** the
   `npm stage publish` action.
2. Set package publishing access to require 2FA and disallow traditional
   tokens, remove `NPM_PUBLISH_TOKEN` from GitHub, and revoke the granular token.
3. For each later stable release, dispatch the same workflow. It stages the
   immutable release tarball with short-lived OIDC credentials and automatic
   provenance instead of making it public immediately.
4. Inspect/download the staged tarball and approve it with 2FA in npm. Do not
   rerun while that version is still staged: the public registry cannot expose
   staged state to the OIDC job, so a duplicate stage attempt deliberately
   fails instead of replacing the pending candidate.
5. After approval, rerun the workflow. The idempotent `published` path performs
   the clean public install and utility smoke without republishing.

`npm whoami` does not prove OIDC configuration: trusted authentication is
exchanged only during `npm publish` or `npm stage publish`. Treat the workflow
result, npm's staged/public state, provenance, and clean-install smoke as the
evidence chain.

See the current npm guidance for
[scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
and [trusted publishers](https://docs.npmjs.com/trusted-publishers/), plus the
[publishing 2FA requirements](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/)
and [granular-token controls](https://docs.npmjs.com/about-access-tokens/).

## Homebrew

### Why not `Homebrew/homebrew-cask`

The central cask repo enforces a notability floor. As of the February 2026
policy, a **self-submitted** cask (the author submitting their own app — our
case) needs **90 forks, 90 watchers, or 225 stars**; third-party submissions
need 30/30/75. Lingua is far below that, so a PR to `homebrew-cask` would be
closed on sight.

This is not a blocker for shipping — it is a blocker for shipping _there_.

### What we do instead: our own tap

A personal tap has no notability requirement and is the standard route for
apps below the bar. Users install with:

```bash
brew install --cask johnny4young/tap/lingua
```

The public [`johnny4young/homebrew-tap`](https://github.com/johnny4young/homebrew-tap)
repository already exists. As of 2026-08-01 it does not yet contain
`Casks/lingua.rb`; the local `v0.15.0` cask is ready for its first promotion.

Desktop cask promotion:

1. Copy `packaging/homebrew/Casks/lingua.rb` into `Casks/lingua.rb` there and
   push.
2. Verify from a clean shell: `brew install --cask johnny4young/tap/lingua`.

Per release, regenerate the cask and push the updated file to the tap.

### Headless CLI formula

The same tap also exposes the terminal-only CLI without requiring users to run
npm themselves:

```bash
brew install johnny4young/tap/lingua-cli
```

`Formula/lingua-cli.rb` downloads the checksum-pinned `linguacode-cli-X.Y.Z.tgz`
from the immutable GitHub Release and depends on Homebrew's keg-only `node@24`.
Its wrapper puts that runtime on `PATH`, which also makes npm available when
`lingua run` detects a Node project. The install never calls npm and does not
install the Electron application. Keep the formula and Desktop cask as separate
tokens so users can install either surface or both intentionally. The formula
uses Homebrew's `generate_completions_from_executable` helper, so Bash, Zsh,
and Fish completion files land in Homebrew's native directories without
editing user dotfiles or prompting during `brew install`.

Before pushing, validate the formula from the local tap:

```bash
cp packaging/homebrew/Formula/lingua-cli.rb "$(brew --repository johnny4young/tap)/Formula/"
brew style johnny4young/tap/lingua-cli
brew audit --strict --online johnny4young/tap/lingua-cli
brew install johnny4young/tap/lingua-cli
brew test johnny4young/tap/lingua-cli
```

### Validating a cask before pushing

`brew style`/`brew audit` refuse to look at a cask outside a tap, so validate
through a throwaway local tap:

```bash
brew tap-new lingua-validate/tap --no-git
mkdir -p "$(brew --repository lingua-validate/tap)/Casks"
cp packaging/homebrew/Casks/lingua.rb "$(brew --repository lingua-validate/tap)/Casks/"
brew style --cask lingua-validate/tap/lingua
brew audit --cask --online lingua-validate/tap/lingua   # downloads the real dmg
brew untap lingua-validate/tap
```

`brew audit --online` is the valuable one: it downloads the artifact, checks
the digest, and compares `depends_on macos:` against the `LSMinimumSystemVersion`
inside the shipped `.app`. That check is what caught the cask claiming Big Sur
while the Electron 43 build actually requires **Monterey (12.0)**.

To test an install without disturbing an existing `/Applications/Lingua.app`,
install into a scratch directory:

```bash
brew install --cask --appdir="$(mktemp -d)/Applications" lingua-validate/tap/lingua
```

Note `--appdir` is an _install_ flag only; `brew uninstall` does not accept it.
To undo a scratch install, delete `$(brew --caskroom)/lingua` — never
`brew uninstall --cask --force`, which resolves the app artifact against the
default `/Applications` and can delete an unrelated copy of the app.

## winget

`microsoft/winget-pkgs` has **no** popularity requirement, so the only gate is
technical — and we currently fail it.

**Blocker: the Windows installer is unsigned.** winget's submission pipeline
runs SmartScreen checks against the referenced installer, and unsigned or
no-reputation executables fail validation or install unreliably (winget needs
non-interactive installs to work). Shipping an unsigned `.exe` to winget would
produce a package that errors for users even if the PR merged.

### What unblocks it

Configure Authenticode signing, then re-generate and submit:

1. Obtain a public-trust code-signing certificate. An exportable CA-issued PFX
   works with the current workflow. Azure Artifact Signing can be considered
   only after confirming its current regional and identity eligibility.
2. Add repo secrets `WIN_CERT_FILE` (base64 `.pfx`) and `WIN_CERT_PASSWORD`.
   The release workflow signs both the installer and standalone CLI after SEA
   injection; with neither set it deliberately labels both as unsigned previews.
3. Run `pnpm run check:windows-signing-prereqs` and preserve its JSON evidence.
   It reads secret names only and blocks a missing or orphaned pair; certificate
   trust remains a human review until a real draft proves both signatures.
4. Cut a draft release and confirm both the installer and standalone CLI
   summaries report a valid Authenticode signature on the same candidate.
5. Validate install, launch, update, uninstall, publisher identity, and
   SmartScreen behavior on a clean Windows 11 system.
6. Regenerate the manifests and submit them with
   [`wingetcreate`](https://github.com/microsoft/winget-create):
   `wingetcreate submit packaging/winget`.

Until then the manifests are kept current and validated in-repo so submission
is a single command once signing lands.

### Local validation

Full `winget validate` requires Windows. On other platforms the generator's
unit tests (`tests/scripts/distributionManifests.test.ts`) lock the schema
shape, identifier, digest casing, and installer semantics.

## Status

| Channel          | State                                                           | Gate                                                     |
| ---------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| npm CLI          | `@linguacode/cli@1.2.0` public through guarded stage-only OIDC | Repeat staged approval and public-install smoke per stable release |
| Homebrew tap     | Desktop cask and headless CLI formula are generated from release checksums | Promote both files and repeat clean install smoke |
| Homebrew central | Blocked                                                         | 225 stars (self-submission floor)                        |
| winget           | Generated `v0.15.0` manifests are current and schema-tested     | Public-trust Authenticode signing and Windows validation |
