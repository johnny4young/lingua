# Marketing Site ADR

> Owning ticket: `RL-063` — Download landing page at linguacode.dev.
> Status: Decided 2026-05-05. Marketing surface ships from a separate
> repo (`johnny4young/lingua-marketing`) auto-deployed to
> https://linguacode.dev via Cloudflare Pages.

## Context

The original `RL-063` plan put the marketing site under `src/web/` of
this repo, alongside the in-product web build. As the project
approached launch, three forces pulled the marketing surface out into
its own repo:

1. **Coupling friction.** The desktop renderer and the marketing site
   share zero runtime code. Putting them in the same repo meant the
   marketing site inherited every dependency the desktop renderer
   needed — Monaco, Pyodide, esbuild-wasm — even though it imports
   none of them. CI runs slowed accordingly.
2. **Deploy cadence mismatch.** The desktop builds ship via signed,
   notarized release tags through the `release.yml` matrix (RL-080).
   The marketing site wants to ship the moment a copy fix is merged.
   Sharing a deploy pipeline meant either bottlenecking marketing
   updates behind release tags or carving out a parallel pipeline
   inside `release.yml`. The second option keeps growing the
   surface area of an already-large workflow.
3. **Public-repo posture.** RL-081 made the desktop repo public. The
   marketing repo is also public, but its content review cadence
   (translations, pricing tweaks, founder bio updates) is different
   from the engineering review cadence. Splitting lets each repo's
   PR template, CODEOWNERS, and contributor flow match the kind of
   change it expects.

## Decision

Marketing site lives in `johnny4young/lingua-marketing`, a separate
public GitHub repo. Stack:

- Astro 6 with TypeScript strict.
- Tailwind CSS v4 (CSS-first config).
- Shiki for syntax highlighting (build time).
- `@astrojs/sitemap` for the sitemap; `astro-icon` for Lucide icons.
- Cloudflare Pages for hosting. CF auto-tracks the `main` branch and
  redeploys on every merge.
- Internationalization at launch: English + Spanish (es-LATAM
  neutral; tuteo, no rioplatense voseo — same register as
  `src/renderer/i18n/locales/es/common.json` in this repo).

URL: https://linguacode.dev (with a `www.` 301 alias). The web app
build remains at https://app.linguacode.dev and is unchanged.

**No commit hash is pinned in this repo.** Cloudflare Pages tracks
the `main` branch of the marketing repo, so any commit hash recorded
here would go stale within hours of the next push. The split is
documented at the branch + URL level; provenance is recoverable from
the marketing repo's own git history.

The marketing repo vendors content from this repo via a
`scripts/sync-from-main.mjs` script that copies `docs/press-kit/*`
and `docs/seo-pages/*` into the marketing repo, plus preprocessed
JSON snapshots of `docs/ROADMAP.md` and `CHANGELOG.md`. The
`sync:check` flag exits non-zero on drift, which is wired into the
marketing repo's CI so the site can never advertise a feature this
repo doesn't ship.

The Polar.sh checkout integration (RL-061) is honored at the env-var
level: `POLAR_CHECKOUT_PRO`, `POLAR_CHECKOUT_PRO_LIFETIME`, and
`POLAR_CHECKOUT_TEAM` are configured on the Cloudflare Pages
environment. Missing env vars render the corresponding Buy button as
a disabled tooltip rather than a broken link.

## Consequences

- The desktop repo's CI surface drops the entire marketing
  toolchain. Unit tests, builds, lint, and i18n gates here stay
  focused on the desktop + web app surfaces.
- A copy fix on the marketing site no longer requires waiting for a
  desktop release tag. PRs to the marketing repo deploy on merge.
- Cross-repo provenance: any PR in this repo that promises a feature
  on the marketing site has to be paired with a PR in the marketing
  repo. The `tests/docs/marketingSite.test.ts` guard in this repo
  pins the README link, the `### Status Update` block in PLAN.md, and
  the ROADMAP archive entries so the lingua repo can never claim "the
  site says X" without saying it itself.
- If the marketing repo ever needs to be inlined back into this repo,
  the path is mechanical: vendor `lingua-marketing/src/` under
  `src/marketing/` here, add an Astro build to the existing CI, and
  retire the separate Cloudflare Pages project. No schema migrations,
  no IPC contracts, no shared runtime state. This ADR can be
  superseded by a `MARKETING_SITE_ADR_v2.md` if that path is taken.

## Alternatives considered

- **Single repo with `src/marketing/` alongside `src/web/`** — the
  original RL-063 plan. Rejected because of the coupling friction
  and the deploy cadence mismatch above.
- **Cloudflare Pages directly off this repo's `lingua-marketing/`
  subdirectory** — would have given us the deploy cadence wins but
  kept the dependency / CI coupling. Rejected because Astro and the
  desktop renderer want different Vite versions today
  (`overrides.vite ^7.3.2` in marketing vs `^5.4.21` here), and the
  workspace coordination would have been worse than two repos.
- **GitHub Pages instead of Cloudflare Pages** — rejected because we
  already use Cloudflare Pages for `app.linguacode.dev` (RL-061
  Slice 5 migration); keeping both deploys on the same provider
  simplifies DNS, env-var management, and audit headers (`_headers`
  + `_redirects` syntax already familiar).

## Pointers

- Marketing repo: `johnny4young/lingua-marketing` (public).
- Site URL: https://linguacode.dev (apex; `www.linguacode.dev` 301s
  to apex).
- Web app URL (different surface, same domain root):
  https://app.linguacode.dev.
- Content sync mechanism: marketing repo's
  `scripts/sync-from-main.mjs` reads `../lingua/docs/press-kit/`,
  `docs/seo-pages/`, `docs/ROADMAP.md`, `CHANGELOG.md` and produces
  vendored markdown + preprocessed JSON.
- Polar checkout env vars: `POLAR_CHECKOUT_PRO`,
  `POLAR_CHECKOUT_PRO_LIFETIME`, `POLAR_CHECKOUT_TEAM`,
  `POLAR_CHECKOUT_PRO_ANNUAL` (when added). Configured on Cloudflare
  Pages, not in this repo.
- Cloudflare Pages project: tracks `main` of the marketing repo;
  preview deploys on PRs.
