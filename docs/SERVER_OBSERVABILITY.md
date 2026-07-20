# Server observability — license-server + update-server

> internal Operational-readiness spec for the two Cloudflare Workers
> backing licensing (`license-server/`) and update feeds (`update-server/`).
> Pin dashboards, alerts, and runbooks against the contract here. When
> the wire format or event taxonomy changes, update this document in
> the same commit.

## Overview

Both workers emit structured JSON to stdout via `console.log`. Cloudflare's Logpush picks the lines up and ships them to the configured destination (Cloudflare R2 / customer log endpoint / etc.). The on-disk shape per line is:

```json
{
  "event": "<event-name>",
  "timestamp": "2026-05-06T12:34:56.789Z",
  "route": "licenses.activate",
  "method": "POST",
  "status": 200,
  "durationMs": 42,
  "errorClass": "client",
  "...": "...payload-specific keys, redacted"
}
```

The catalog of event names + payload shapes is the contract. Adding an event is fine; renaming or removing one breaks dashboards / alerts / runbooks pinned to that name. Treat the catalog as an additive surface. Today the emitted contract is deliberately small: request envelopes, unhandled-error envelopes on `license-server`, and readiness snapshots. Domain-specific success events can be added later, but runbooks must not depend on them until the code emits them.

## Metrics catalog

### Common (both workers)

| Event name | Trigger | Payload | Notes |
|---|---|---|---|
| `request.received` | every request, before dispatch | `route`, `method`, `path` | Path is logged unredacted; query strings are kept (for low-cardinality routes only). |
| `request.completed` | every request, after dispatch | `route`, `method`, `status`, `durationMs`, `errorClass?`, `errorMessage?` | `errorClass` is emitted for handled 4xx / 5xx responses and thrown failures. `errorMessage` is emitted only when the handler threw. |
| `request.unhandled_error` | `Hono.app.onError` fires | `path`, `method`, `errorClass`, `errorMessage` | license-server only; update-server doesn't have an unhandled fallback distinct from `request.completed`. |
| `health.ready` | `GET /health/ready` resolves | `ok`, `degraded[]` | One per probe — useful for trending dependency health over time. |

### license-server route labels

These labels appear in `request.received.route` and `request.completed.route`.

| Route label | Surface | Notes |
|---|---|---|
| `health.live` | `GET /`, `GET /health` | Liveness only. |
| `health.ready` | `GET /health/ready` | Also emits `health.ready` with dependency snapshot. |
| `licenses.activate` | `POST /licenses/activate` | 4xx status means token / device / plan input problem. |
| `licenses.status` | `GET /licenses/status` | Query strings remain in `path`; route stays low-cardinality. |
| `licenses.devices.remove` | `POST /licenses/devices/remove` | Device revoke path. |
| `licenses.recover.start` | `POST /licenses/recover/start` | Recovery email request path. |
| `licenses.recover.confirm` | `GET /licenses/recover/confirm` | Recovery confirmation path. |
| `trials.start` | `POST /trials/start` | Free trial issuance path. |
| `education.start` | `POST /education/start` | Education confirmation email request. |
| `education.confirm` | `GET /education/confirm` | Education token issuance. |
| `education.renew` | `POST /education/renew` | Education renewal path. |
| `webhooks.polar` | `POST /webhooks/polar` | Polar delivery success and failure are inferred from `status` + D1 / Polar dashboards. |
| `unknown` | any unmatched path | Should be low volume; investigate spikes. |

### update-server route labels

These labels appear in `request.received.route` and `request.completed.route`.

| Route label | Surface | Notes |
|---|---|---|
| `health.live` | `GET /`, `GET /health` | Liveness only. |
| `health.ready` | `GET /health/ready` | Also emits `health.ready` with GitHub dependency snapshot. |
| `update.feed` | `GET /update/:platform/:version` | Returned 502 responses are classified as `upstream`. |
| `update.asset_proxy` | `GET /download/:assetId` | Returned 502 responses are classified as `upstream`. |
| `update.web_version` | `GET /web/version` | Returned 502 responses are classified as `upstream`. |
| `telemetry.ingest` | `POST /telemetry` and `OPTIONS /telemetry` | implementation 400 means malformed payload; 405 means non-POST; 413 means oversize; 429 means per-IP rate-limited. 204 on success. |
| `unknown` | any unmatched path | Includes 404s for non-existent routes. |

### update-server telemetry-ingest events

In addition to the common `request.*` envelope, the `/telemetry`
route emits two extra structured log lines:

