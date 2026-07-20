# Contributing

Thanks for helping improve the Lingua marketing site.

This repository is source-available under the root `LICENSE`. Contributions are
welcome, but the license is not open source and does not grant permission to
redistribute or host this website independently.

## Local Setup

Requires Node `>=22.12`. The content sync reads the Lingua repository root by
default; `LINGUA_LOCAL_PATH=/some/where` is available only for local experiments.

```sh
npm install
npm run dev                # http://localhost:4321 — no env vars needed
```

The site builds from committed content plus the public GitHub Releases API.

## Environment variables

See [`.env.example`](.env.example) for the full list and what each variable
does. Copy it to `.env` and fill in only what you need locally. None are
required for `npm run dev`.

## Validation

Run these before opening a PR:

```sh
npm run check
env LINGUA_SOURCE=local npm run build
npm audit --audit-level=moderate
```

## Build and deploy

Deploys run from the repo-root workflow `.github/workflows/deploy-website.yml` —
on a push to `main` touching `website/` (or the content sources it vendors), on
a published release, and on manual dispatch. It builds here and uploads to the
Cloudflare Pages project `lingua-web` (which serves linguacode.dev), configured
with:

- Build command: `npm run build`
- Build output: `dist`
- Compatibility date: matches `wrangler.toml`
- Environment variables: set the ones documented in `.env.example` in the CF
  dashboard. `PUBLIC_POLAR_CHECKOUT_*` left blank renders disabled buttons.

The default build fetches the latest public release from the GitHub Releases
API. Download links point directly at the attached GitHub assets. Cloudflare R2
is not a desktop download source; it hosts only oversized web runtimes used by
the app at `downloads.linguacode.dev/web-runtime/`.

Set `LINGUA_SOURCE=local` to skip the network fetch and synthesize a
multi-platform placeholder release from the committed `changelog.json` — useful
for offline development and responsive download-page smoke tests.

## Content sync

`npm run sync:content` reads from the local `lingua` sibling and writes
everything the build needs into this repo. It produces:

- `src/content/press-kit/*.md` and `src/content/seo/en/*.md` — vendored markdown
- `src/data/changelog.json` — parsed from `CHANGELOG.md`
- `src/data/unreleased.json` — `git log` since the latest stable tag, filtered
  to user-visible commits (`feat`/`fix`/`perf`)

The public roadmap in `src/data/roadmap.json` is curated independently. It is a
small product-direction projection and must never copy private planning IDs,
acceptance notes, or sprint history. Generated content and the curated roadmap
are committed. Content sync reads the repository root; the release page may
read the public GitHub Releases API and needs no authentication.

Three ways to run a sync:

1. **Manual.** `npm run sync:content` then commit `src/content` and `src/data`.
2. **One-shot.** `npm run sync:commit` (no push) or `npm run sync:push`.
   Aborts if unstaged work under those paths exists, so a sync commit never
   bundles unrelated edits.
3. **Deployment.** `.github/workflows/deploy-website.yml` syncs content from the
   checked-out repository before every Cloudflare Pages build.

When pricing changes, update `src/components/PricingTable.astro` to match the
new tier text. When a new SEO page lands in `docs/seo-pages/`, add it to the
manifest in `scripts/sync-from-main.mjs`.

## Public Content Rules

- Do not add product claims unless they map to shipped behavior in the main
  `lingua` repo.
- Do not add third-party JavaScript analytics. Cloudflare Web Analytics is the
  only analytics allowance.
- Do not load fonts from a CDN.
- Do not commit secrets, real license tokens, internal customer data, private
  repository URLs that require auth, or machine-local paths.
- Keep English as the default unprefixed locale and Spanish under `/es`.
