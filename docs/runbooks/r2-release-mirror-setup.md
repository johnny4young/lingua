# R2 release mirror — one-time setup + per-release validation

> The Lingua source repository is private. GitHub Releases on a private
> repository require an authenticated request even for binary
> downloads, so the marketing site cannot link directly to
> `github.com/.../releases/download/...`. This runbook configures a
> Cloudflare R2 bucket as a public mirror that the release workflow
> populates automatically after every successful publish, plus the
> per-release sanity check the operator runs before announcing.

**Scope.** Desktop installers (`.dmg`, `.exe`, `.nupkg`, `RELEASES`,
`.deb`, `.rpm`), the checksum manifest (`SHA256SUMS.txt`), the SBOM
(`lingua-sbom.cyclonedx.json`), and the third-party license report
(`THIRD_PARTY_LICENSE_REPORT.md`). The web bundle stays on Cloudflare
Pages at `app.linguacode.dev` (RL-061 Slice 5) — it does not need R2.

**Out of scope.** The update-server keeps serving `/update/...` and
`/web/version` from authenticated GitHub Releases metadata
(`GITHUB_TOKEN` already configured in `wrangler.toml`). R2 is only the
**download surface for marketing-site CTAs and direct human
downloads**, not the auto-update channel — that stays end-to-end
authenticated against the private repo. Cleaning up the two surfaces
to share R2 is a future enhancement, not a Slice 1 requirement.

---

## Part 1 — One-time setup

Run this once per Cloudflare account + GitHub repo pair. It takes
~30 minutes of panel work.

### 1.1 Create the R2 bucket

1. Cloudflare dashboard → **R2** → **Create bucket**.
2. Name: `lingua-releases`.
3. Location hint: choose closest to your primary audience (default
   `Automatic` is fine).
4. Storage class: `Standard`.
5. Leave **Object lifecycle policies** empty — the workflow keeps
   every published version forever (revertability + reproducibility).

### 1.2 Attach a public custom domain

R2 buckets are not public by default. Two ways to expose them:

- **`r2.dev` subdomain** (quick, no DNS): R2 panel → bucket →
  **Settings** → **Public access** → enable `Public Development URL`.
  Returns a URL like `https://pub-<hash>.r2.dev`. Use this for
  staging only — Cloudflare reserves the right to revoke or rate-
  limit `r2.dev` URLs.
- **Custom domain** (production): R2 panel → bucket → **Settings** →
  **Custom domains** → **Connect domain** → `downloads.linguacode.dev`.
  Cloudflare auto-issues a TLS certificate and adds a CNAME if the
  zone is on Cloudflare. **Production releases must use the custom
  domain** so a Cloudflare policy change cannot break user downloads.

After both panels confirm green, validate from a non-authenticated
shell:

```bash
curl -I https://downloads.linguacode.dev/
# Expect HTTP/2 200 or 403 (listing disabled, fine — means the
# domain reaches the bucket).
```

### 1.3 Create an R2 API token with scoped write permission

Cloudflare dashboard → **R2** → **Manage R2 API Tokens** →
**Create API token**.

- Token name: `lingua-release-workflow`
- Permissions: **Object Read & Write**
- Bucket: **Apply to specific buckets only** → select
  `lingua-releases`. Do NOT grant account-wide access.
- TTL: leave open-ended (rotate manually per Part 4 below).

Cloudflare returns three values — copy them immediately, the secret
is shown only once:

- **Access Key ID** → use as `R2_ACCESS_KEY_ID`
- **Secret Access Key** → use as `R2_SECRET_ACCESS_KEY`
- **Endpoint URL** (looks like
  `https://<account-id>.r2.cloudflarestorage.com`) → use as
  `R2_ENDPOINT`

### 1.4 Register the four secrets in GitHub Actions

From the repo root:

```bash
gh secret set R2_ACCESS_KEY_ID --body '<the-access-key-id>'
gh secret set R2_SECRET_ACCESS_KEY --body '<the-secret-access-key>'
gh secret set R2_ENDPOINT --body 'https://<account-id>.r2.cloudflarestorage.com'
gh secret set R2_PUBLIC_BASE --body 'https://downloads.linguacode.dev'
```

