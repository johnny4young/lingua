# Public Repository Release Checklist

Use this checklist before changing the GitHub repository visibility to public.
It is intentionally separate from `RELEASE.md`: this file gates publication of
the source repository, while `RELEASE.md` gates product binaries.

## Current Repository State

- GitHub repository visibility: private.
- License posture: source-available commercial; keep `LICENSE` as the source of
  truth.
- Production private keys, API tokens, webhook secrets, and signing material
  must stay outside git.
- `.env.production` contains public build-time values only.

## Non-Destructive Cleanup Gate

- Public docs exist: `SECURITY.md`, `PRIVACY.md`, `CONTRIBUTING.md`,
  `THIRD_PARTY_NOTICES.md`, and `docs/RELEASE_SECURITY.md`.
- `.env.example` exists and contains placeholders only.
- Machine-local absolute Markdown links are blocked by
  `tests/docs/publicDocs.test.ts`.
- Generated local artifacts and local agent command skills are removed from
  the tracked tree. `.agents/skills/lingua-review` and
  `.agents/skills/lingua-ship` may exist locally, but they must stay ignored
  and untracked before publication.
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
- Keep `.gitleaks.toml` scoped to deterministic fixtures only. Dummy test
  secrets and public keys are acceptable; production private material is not.
- Review any new match manually before expanding the allowlist.
- Rotate any production secret that ever appeared in git, even if history is
  rewritten before publication.

## Dependency And License Gate

- Confirm public builds do not include AGPL/commercial runtime dependencies
  without an explicit license decision: `npm run check:licenses`.
- Generate release compliance artifacts:
  `npm run compliance:release`.
- Generate the committed transitive license report:
  `npm run license:report`.
- Generate a CycloneDX SBOM when a standalone stdout artifact is needed:
  `npm run sbom:release`.
- Keep `THIRD_PARTY_NOTICES.md` and
  `docs/THIRD_PARTY_LICENSE_REPORT.md` in sync with packaged runtime
  dependencies.

## Publication Gate

- `npm test -- --run`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run check:i18n`
- `npm run check:i18n:copy`
- `npm run build:web`
- `npm run changelog:check`
- `npm run check:performance`
- Public docs and release-security checklist reviewed.
- Repository visibility change approved by the maintainer.
