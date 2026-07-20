# Runbook — Telemetry pipeline

**Severity:** S3 (informational). Telemetry is opt-in, best-effort, and never on the user-facing critical path. Drops do not block any feature.
**Owner:** maintainer.
**Related:** `update-server/src/telemetry.ts`, `src/shared/telemetry.ts`, `src/renderer/utils/telemetry.ts`, Cloudflare Workers Observability.

## What this pipeline is

Lingua's renderer emits a fixed allowlist of telemetry events (see `src/shared/telemetry.ts:TELEMETRY_EVENTS`) when the user has explicitly granted consent in **Settings → Privacy**. Each event is POSTed as JSON to `POST https://updates.linguacode.dev/telemetry`. The endpoint is hosted on the `update-server` Cloudflare Worker; it validates the payload against a verbatim mirror of the renderer allowlist + a substring deny pass, rate-limits per IP, and persists via Workers Observability `console.log` JSON.

The privacy contract:

- No user code, no file paths, no project names, no license tokens, no email, no IPs (only a coarse bucket on rate-limit denials).
- Every property key is per-event allowlisted on BOTH the renderer (`redactForTelemetry`) and the worker (`validateTelemetryPayload`). Unknown keys are silently dropped.
- Even if a future allowlist regression permitted a sensitive key name, the `DENY_SUBSTRINGS` substring guard re-strips it.
- The web build sets `VITE_LINGUA_TELEMETRY_URL` to the endpoint above; desktop production leaves it unset by default so packaged desktop builds never emit (per `.github/workflows/release.yml`, which has no telemetry env). To override on desktop, set `VITE_LINGUA_TELEMETRY_URL` at build time and rebuild — the env var is build-time, not runtime.

## How to tail events live

```bash
cd update-server
pnpm exec wrangler tail lingua-update-server --format pretty
```

Filter to telemetry-only lines:

```bash
pnpm exec wrangler tail lingua-update-server --format json \
  | jq 'select(.event == "telemetry.event")'
```

Each `telemetry.event` log line contains:

- `event: "telemetry.event"` — the structured-log tag.
- `eventName` — one of the allowlist values from
  `TELEMETRY_EVENT_NAMES` (e.g., `runner.executed`).
- `properties` — the sanitized property bag (after the allowlist +
  deny-substring guard).
- `timestamp` — ISO-8601 UTC, written by the shared `log()` helper.

To correlate a `telemetry.event` with HTTP-level latency or
status, join against the sibling `request.completed` line for the
same request via the standard observability envelope (`route:
"telemetry.ingest"`, `method: "POST"`, `status`, `durationMs`).

Rate-limit denials surface as `telemetry.rate_limited` with a
coarse `ipBucket` and a paired `request.completed` line at
`status: 429`.

## How to query historical events

Workers Observability retains structured `console.log` lines for ~3 days on the standard plan. Use the Cloudflare dashboard:

1. Open the Workers & Pages dashboard.
2. Pick the `lingua-update-server` worker.
3. Click **Logs** → filter by event source `telemetry.event` (or use the search box with `"event":"telemetry.event"`).
4. Bucket by `eventName` to see funnel volumes.

For a quick CLI alternative when the dashboard is degraded:

```bash
pnpm exec wrangler tail lingua-update-server --format json --since 1h \
  | jq 'select(.event == "telemetry.event")
       | { time: .timestamp, name: .eventName, props: .properties }'
```

## Kill switches

- **Server-side kill** — bind no traffic to the new route. Either:
  1. Comment out the `/telemetry` route in `update-server/src/index.ts` and redeploy (`cd update-server && pnpm run deploy`), OR
  2. Block the route at the Cloudflare zone via a WAF rule.
  Both surfaces fail closed: the renderer's emitter swallows any non-2xx response silently, so users see nothing.
- **Client-side kill** — set `VITE_LINGUA_TELEMETRY_DISABLED=1` in the web build env and redeploy `app.linguacode.dev`. Overrides user consent — no emits regardless. (Desktop is already kill-switched by leaving `VITE_LINGUA_TELEMETRY_URL` unset.)
- **Per-user opt-out** — already part of the product. Users flip the toggle in Settings → Privacy; the renderer drops back to no-op immediately.

## Allowlist drift — what to do when you add a new event

Adding or modifying telemetry events requires three concurrent edits, all in the SAME commit:

