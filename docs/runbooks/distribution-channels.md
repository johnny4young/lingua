# Distribution channels: Homebrew and winget

How Lingua reaches `brew` and `winget` users, why neither central registry
accepts us today, and exactly what unblocks each one.

Manifests are never hand-edited. `scripts/generate-distribution-manifests.mjs`
derives them from a published release's `SHA256SUMS.txt`, so a digest can
never drift from the artifact it describes:

```bash
node scripts/generate-distribution-manifests.mjs --tag v0.14.0 --release-date 2026-07-25
```

Outputs `packaging/homebrew/Casks/lingua.rb` and the three
`packaging/winget/Johnny4young.Lingua*.yaml` documents.

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

Setting the tap up (one time):

1. Create a **public** GitHub repo named exactly `homebrew-tap` under the
   `johnny4young` account. The `homebrew-` prefix is what lets users write
   `johnny4young/tap`.
2. Copy `packaging/homebrew/Casks/lingua.rb` into `Casks/lingua.rb` there and
   push.
3. Verify from a clean shell: `brew install --cask johnny4young/tap/lingua`.

Per release, regenerate the cask and push the updated file to the tap.

### Validating a cask before pushing

`brew style`/`brew audit` refuse to look at a cask outside a tap, so validate
through a throwaway local tap:

```bash
brew tap-new lingua-validate/tap --no-git
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

| Channel          | State                                                                           | Gate                                  |
| ---------------- | ------------------------------------------------------------------------------- | ------------------------------------- |
| Homebrew tap     | Ready — cask generated, `brew style` + `audit --online` clean, install verified | Create the public `homebrew-tap` repo |
| Homebrew central | Blocked                                                                         | 225 stars (self-submission floor)     |
| winget           | Manifests ready and tested                                                      | Authenticode signing                  |
