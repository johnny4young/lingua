# Runbook — desktop update rollback

**Severity:** S0 user-facing breakage.
**Owner:** maintainer.
**Related:** `RELEASE.md`, `electron-builder.yml`, `src/main/updater.ts`.

## Detection

Treat a release as bad when packaged launch smoke fails, crash reports rise
materially, published assets/manifests disagree, or users cannot install or
update. Desktop clients read GitHub Releases directly; Cloudflare R2 is not in
this rollback path.

## Fast withdrawal

When few clients have updated:

1. Remove the bad GitHub Release from the public channel. Preserve its tag and
   evidence until the incident is understood.
2. Confirm the previous stable release is again the latest public GitHub Release:

   ```bash
   gh release view --json tagName,isDraft,isPrerelease,url
   ```

3. Wait at least the GitHub/provider cache interval and check from a clean app.
4. Verify `https://updates.linguacode.dev/web/version` returns the previous
   stable version after its short cache expires.
5. Publish a website notice if users may already have downloaded the build.

## Hotfix

Withdrawal does not repair clients that already installed the bad build.

1. Fix the regression on `main`.
2. Publish a higher patch version through the full release workflow.
3. Verify the previous stable and affected versions both discover the hotfix.
4. Provide a direct GitHub Release download when the broken app cannot launch.

## Validation

- GitHub reports the intended good release as latest.
- Its `latest-mac.yml`, `latest.yml`, and `latest-linux.yml` match attached assets.
- `https://updates.linguacode.dev/web/version` reports the good version.
- Clean installations and in-place updates reach the hotfix.
- Crash/error rates return to baseline before removing the notice.