1. `src/shared/telemetry.ts` — extend `TELEMETRY_EVENTS` and `EVENT_PROPERTY_ALLOWLIST`. The renderer redactor reads from here.
2. `update-server/src/telemetry.ts` — extend `TELEMETRY_EVENT_NAMES` and `EVENT_PROPERTY_ALLOWLIST` verbatim. The worker validator reads from here.
3. `update-server/test/telemetry.test.ts` — the "implementation note" parity tests will fail until both copies match. If they pass, you're done.

The privacy-document copy (consent UI hint in `privacy.firstRun.body`) must also be updated if the new event captures a new category of signal. Tier reviews from past slices: only event names, status/bucket enums, and language ids have ever shipped — never free-form text.

## Rate limit (`telemetry.rate_limited`)

The worker caps `5 POST / IP / second` (`RATE_LIMIT_PER_SECOND` in `update-server/src/telemetry.ts`). Renderer emits at most ~6 events per launch under normal use, so any sustained over-ceiling traffic indicates either:

1. A bug in the renderer's instrumentation firing the same event in a tight loop.
2. A malicious client lying about consent and flooding the endpoint.

When you see sustained `telemetry.rate_limited` events from a single `ipBucket`:

1. Check the renderer source via `git log src/renderer/utils/telemetry.ts` for recent loop additions.
2. If the renderer looks clean, treat it as abuse — the worker is already filtering, so no further action is needed unless the abuser saturates the rate limiter itself (which would be Cloudflare's DDoS protection's job, not ours).
3. Optionally tighten `RATE_LIMIT_PER_SECOND` and redeploy.

## When retention runs out — the D1 promotion path

Workers Observability retention (~3 days) is sufficient for short-cycle launch analytics. When the analytics window stretches beyond that — quarterly funnel reviews, regression-window investigations, anything that needs more than the dashboard scrolling can offer — promote persistence to D1.

The migration shape (sketch, not committed yet):

1. Add a D1 binding (`TELEMETRY_DB`) to `update-server/wrangler.toml`.
2. Create a single `events` table:
   ```sql
   CREATE TABLE events (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     event_name  TEXT NOT NULL,        -- one of TELEMETRY_EVENT_NAMES
     properties  TEXT NOT NULL,        -- JSON-encoded sanitized properties
     ip_bucket   TEXT NOT NULL,        -- coarse, never full IP
     received_at INTEGER NOT NULL      -- minute-rounded ms epoch
   );
   CREATE INDEX events_by_name_time ON events(event_name, received_at);
   ```
3. In `handleTelemetry`, after the `log('telemetry.event', …)` line, INSERT into D1 with `prepare/run`. Wrap with try/catch — D1 failures must not turn a successful telemetry POST into a 5xx.
4. Add a retention sweep: a scheduled trigger every day deletes rows older than 90 days.
5. Add a query endpoint (gated behind an admin token) to pull aggregates without exposing per-row data.

Reasoning for the schema:

- One table, denormalized — the worker's hot path is INSERT only.
- `properties` as TEXT/JSON, not separate columns — the allowlist is fluid; column-per-property would force a migration on every event.
- `ip_bucket` instead of full IP — privacy contract carries through.
- Minute-rounded `received_at` — matches `redactForTelemetry`'s timestamp rounding so server side never holds finer-grained timestamps than the wire payload.

When promoting, update this runbook with the new query patterns and remove this section.

## Validation after deploy

After redeploying the worker (any change to `update-server/src/telemetry.ts`):

```bash
curl -X OPTIONS https://updates.linguacode.dev/telemetry -i
# expect: HTTP/2 204, Access-Control-Allow-Origin: *

curl -X GET https://updates.linguacode.dev/telemetry -i
# expect: HTTP/2 405, Allow: POST, OPTIONS

curl -X POST https://updates.linguacode.dev/telemetry \
  -H 'Content-Type: application/json' \
  -d '{"event":"app.launched","properties":{"platform":"darwin"}}' -i
# expect: HTTP/2 204
```

Then tail `wrangler tail` and confirm the matching `telemetry.event` log line surfaces in real time.

## Related runbooks

- [`update-rollback.md`](./update-rollback.md) — rolling back the worker after a bad deploy.
- [`github-degraded.md`](./github-degraded.md) — sister runbook for the `/update/:platform/:version` route on the same worker.
