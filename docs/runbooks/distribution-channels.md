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
derives them from a published release's `SHA256SUMS.txt`, so a digest can
never drift from the artifact it describes:

```bash
node scripts/generate-distribution-manifests.mjs --tag v0.15.0 --release-date 2026-07-28
```

Outputs `packaging/homebrew/Casks/lingua.rb` and the three
`packaging/winget/Johnny4young.Lingua*.yaml` documents.

## npm CLI

`@linguacode/cli` is not public yet. Do not publish `0.15.0` retroactively:
the public `v0.15.0` tag predates the CLI artifact pipeline, while the current
post-release branch contains newer product behavior under the same root
version. Reusing `0.15.0` would make npm and the immutable GitHub tag disagree.

The first valid registry version must therefore come from the next stable
release with `release_cli` enabled. Before that release:

1. Create or confirm the `@linguacode` npm organization and require 2FA.
2. Publish the first public scoped package with `--access public` from the
   reviewed release artifact.
3. Configure npm trusted publishing for `johnny4young/lingua` and the release
   workflow, allowing only `npm publish`; future GitHub-hosted publishes then
   receive automatic provenance without storing a long-lived npm token.
4. Install the exact public version into a clean prefix and repeat `--version`
   plus one utility smoke before calling the channel complete.

See the current npm guidance for
[scoped public packages](https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/)
and [trusted publishers](https://docs.npmjs.com/trusted-publishers/).

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

First promotion:

1. Copy `packaging/homebrew/Casks/lingua.rb` into `Casks/lingua.rb` there and
   push.
2. Verify from a clean shell: `brew install --cask johnny4young/tap/lingua`.

Per release, regenerate the cask and push the updated file to the tap.

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
3. Cut a release, confirm the workflow reports Authenticode as verified.
4. Regenerate the manifests and submit them with
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
| npm CLI          | Package pipeline ready; `v0.15.0` correctly remains unpublished | npm organization, first next-release publish, then OIDC  |
| Homebrew tap     | Public tap exists; generated `v0.15.0` cask is ready locally    | Promote `Casks/lingua.rb` and repeat clean install smoke |
| Homebrew central | Blocked                                                         | 225 stars (self-submission floor)                        |
| winget           | Generated `v0.15.0` manifests are current and schema-tested     | Public-trust Authenticode signing and Windows validation |
