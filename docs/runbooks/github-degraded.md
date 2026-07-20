# Runbook — GitHub degraded

**Severity:** S2 (degraded). New downloads, desktop update checks, and the web
version banner may be unavailable; installed Lingua runtimes continue working.

**Owner:** maintainer.

**Related:** `src/main/updater.ts`, `update-server/src/index.ts`,
`update-server/src/lib/health.ts`, and the
[GitHub status page](https://www.githubstatus.com/).

## Current dependency boundary

- Desktop installers and `electron-updater` metadata are served directly from
  public GitHub Releases.
- The marketing site reads the latest public release from the GitHub API and
  has a committed offline fixture for static builds.
- `update-server` uses GitHub for `/web/version`; its old platform-specific
  update routes remain only for compatibility and are not the desktop release
  feed.
- Browser runtimes come from the dedicated R2 runtime bucket and are unaffected
  by a GitHub API-only incident.

## Detection

- GitHub reports an incident affecting Releases, the REST API, or downloads.
- `GET https://updates.linguacode.dev/health/ready` reports GitHub as degraded.
- `/web/version` returns an upstream error or an older cached version.
- Desktop logs show an updater network/upstream failure.

The update service caches successful `/web/version` responses briefly. That
cache can soften a short API incident, but it does not proxy desktop release
artifacts or updater manifests.

## Mitigation

### Short incident

Monitor GitHub status and avoid publishing or promoting a release while the API
or release downloads are degraded. Lingua remains usable; the desktop updater
will retry during a later check.

### Longer incident

If the outage is visible for more than two hours:

1. Add a temporary banner to `website/` explaining that downloads or update
   checks are delayed by a GitHub incident.
2. Link to the GitHub status page and state that installed Lingua sessions keep
   working.
3. Do not create an ad-hoc binary mirror. A new distribution host requires its
   own integrity, signing, rollback, and updater design review.

If only `/web/version` is affected and a longer cache is justified, change the
cache TTL in `update-server/src/index.ts`, deploy the Worker, and record a
specific rollback time. This does not restore desktop downloads.

## Recovery

1. Confirm GitHub Releases and REST API are healthy for at least 30 minutes.
2. Verify the current release page and one checksum-protected asset download.
3. Confirm `https://updates.linguacode.dev/web/version` returns the current
   production version.
4. In an installed desktop build, run **Check for Updates** and confirm the
   request completes without an updater error.
5. Revert any temporary cache-TTL change and remove the website banner.

## Support response

Tell affected users that Lingua itself remains operational, GitHub hosts the
official downloads, and update checks will retry after the upstream service
recovers. Do not direct users to unofficial binary copies.
