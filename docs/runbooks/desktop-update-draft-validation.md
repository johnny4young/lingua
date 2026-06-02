# Runbook — desktop update draft validation

**Severity:** S1 (release-blocking). A desktop release must not leave draft
until a signed older install can update to the signed candidate through an
isolated update feed.

**Owner:** maintainer.

**Related:** `RELEASE.md`, `docs/MACOS_SIGNING.md`,
`docs/WINDOWS_SIGNING.md`, `src/main/updater.ts`,
`update-server/src/index.ts`, `scripts/validate-update-feed.mjs`.

## Intent

Production `updates.linguacode.dev` serves only non-draft, non-prerelease
GitHub Releases. Draft validation uses a separate staging deployment of the
update worker with:

```text
GITHUB_RELEASE_CHANNEL=draft
```

Never set that variable on the production update worker. The staging worker can
share the same GitHub token scope, but it must use a separate route or
Cloudflare preview URL so stable users cannot discover draft artifacts.

## Preconditions

- `package.json` and `CHANGELOG.md` already match the target stable tag.
- The `Release` workflow produced a GitHub Release that is still **draft**.
- macOS artifacts are Developer ID signed and notarized.
- Windows artifacts are Authenticode signed.
- The previous public version is installed on the target machine or VM.
- A staging update worker is deployed with `GITHUB_RELEASE_CHANNEL=draft`.
- You know:
  - `OLD_VERSION` — the installed app version, for example `0.2.4`.
  - `EXPECTED_VERSION` — the draft candidate, for example `0.2.5`.
  - `STAGING_UPDATE_URL` — the staging update worker base URL.

## Feed validation

Run the feed check against staging before launching the app:

```bash
pnpm run check:update-feed -- \
  --base-url "$STAGING_UPDATE_URL" \
  --old-version "$OLD_VERSION" \
  --expected-version "$EXPECTED_VERSION"
```

Expected result:

- `darwin` returns Squirrel.Mac JSON with a signed `.zip` URL, release name,
  notes, and `pub_date`.
- `win32` returns a rewritten `RELEASES` file where `.nupkg` entries point to
  `/download/:assetId/:filename`.
- Evidence is written to `output/update-feed-validation/`.

Also run the stable-feed no-update check so production cannot accidentally see
the draft:

```bash
pnpm run check:update-feed -- \
  --base-url https://updates.linguacode.dev \
  --old-version "$EXPECTED_VERSION"
```

Expected result: `204` for each platform, or the latest already-published
stable version if a newer stable hotfix exists. It must not reference the draft
candidate before promotion.

## App update validation

1. Install the previous signed release on macOS and/or Windows.
2. Override the update endpoint to the staging worker in the packaged build
   configuration used for this validation. Do not ship that override.
3. Launch the app and open Settings > Updates.
4. Trigger or wait for the update check.
5. Confirm the update state transitions through checking, available, and
   downloaded.
6. Restart through the app update action.
7. Confirm the relaunched app reports `EXPECTED_VERSION`.
8. Save the updater log, screenshots, and the generated
   `output/update-feed-validation/update-feed-validation.json` artifact.

## Rollback validation

1. Remove the draft candidate from the staging feed or point staging back to
   stable.
2. Purge the staging update route cache if Cloudflare cached the candidate.
3. Re-run:

   ```bash
   pnpm run check:update-feed -- \
     --base-url "$STAGING_UPDATE_URL" \
     --old-version "$OLD_VERSION"
   ```

4. Confirm the draft candidate is no longer served.

## Promotion rule

Promote the GitHub Release only after:

- feed validation passes for both platforms selected for release,
- at least one signed packaged install updates successfully through staging,
- rollback validation proves the candidate can be removed from the feed,
- `docs/RELEASE_SECURITY.md` is complete for the release.
