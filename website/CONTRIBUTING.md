# Contributing

Thanks for helping improve the Lingua marketing site.

This repository is source-available under the root `LICENSE`. Contributions are
welcome, but the license is not open source and does not grant permission to
redistribute or host this website independently.

## Local Setup

Requires Node `>=22.12`. For content sync work you also need the main `lingua`
repo cloned next to this one (`../lingua`); override the path with
`LINGUA_LOCAL_PATH=/some/where`.

```sh
npm install
npm run dev                # http://localhost:4321 — no env vars needed
```

The site builds from committed content. You do not need access to the private
`lingua` app repository for normal site changes.

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
Cloudflare Pages project that serves linguacode.dev, configured with:

- Build command: `npm run build`
- Build output: `dist`
- Compatibility date: matches `wrangler.toml`
- Environment variables: set the ones documented in `.env.example` in the CF
  dashboard. `PUBLIC_POLAR_CHECKOUT_*` left blank renders disabled buttons.

The default build fetches the public release manifest from
`https://downloads.linguacode.dev/manifest.json` at build time and HEAD-checks
each asset URL for `Content-Length`. The lingua source repo is private, so
this R2 mirror is the only public download surface.

Set `LINGUA_SOURCE=local` to skip the network fetch and synthesize a
placeholder release from the committed `changelog.json` — useful for offline
dev builds. Set `LINGUA_DOWNLOADS_BASE` to point at a staging bucket.

## Content sync

`npm run sync:content` reads from the local `lingua` sibling and writes
everything the build needs into this repo. It produces:

- `src/content/press-kit/*.md` and `src/content/seo/en/*.md` — vendored markdown
- `src/data/roadmap.json` — parsed from `docs/ROADMAP.md` (Planned + Partial)
- `src/data/changelog.json` — parsed from `CHANGELOG.md`
- `src/data/unreleased.json` — `git log` since the latest stable tag, filtered
  to user-visible commits (`feat`/`fix`/`perf`)

All four are committed. The Astro build never reads from the main repo or hits
GitHub — CF Pages and CI build with zero auth.

Three ways to run a sync:

1. **Manual.** `npm run sync:content` then commit `src/content` and `src/data`.
2. **One-shot.** `npm run sync:commit` (no push) or `npm run sync:push`.
   Aborts if unstaged work under those paths exists, so a sync commit never
   bundles unrelated edits.
3. **Scheduled.** `.github/workflows/sync-content.yml` runs daily at 12:00 UTC
   and on demand from the Actions tab. It opens or updates a PR titled
   `sync: refresh content from lingua@main` whenever anything changed. Requires
   a fine-grained PAT (Contents: Read, Metadata: Read) on the private `lingua`
   repo, stored as the `LINGUA_REPO_TOKEN` repo secret.

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