| Event name | Trigger | Payload | Notes |
|---|---|---|---|
| `telemetry.event` | Each successful validated POST. | `eventName` (one of `TELEMETRY_EVENT_NAMES`), `properties` (sanitized). | The single source for funnel queries. Workers Observability retains ~3 days on the standard plan; see `docs/runbooks/telemetry-pipeline.md` for the D1 promotion path. |
| `telemetry.rate_limited` | Per-IP ceiling (5 req/sec) exceeded. | `ipBucket` (last IPv4 octet / last IPv6 hextets truncated). | Sustained spikes from one bucket indicate either a renderer instrumentation loop or abusive traffic. |

## Error classification

Every `errorClass` is one of four:

| Class | Meaning | Example | Alert? |
|---|---|---|---|
| `client` | Bad input from the caller. Hono validation, 4xx, signature failures. | `unauthorized request`, `invalid signature` | No (informational). |
| `server` | Bug in our code. Default classification when no other rule fires. | unhandled `TypeError`, missing field crash | Yes — page on threshold breach. |
| `upstream` | External dependency failure. GitHub / Polar / Resend 5xx, fetch failure. | `fetch failed`, `github 502` | Page on rate spike (>5%/10min) — usually means GitHub status is red. |
| `storage` | Own infra failure. D1 or KV. | `D1_TYPE_ERROR`, `KV_GET_MISSING` | Page immediately — own-infra outage. |

`classifyError` lives in each worker's `src/lib/observability.ts`. The classifier is heuristic and fall-back to `server` when it can't tell — so an unrecognised failure is always page-able by default.

## Sensitive-payload redaction

The structured logger walks every payload before emission and replaces values for these keys (case-insensitive, depth-limited to 4) with the literal string `[redacted]`:

### license-server denylist

`token`, `tokens`, `authorization`, `auth`, `cookie`, `signature`, `polarSignature`, `polar_signature`, `jwk`, `publicKeyJwk`, `privateKey`, `privateKeyJwk`, `secret`, `apiKey`, `api_key`, `password`, `webhookSecret`, `emailBody`, `email_body`, `htmlBody`, `textBody`.

### update-server denylist

`token`, `tokens`, `authorization`, `auth`, `cookie`, `signature`, `apiKey`, `api_key`, `password`, `githubToken`, `github_token`.

To extend the list when a new sensitive key surfaces:

1. Add the lowercase key to `SENSITIVE_KEYS` in the matching `observability.ts`.
2. Add a unit test for the new redaction in `test/observability.test.ts`.
3. Note the change here.

### What is NOT redacted (and why)

- **Email addresses** (`to`, `email`, `issued_to`) — operator correlation requires the lookup key. Privacy posture: emails are not sensitive at the same level as tokens; users provide them at purchase. If a future requirement says "redact emails too", flip the policy here, not at call sites.
- **Polar order ids** (`polarOrderId`) — public identifiers from Polar's webhook envelope; safe to log.
- **License ids** (`licenseId`) — internal D1 primary key; meaningless without D1 access.
- **Customer ids** (`customerId`) — Polar's identifier for the customer; safe to log.

## Health endpoint contract

Both workers expose two health surfaces:

### `GET /health` — liveness

Returns `{ ok: true, server, version }`. Always succeeds if the worker is reachable; never makes downstream calls. Use for synthetic uptime monitors.

### `GET /health/ready` — readiness

Returns `{ ok, server, version, degraded[], dependencies }` where `dependencies` is a map of `<dep-name>: 'ok' | 'degraded' | 'unknown'`.

- `ok: true` ⟺ `degraded` is empty.
- `ok: false` ⟺ `degraded` has at least one entry.
- HTTP status is **always 200** — a 5xx would prevent the synthetic monitor from reading the snapshot, which is the actual signal.
- Probe results cached 30s in worker memory so a fast-polling monitor (every 30s) doesn't pile up on the upstream services.

#### license-server dependencies

| Name | Probe | Timeout | Notes |
|---|---|---|---|
| `d1` | `SELECT 1 AS ok` against `env.DB` | 1s | Exercises the binding + the prepared-statement path. |
| `kv` | `env.RATE_LIMIT.get('__health_probe__')` | 1s | A null result is success; the probe is round-trip-only. |
| `polar` | HEAD `https://api.polar.sh/healthz` | 1s | Polar exposes a documented health endpoint. |
| `resend` | HEAD `https://api.resend.com/` | 1s | No public health endpoint; HEAD on root is the conventional reachability probe. |

#### update-server dependencies