The `R2_PUBLIC_BASE` secret is what the workflow stamps into the
`manifest.json` so marketing-site code knows where to link.

Confirm with:

```bash
gh secret list | grep R2_
# Expect exactly four R2_* secrets.
```

### 1.5 Smoke the workflow on a throwaway tag

Before tagging a real release:

1. Tag the current `main` with a `v0.0.0-r2-smoke` annotated tag:
   `git tag -a v0.0.0-r2-smoke -m 'R2 mirror smoke'`
   `git push origin v0.0.0-r2-smoke`
2. Trigger the Release workflow with `release_tag: v0.0.0-r2-smoke`,
   set all desktop platforms to `false` and `release_web: false` — so
   the smoke only exercises the security audit + the new
   `mirror-r2` job's dry-run path.
3. Confirm the workflow summary shows `R2 mirror sync` as `skipped
   — no desktop artifacts` (graceful degradation when nothing was
   built). This proves the secrets are wired before a real release
   trusts them.
4. Delete the throwaway tag + draft release:
   `gh release delete v0.0.0-r2-smoke --yes`
   `git push --delete origin v0.0.0-r2-smoke`
   `git tag -d v0.0.0-r2-smoke`

### 1.6 Update the marketing site CTAs

The marketing site lives in this repo under `website/` (Astro +
Cloudflare Pages). The
Download CTAs there must point to the R2 mirror, not GitHub:

- macOS: `https://downloads.linguacode.dev/latest/lingua-darwin-arm64.dmg`
- Windows: `https://downloads.linguacode.dev/latest/lingua-win-x64-setup.exe`
- Linux DEB: `https://downloads.linguacode.dev/latest/lingua-amd64.deb`
- Linux RPM: `https://downloads.linguacode.dev/latest/lingua-x86_64.rpm`
- Checksums: `https://downloads.linguacode.dev/latest/SHA256SUMS.txt`
- SBOM: `https://downloads.linguacode.dev/latest/lingua-sbom.cyclonedx.json`

The `/latest/` prefix is a copy the workflow re-writes on every
publish (Part 2 below).

### 1.7 Web runtime assets

The same bucket also serves oversized web runtime WASM files that
Cloudflare Pages cannot accept as static assets:

- `https://downloads.linguacode.dev/web-runtime/duckdb/<version>/duckdb-mvp.wasm`
- `https://downloads.linguacode.dev/web-runtime/ruby/<version>/ruby+stdlib.wasm`

`.github/workflows/deploy-web.yml` uploads these files before running
`wrangler pages deploy`, then fails if any file larger than 25 MiB
remains in `dist/web`.

Because these files are fetched by browser code from
`https://app.linguacode.dev`, the bucket CORS policy must allow that
origin:

```json
{
  "rules": [
    {
      "allowed": {
        "origins": ["https://app.linguacode.dev"],
        "methods": ["GET", "HEAD"]
      }
    }
  ]
}
```

Apply and verify it with Wrangler:

```bash
pnpm exec wrangler r2 bucket cors set lingua-releases --file cors.json
pnpm exec wrangler r2 bucket cors list lingua-releases
```

The deploy workflow sends `Origin: https://app.linguacode.dev` to both
runtime URLs and fails before `wrangler pages deploy` if R2 does not
return a matching `Access-Control-Allow-Origin` header. If CORS was
added after objects were already cached on the custom domain, purge the
`downloads.linguacode.dev` cache before retrying the deploy.

### 1.8 Cache the runtime assets at the edge (prevents transient 503s)

The runtime WASM objects are large (~38 MiB DuckDB MVP, ~29 MiB Ruby
stdlib) and are uploaded with `Cache-Control: public, max-age=31536000,
immutable` (see the `aws s3 cp` step in `deploy-web.yml`). But an R2 custom
domain does **not** cache at the Cloudflare edge by default — a
`curl -sI` on a runtime URL shows `cf-cache-status: DYNAMIC`, which means
every visitor's fetch travels all the way to the R2 origin. A 38 MiB
uncached object fetched on every SQL-workspace open is exactly the load
pattern that makes R2 return an intermittent `503 Service Unavailable`
(observed in the SQL workspace as "Could not load the SQL engine").

