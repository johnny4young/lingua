# Public Repository Release Checklist

Use this checklist to keep the public repository free of secrets and private
planning metadata. It is separate from `RELEASE.md`, which gates binaries.

> Release-binary signing is gated separately: see
> [`RELEASE_SECURITY.md` § Signature chain](./RELEASE_SECURITY.md#signature-chain)
> for the macOS/Windows signature chain and release validation gates.

## Current Repository State

- GitHub repository visibility: public.
- License posture: source-available commercial; keep `LICENSE` as the source of
  truth.
- Production private keys, API tokens, webhook secrets, and signing material
  must stay outside git.
- `.env.production` contains public build-time values only.

## Non-Destructive Cleanup Gate

- Public docs exist: `SECURITY.md`, `PRIVACY.md`, `CONTRIBUTING.md`,
  `THIRD_PARTY_NOTICES.md`, and `docs/RELEASE_SECURITY.md`.
- Desktop signing setup is documented in `docs/MACOS_SIGNING.md` and
  `docs/WINDOWS_SIGNING.md`.
- Preserve `check:windows-signing-prereqs` JSON evidence for any candidate that
  claims Authenticode trust. Secret-name readiness does not replace the two
  `Valid` workflow summaries or the clean Windows 11 behavior pass.
- `.env.example` exists and contains placeholders only.
- Machine-local absolute Markdown links are blocked by
  `tests/docs/publicDocs.test.ts`.
- Generated local artifacts and private maintainer command skills are removed
  from the tracked tree. `.agents/skills/lingua-review` and
  `.agents/skills/lingua-ship` may exist locally, but they must stay ignored
  and untracked before publication. The audited public Agent Plugins package is
  deliberately separate: root `plugin.json`, `.claude-plugin/marketplace.json`,
  `skills/.claude-plugin/plugin.json`, `skills/LICENSE`, and
  `skills/lingua-verify/` are product artifacts and remain tracked.
- `README.md`, `LICENSE`, press-kit copy, and roadmap docs agree on
  `linguacode.dev` as the public domain and source-available commercial as the
  repo posture.

## History Rewrite Gate

Do not run these steps without explicit maintainer approval, because they
change commit ids and require force-pushing private branches/tags.

- Remove AI co-authorship trailers from historical commits that contain them.
- Rewrite historical commits authored by tool identities to the maintainer
  identity, if that is the desired public history.
- Remove duplicated `.claude` / `.agents` files and generated Playwright
  artifacts from history if the public repository should never show them.
- Delete or archive remote `claude/*` branches before visibility changes.
- Decide whether existing private release tags should be recreated after the
  history rewrite.

## Secret Scan Gate

- Run Gitleaks over the full git history:
  `go run github.com/zricethezav/gitleaks/v8@latest git --no-banner --redact .`.
- Re-run the full-history scan before each public release or history migration.
- Keep `.gitleaks.toml` scoped to deterministic fixtures only. Dummy test
  secrets and public keys are acceptable; production private material is not.
- Review any new match manually before expanding the allowlist.
- Rotate any production secret that ever appeared in git, even if history is
  rewritten before publication.

## Dependency And License Gate

- Confirm public builds do not include AGPL/commercial runtime dependencies
  without an explicit license decision: `pnpm run check:licenses`.
- Generate release compliance artifacts:
  `pnpm run compliance:release`.
- Generate the committed transitive license report:
  `pnpm run license:report`.
- Generate a CycloneDX SBOM when a standalone stdout artifact is needed:
  `pnpm run sbom:release`.
- Keep `THIRD_PARTY_NOTICES.md` and
  `docs/THIRD_PARTY_LICENSE_REPORT.md` in sync with packaged runtime
  dependencies.

## Publication Gate

- `pnpm test -- --run`
- `pnpm exec tsc --noEmit`
- `pnpm run lint`
- `pnpm run check:i18n`
- `pnpm run check:i18n:copy`
- `pnpm run build:web`
- `pnpm run changelog:check`
- `pnpm run check:performance`
- For web releases, confirm the GitHub Actions run uploaded
  `cloudflare-deploy-validation` with the Wrangler log,
  `app.linguacode.dev` app-shell check, service-worker
  update-endpoint bypass check, and `updates.linguacode.dev/web/version`
  response.
- For Linux releases, confirm the AppImage and `latest-linux.yml` are attached.
- For CLI releases, confirm `publish-cli.yml` consumed the immutable GitHub
  Release tarball and checksum manifest, and verified their signed release
  attestations before requesting environment approval. Confirm the protected
  job repeated payload verification after artifact transfer. The first publish
  requires one short-lived granular token with read/write access to the
  `@linguacode` scope and Bypass 2FA enabled for that bootstrap only. Revoke it
  after stage-only trusted publishing is configured; subsequent staged versions
  require 2FA approval and a clean public-install rerun after approval.
- Preserve `check:cli-publish-prereqs` JSON evidence from before the candidate:
  immutable releases enabled, `npm-production` present with required reviewers,
  and bootstrap-secret presence matching whether the package exists. The report
  is read-only and verifies secret names only; review the npm trusted-publisher
  policy separately after bootstrap.
- For macOS/Windows releases, complete
  `docs/runbooks/desktop-update-draft-validation.md` and preserve the workflow
  structure/signing evidence.
- Public docs and release-security checklist reviewed.
- Repository publication posture reviewed by the maintainer.
