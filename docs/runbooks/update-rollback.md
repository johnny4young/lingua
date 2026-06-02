# Runbook — update rollback (bad release)

**Severity:** S0 (user-facing breakage). Auto-update is shipping a broken build.
**Owner:** maintainer.
**Related:** `RELEASE.md` (release operator checklist), `update-server/src/index.ts`, `.github/workflows/release.yml`.

## Detection

A release is "bad" when one of these fires within 24h of a publish:

- Crash report spike — `LINGUA_CRASH_REPORTER_URL` ingestion shows >5x the baseline crash rate.
- User reports on Show HN / GitHub Issues / r/golang etc. of "the app won't launch after update".
- Smoke test on the maintainer's machine: packaged build crashes on boot.
- Log alert on a `request.completed { route: 'update.feed', status: 200 }` rate spike after the broken version ships (uncommon — usually the user-side reports come first).

If the bad release was published <30 minutes ago, the rollback window is tight: most users haven't pulled the auto-update yet. After 24h the cohort is mostly migrated and rollback's value drops.

## Mitigation

The rollback strategy depends on how many users have already updated:

### Path A — fast rollback (<30 min after publish)

Most users haven't received the auto-update yet. Pull the bad release before the cache TTL flushes:

1. Delete the bad GitHub Release (don't delete the tag yet — leave the tag so a hot-fix can rebase off it):
   - GitHub → Releases → Edit the bad release → Delete release. Confirm.
2. Purge the update-server cache for both platforms so clients don't get a stale 200:
   ```bash
   curl -X POST https://api.cloudflare.com/client/v4/zones/<zone_id>/purge_cache \
     -H "Authorization: Bearer <CLOUDFLARE_API_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"files": [
       "https://updates.linguacode.dev/update/darwin/0.0.0",
       "https://updates.linguacode.dev/update/win32/0.0.0",
       "https://updates.linguacode.dev/web/version"
     ]}'
   ```
3. Verify the rollback:
   ```bash
   curl https://updates.linguacode.dev/web/version
   # Should return the *previous* good tag, e.g. {"version":"0.2.0"}
   ```
   Then validate the desktop feed evidence:
   ```bash
   pnpm run check:update-feed -- --old-version <old_tag>
   ```
4. Tail logs to confirm clients are no longer being served the bad version:
   ```bash
   wrangler tail --format=pretty | grep '"route":"update.feed"'
   ```
5. Communicate to users via the marketing site banner (`lingua-marketing` repo, separate deploy):
   - "We rolled back release vX.Y.Z. Please skip this update."

### Path B — late rollback (>30 min after publish, many users updated)

Most users already have the bad version. Rolling back doesn't fix their installs — only a NEW release does:

1. Land the fix on `main` and run the release workflow to publish vX.Y.(Z+1) (a hotfix).
2. The hotfix release goes through the standard `release.yml` (signing + notarization + checksum verification + packaged smoke).
3. Auto-update will re-pull on the next 1h check.
4. For users who are stuck (app won't launch), publish a "Manual install" instruction on linguacode.dev/troubleshoot pointing at the previous good build's GitHub Release page.

## Rollback (re-publish previous release if Path A was wrong)

If Path A's deletion was triggered in error:

1. The release artifacts are still in the GitHub Releases trash for 30 days.
2. Restore from GitHub Releases trash if the deletion was within the retention window.
3. Otherwise re-run `release.yml` for the same tag (the workflow regenerates artifacts from the source code at that tag).

## Customer-support note

Template reply for users who already updated to the bad version:

```
Hi <name>,

We've identified an issue with version vX.Y.Z and are publishing a
hotfix shortly. Your Lingua app will auto-update within 1 hour.

If your app won't launch:
  1. Download the previous version from
     https://github.com/johnny4young/lingua/releases/tag/v<previous>.
  2. Reinstall over the broken build.
  3. The auto-update will catch the hotfix once it ships.

We'll email you when the hotfix is live.

— Lingua support
```

For pre-update users, point at the marketing-site banner.

## Validation

1. `https://updates.linguacode.dev/update/darwin/<previous_tag>` returns `204` (no update available — they're already current).
2. `https://updates.linguacode.dev/update/darwin/<old_tag>` returns the GOOD release, not the rolled-back one.
3. `https://updates.linguacode.dev/web/version` returns the good tag.
4. `pnpm run check:update-feed -- --old-version <old_tag>` writes
   `output/update-feed-validation/update-feed-validation.json` without the bad
   version in the evidence.
5. Crash report rate returns to baseline within 1h (auto-update window) for the rolled-back cohort.
6. Marketing-site banner is dismissed once the hotfix is live.