| Name | Probe | Timeout | Notes |
|---|---|---|---|
| `github` | GET `https://api.github.com/zen` | 1.5s | `/zen` is unauthenticated and not rate-limited; one probe per 30s per isolate is well below GitHub's threshold. |

## Dashboards (target shape)

Operator-facing dashboards should pin to the structured-log surface above. Recommended panels:

### License-server dashboard

1. **Request rate by route** — stacked bar of `request.received` counts, grouped by `route`. 1m bins.
2. **Latency p50 / p95 / p99 by route** — derived from `request.completed.durationMs`, grouped by `route`. 1m bins.
3. **Error rate by class** — stacked bar of `request.completed` where `errorClass` is set, grouped by `errorClass`. 1m bins.
4. **Webhook request outcome** — `request.completed` where `route = 'webhooks.polar'`, grouped by `status` and `errorClass`.
5. **Recovery request outcome** — `request.completed` where `route` starts with `licenses.recover`, grouped by `status` and `errorClass`. Pair with the Resend dashboard for delivery success.
6. **Dependency health** — last value of `health.ready.dependencies.*` per dep.

### Update-server dashboard

1. **Request rate by route** — same as license-server.
2. **Latency p50 / p95 / p99 by route** — same.
3. **Update feed outcomes** — `request.completed` where `route = 'update.feed'`, grouped by `status` and `errorClass`.
4. **GitHub upstream 5xx rate** — `request.completed` where `route` starts with `update.` and `errorClass = 'upstream'`.
5. **Dependency health** — `health.ready.dependencies.github`.

## Alerts

| Severity | Condition | Action |
|---|---|---|
| **S0** | `errorClass: 'storage'` rate >0% over 5min on either server. | Page immediately. Own-infra outage; check D1 / KV bindings + Cloudflare status. |
| **S0** | `health.ready.degraded` includes `'d1'` for ≥3 consecutive probes. | Same as above — D1 is unreachable. |
| **S1** | `errorClass: 'server'` rate >1% over 5min. | Page. Bug in our code; pull recent commits + `wrangler tail`. |
| **S1** | `request.completed { route: 'webhooks.polar', errorClass: 'client' }` rate >0% over 1h. | Page. Likely Polar webhook secret drift or forged deliveries; cross-check Polar delivery status. |
| **S1** | Resend dashboard rejected / failed email rate >5% over 1h, or `licenses.recover.*` server/upstream errors >5% over 1h. | Page. Resend outage or address-deliverability issue. |
| **S2** | `errorClass: 'upstream'` rate >5% over 10min. | Notify (don't page). Usually means GitHub / Polar / Resend status page is red — see runbooks. |
| **S2** | `health.ready.degraded` includes any non-D1 dep for ≥3 consecutive probes. | Notify. Cross-check vendor status pages. |
| **S2** | Any `request.completed.durationMs` p95 doubles its 7-day baseline. | Notify. Latent regression or upstream slowdown. |

Alerting destination is **maintainer email** until a paging vendor (PagerDuty / OpsGenie) is selected. Wiring the alert source → vendor is a follow-up; the contract here is the threshold spec, not the wiring.

## Incident severity matrix

| Severity | User impact | Examples | SLA |
|---|---|---|---|
| **S0** | User-facing breakage. Activation, recovery, or auto-update fails for a meaningful cohort. | D1 outage, license-server 5xx storm, bad release shipped to auto-update. | Respond in 30 minutes; engaged until resolved. |
| **S1** | Degraded but workable. Some flow fails but the user can work around it (manual recovery, reload). | Polar webhook delays, Resend hard-bounce on a domain, intermittent license-server timeouts. | Respond in 4 hours; runbook-driven. |
| **S2** | Operationally noisy. No user impact today but the trend is bad. | GitHub API 5xx rate spike, p95 latency drift, cache hit rate drop. | Triage in 1 business day. |

## Rotation

There is no rotation today. Lingua is operated by a single maintainer; on-call coverage is the maintainer's available hours. The runbooks under `docs/runbooks/` are written so a future contractor / on-call hire can execute them with no in-person handoff.

When rotation expands, this section becomes the rotation source of truth and the alerting destination above flips from "maintainer email" to the oncall pager.

## Cross-references

- Runbooks: [`docs/runbooks/`](./runbooks/)
- Privacy posture (what we do / don't log): [`PRIVACY.md`](../PRIVACY.md)
- Release operator checklist: [`RELEASE.md`](../RELEASE.md)
- Public-release security sign-off: [`docs/RELEASE_SECURITY.md`](./RELEASE_SECURITY.md)
