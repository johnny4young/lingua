# Runbook — GitHub API degraded

**Severity:** S2 (degraded). Update feed cannot reach GitHub; existing users see no breakage thanks to the cache, but new releases stall.
**Owner:** maintainer.
**Related:** `update-server/src/index.ts`, `update-server/src/lib/health.ts`, GitHub status page.

## Detection

- GitHub status page (https://www.githubstatus.com/) reports an incident affecting REST API.
- `update-server` health: `GET /health/ready` returns `{ ok: false, degraded: ['github'] }`.
- Log alert: `request.completed { route: 'update.feed', errorClass: 'upstream', status: 502 }` rate spikes.
- Crash report ingestion is steady (the desktop app handles update fetch failures gracefully).

The update-server caches successful responses for 5 minutes. As long as a release is in cache, users keep getting served the right answer; the degraded signal fires only when the cache misses (e.g., a new platform/version combination first asks for a release).

## Mitigation

### Path A — ride out the incident

For most degradations (<1h), the existing 5-minute cache TTL plus the desktop client's 4h auto-update interval mean very few users actually feel the outage. Action: nothing. Just monitor.

### Path B — extend cache TTL temporarily

If the GitHub incident is going to last more than ~30 minutes, bump the update-server cache TTL to keep the existing release available longer:

1. Edit `update-server/src/index.ts` constant `CACHE_TTL` from `300` to `3600` (1 hour).
2. Deploy: `cd update-server && npx wrangler deploy`.
3. Set a calendar reminder to revert after the incident.

This keeps the cache warm so users who haven't yet updated continue to see the latest release even while GitHub is down. Users currently updating won't be affected — Squirrel.Mac and Squirrel.Windows handle 4xx/5xx by retrying on the next interval.

### Path C — communicate to users

If the incident is highly visible (GitHub status page widely shared) and the degradation lasts >2h:

1. Add a banner to the marketing site (`lingua-marketing` repo) reading:
   "GitHub-side issue is delaying our auto-update feed. Lingua continues to work fine; we'll resume regular updates once GitHub is healthy."
2. Pin the banner until GitHub status is green for 30+ minutes.

## Rollback

When GitHub is healthy again:

1. Revert the cache TTL bump (set `CACHE_TTL` back to `300`):
   ```bash
   cd update-server
   git checkout src/index.ts # if uncommitted
   npx wrangler deploy
   ```
2. Purge the cache so users re-fetch the latest release within the standard 5-minute window:
   ```bash
   curl -X POST https://api.cloudflare.com/client/v4/zones/<zone_id>/purge_cache \
     -H "Authorization: Bearer <CLOUDFLARE_API_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"purge_everything": true}'
   ```
3. Confirm the cache is fresh: `curl https://updates.linguacode.dev/web/version` should refresh from GitHub.
4. Remove the marketing-site banner.

## Customer-support note

Most users won't notice the incident because of the cache. For the few who report "Check for Updates" failing:

```
Hi <name>,

GitHub (where we host our release artifacts) is having an issue right
now — see https://www.githubstatus.com/. Lingua itself is working fine;
auto-updates will resume automatically once GitHub recovers.

You don't need to do anything; the app will catch up on its own.

— Lingua support
```

## Validation

1. `update-server` health: `curl https://updates.linguacode.dev/health/ready` returns `{ ok: true, degraded: [] }`.
2. `request.completed` volume for `"route":"update.feed"` returns to baseline.
3. `request.completed` with `"route":"update.feed"` and `"errorClass":"upstream"` returns to <0.1% of requests.
4. GitHub status page green for 30+ continuous minutes.
5. Marketing-site banner removed (if Path C was triggered).