Fix: add a **Cache Rule** so the edge caches the immutable runtime prefix.
In the Cloudflare dashboard for `linguacode.dev`:

- **Rules → Cache Rules → Create rule**
- Name: `web-runtime immutable cache`
- When incoming requests match: `Hostname equals downloads.linguacode.dev`
  **and** `URI Path starts with /web-runtime/`
- Then: **Eligible for cache** = on; **Edge TTL** = *Respect origin TTL*
  (the objects already send `max-age=31536000, immutable`).

Verify with a warm second request:

```bash
curl -sI "https://downloads.linguacode.dev/web-runtime/duckdb/$(node -e "console.log(require('./node_modules/@duckdb/duckdb-wasm/package.json').version)")/duckdb-mvp.wasm" | grep -i cf-cache-status
# expect: cf-cache-status: HIT   (not DYNAMIC)
```

Once cached, the ~300 edge PoPs absorb the load and R2 is only touched on a
per-PoP cache miss, which removes the 503s and cuts cold-load latency. The
client also retries transient 5xx / network errors
(`fetchRuntimeAssetWithRetry` in `src/renderer/runtime/duckdbClient.ts`) as
a second line of defense, but **edge caching is the durable fix** — do not
rely on client retries alone.

### 1.9 Marketing-site refresh on release

The marketing site lives in this repo under `website/` and deploys via
`deploy-website.yml`, which triggers on a published release (as well as on
`website/` and content-source changes). A release therefore refreshes the
site's changelog + version automatically — no cross-repo sync, no PAT, no
extra secret.

Historically this used a `MARKETING_SYNC_TOKEN` PAT to dispatch a
`sync-content.yml` workflow in a separate `lingua-marketing` repo; that whole
cross-repo path is retired (the site moved into `website/`, vendoring content
locally from the repo root).

---

## Part 2 — Per-release validation

This is the operator step that goes on the release checklist
(`RELEASE.md`). Runs after `mirror-r2` reports success in the
workflow.

```bash
pnpm run check:r2-mirror -- --release-tag v0.4.0
```

The script:

1. Calls the authenticated GitHub Releases API to list the assets
   that landed on the draft release for `v0.4.0`.
2. Lists the equivalent paths on R2 via the public URL
   (`HEAD https://downloads.linguacode.dev/v0.4.0/<asset>`).
3. Compares the SHA-256 of every asset against `SHA256SUMS.txt`
   pulled from R2.
4. Validates that `https://downloads.linguacode.dev/latest/...`
   redirects (or 200s) to the same files.
5. Exits 0 if everything is in sync; exits 1 with a per-file diff
   if anything is missing or mismatched.

The output is also written to `output/r2-mirror-validation/<tag>.json`
so it can be attached to the release evidence alongside the
`update-feed-validation.json` from the desktop-update runbook.

---

## Part 3 — Rollback

If the R2 mirror is broken but the GitHub Release publish succeeded:

1. The auto-update channel (Sparkle / Squirrel) keeps working —
   nothing to roll back for existing users.
2. Marketing-site downloads break for new users. Quick mitigations,
   in order of preference:
   - **Re-run only the `mirror-r2` job** from the Actions UI
     (`Re-run jobs` → `mirror-r2`). Idempotent; safe.
   - If R2 itself is down (rare), point the marketing site CTAs at
     the GitHub Releases URL **as a temporary fallback** — users will
     hit a 404 because the repo is private. Better: roll the
     marketing site to a "Download temporarily unavailable, contact
     <support email>" state.
3. After R2 recovers, re-run `check:r2-mirror` to confirm the
   manifest is current, then restore the marketing site CTAs.

If R2 returns wrong artifacts (corrupted upload, stale `latest/`
pointer):

1. Cloudflare R2 panel → bucket → delete the offending objects.
2. Re-run the `mirror-r2` job.
3. `check:r2-mirror` will fail until R2 catches up; it's safe to
   re-run as many times as needed (overwrites).

---

## Part 4 — Token rotation

Cadence: every 12 months OR immediately if a token is suspected
compromised.

1. Create a NEW R2 API token (Part 1.3) with name suffix
   `-YYYY-MM`.
2. Rotate the four GitHub secrets (Part 1.4) — `gh secret set`
   overwrites.
3. Trigger a smoke release (Part 1.5) to validate.
4. Cloudflare R2 panel → revoke the OLD token.

---

## Part 4.5 — R2 + aws-cli gotchas

R2 implements most of the S3 API but not all of it. The release
workflow intentionally uploads from the local release payload to both
`<tag>/` and `latest/`. Do not use `aws s3 sync` or `aws s3 cp` to
copy from one R2 prefix to another for this flow: `aws-cli` can emit
tagging directives for `CopyObject`, and R2 rejects those paths with
`NotImplemented` (for example
`Header 'x-amz-tagging-directive' with value 'REPLACE' not implemented`).

Two rules are mandatory when scripting against R2 with `aws-cli`:

- **Upload local files with `aws s3 cp ... --copy-props none`**. Local
  uploads do not need source object tags, and the flag keeps aws-cli
  away from tag-preservation behavior on paths that support it.
- **Use `AWS_DEFAULT_REGION=auto`** (set in the workflow env). R2
  ignores region but `aws-cli` requires the env var to be present.

If `latest/` is half-populated, the recovery without re-running the
whole workflow is to clear the prefix and re-upload from a local copy
of the release payload:

```bash
export AWS_ACCESS_KEY_ID='...'
export AWS_SECRET_ACCESS_KEY='...'
export AWS_DEFAULT_REGION=auto
export R2_ENDPOINT='https://<account-id>.r2.cloudflarestorage.com'

# Clear half-populated latest/, then upload the exact release files
# from a local payload directory.
aws s3 rm s3://lingua-releases/latest/ --recursive \
  --endpoint-url "$R2_ENDPOINT"

while IFS= read -r src; do
  name="$(basename "$src")"
  aws s3 cp "$src" "s3://lingua-releases/latest/${name}" \
    --endpoint-url "$R2_ENDPOINT" \
    --copy-props none \
    --no-progress
done < <(node ./scripts/prepare-release-payload.mjs --root out/make --print-assets)
```

## Part 5 — Cost expectations

R2 pricing (as of 2026):

- Storage: $0.015 / GB-month. A full release across mac/win/linux
  is ~400 MB. 10 releases retained = 4 GB = **$0.06/month**.
- Class A operations (writes): $4.50 / million. A release does
  ~15 writes. 10 releases/year = 150 writes total = **negligible**.
- Class B operations (reads): $0.36 / million. Even 1M downloads
  is **$0.36**.
- **Egress: $0**. Cloudflare's R2 differentiator. Heavy bandwidth
  releases (e.g. viral launch week) cost the same as a quiet week.

Annual ceiling for a small-scale release cadence: <$5.

---

## Part 6 — Related runbooks

- [`desktop-update-draft-validation.md`](./desktop-update-draft-validation.md)
  — gates the `/update/...` feed; orthogonal to R2 mirror but runs
  in the same release window.
- [`update-rollback.md`](./update-rollback.md) — when a broken
  release needs to be retracted.
- [`github-degraded.md`](./github-degraded.md) — when the GH API
  outage interrupts the release workflow; R2 mirror is unaffected
  once the publish step lands.

---

## Open follow-ups (deferred)

- Migrate the `/update/...` endpoint to optionally return R2 URLs
  instead of GH browser_download_url, so the auto-update channel
  ALSO benefits from R2's $0 egress. Requires update-server changes
  + Sparkle/Squirrel re-test. Tracked as a future slice; not blocking
  the marketing-site download path.
- Add `tests/build/r2MirrorParity.test.ts` (gated on
  `LINGUA_CHECK_R2=1`) to assert at PR time that the release
  workflow still uploads to R2 — same pattern as
  `tests/build/depFreshness.test.ts`.
