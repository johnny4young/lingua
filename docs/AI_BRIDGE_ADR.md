# ADR — AI bridge (v2.0)

| Status | Proposed |
| ------ | -------- |
| Decision | Three-tier AI access — **local Ollama-compatible**, **BYO key (OpenAI / Anthropic / Groq / OpenRouter)**, and **hosted credit pool** for paid tiers. Renderer never holds the secret; main process owns the keychain. |
| Date | 2026-04-26 |
| Revisit | When local-model size or quality crosses a threshold that makes BYO/hosted unnecessary, when a vendor lock-in case becomes attractive (e.g. Anthropic releases an exclusive Lingua-priced bundle), or when hosted-credit margin no longer covers the recurring spend at observed Monthly tier volume. |

## Context

Lingua v2.0 commits to AI features as the headline differentiator
(see [`PLAN.md` §16](./PLAN.md)). The bridge powers cross-language
port, test generation, error explanation, regex-from-English, mock
data generation, commit message authoring, and a dozen more features
brainstormed in [`BACKLOG.md`](./BACKLOG.md) §1.

The decision space is where the model runs, who pays for the tokens,
and where the credential lives:

- **Where it runs**: local CPU / GPU on the user's machine, or remote
  via an API.
- **Who pays**: the user (BYO key), Lingua (hosted-credit pool baked
  into Monthly), or both modes coexist.
- **Where the secret lives**: Electron main process keychain
  (Keychain on macOS, DPAPI on Windows, libsecret on Linux), the
  renderer's localStorage (insecure), or our license-server (we
  proxy on the user's behalf).

The competitive angle that makes Lingua interesting on AI is **privacy
and offline**. Cursor, Copilot, Replit-AI, Continue.dev — all assume
cloud connectivity and accept that telemetry of every prompt + every
file flows to the vendor. A meaningful slice of Lingua's audience —
educators, security-conscious devs, contractors under NDA, pilots /
spies / actually-confidential users — chooses tools specifically because
their code never leaves the machine. Local-first AI is the moat.

That said, local models are not yet good enough at every task, and
many users either do not have a 16GB+ machine or do not want to manage
local model downloads. So the bridge has to support remote inference
too. The question is how.

## Options considered

### Option A — Local-only

- Lingua bundles or installs a local Ollama-compatible runtime.
- All AI features run against `http://localhost:11434/api/...`.
- Zero recurring cost to either side. Maximum privacy.

Cons: local models in 2026 still trail GPT-4-class on cross-language
port, OCR-from-image, and long-context workflows. Bundling a 1-5 GB
model bloats install size by 10-50x. Users without dedicated GPUs
get a poor experience on the more demanding tasks.

### Option B — Cloud-only with BYO key

- User pastes their own OpenAI / Anthropic / Groq / OpenRouter key in
  Settings.
- Lingua sends prompts to the chosen vendor; vendor bills the user
  directly.
- No recurring cost to Lingua. Vendor lock-in is **per user**, not
  per Lingua.

Cons: forces every user to have an API account before they can use
AI features. Reduces conversion. Defeats the privacy argument when
Lingua is the cheapest path to AI for a casual user — they end up
sending prompts to a third party they would not have chosen otherwise.

### Option C — Cloud-only via Lingua's hosted credits

- Lingua resells tokens at a margin baked into Monthly.
- We proxy through one or more vendors via `licenses.linguacode.dev`
  (or a separate `ai.linguacode.dev`).
- Single subscription pays for everything.

Cons: kills Pro tier margin (recurring cost vs one-time payment).
Defeats the privacy promise (every prompt now flows through us). Adds
a SPOF: an outage at our proxy disables AI for every user. Capacity
planning becomes our problem.

### Option D — Hybrid: local + BYO + hosted, all three

- Local model is the default for Free + everyone with a capable
  machine.
- BYO key is an alternative for users who already pay for OpenAI / etc.
- Hosted credits are a Monthly add-on for users who want the
  managed experience.

Pros: every user gets an AI experience without forcing them onto our
bill. Pro users self-select to BYO or local without margin damage.
Privacy story still defensible because BYO and local are first-class.

Cons: more code to write than any single-mode design. Three sets of
error paths, three rate-limit policies, three credential surfaces.

### Option E — Plugin-only ("BYO bridge")

- Lingua does not ship AI features. Plugins do.
- Users install a plugin that wires AI calls.

Cons: pushes the moat to plugins instead of Lingua itself. Unclear
how the plugin SDK exposes long-running streams. Defers v2.0
positioning by 6+ months.

## Decision

**Option D — three-tier hybrid.** All three modes coexist, each
optional, with the renderer never seeing a credential.

### Modes

1. **Local (Ollama-compatible)**
   - Lingua does not bundle a model. We point the user at Ollama
     and provide a copy-paste install hint.
   - Default model recommendation: **Qwen2.5-Coder 7B Q4** (1.5 GB,
     CPU-only acceptable on a 16GB machine, GPU-accelerated on Apple
     Silicon and CUDA).
   - We support the Ollama HTTP API as the canonical local protocol.
     Other tools that emulate it (LM Studio, vLLM with the OpenAI
     adapter) work transparently because they share the wire format.
   - Configurable model + endpoint URL in Settings.

2. **BYO key**
   - User pastes an API key in Settings → AI → Provider.
   - Supported on first launch: OpenAI (gpt-4o-mini, gpt-4o),
     Anthropic (Claude 3.5/3.7 Sonnet, Haiku), Groq (Llama 3 70B,
     Mixtral), OpenRouter (proxy to anything).
   - Key stored in the OS keychain via main-process IPC (Keychain on
     macOS, DPAPI on Windows, libsecret on Linux). NEVER in
     localStorage. NEVER in the renderer.
   - Renderer asks main "run this prompt against the configured
     provider"; main reads the key from the keychain, calls the API,
     streams chunks back. Renderer never sees the key.

3. **Hosted credits** (Monthly only)
   - Lingua proxies through one or more vendors via a new
     `ai.linguacode.dev` Cloudflare Worker (sibling of
     `licenses.linguacode.dev`).
   - Users authenticate to the proxy with their license token; the
     proxy enforces a token quota tied to their tier and bills against
     a vendor account we hold.
   - Initial vendor: **OpenRouter** (single-vendor lock-in is
     reversible because OpenRouter abstracts the underlying provider).
     We swap to direct vendor accounts later if margin requires it.
   - Hosted access is Monthly only. Pro + Trial + Education + Free are
     explicitly excluded — same logic as the
     `LICENSING_ADR` Decision 3 pricing matrix: recurring cost demands
     recurring revenue.

### Tier-by-tier access matrix

| Tier | Local | BYO key | Hosted credits |
|---|:---:|:---:|:---:|
| Free | ✓ | ✓ | ✗ |
| Monthly | ✓ | ✓ | ✓ (1M tokens / mo, GPT-4o-mini class) |
| Pro | ✓ | ✓ | ✗ |
| Trial (14d) | ✓ | ✓ | ✗ |
| Education (1yr renewable) | ✓ | ✓ | ✗ |

This matrix folds back into [`PLAN.md` §16.5](./PLAN.md) and into the
revenue economics: hosted credits are the recurring spend that
justifies recurring revenue, and Pro preserves margin by
excluding hosted credits while still getting a great AI experience
through Local + BYO.

### Renderer surface

A single AI panel mounted as a side rail next to the editor (toggle
in toolbar; default off for Free, hint banner the first time a Pro
user opens a tab).

Provider chosen from a single Settings page. Model + endpoint
configurable per-provider. Token usage displayed in the License
section for Monthly users.

Per-feature surfaces (cross-language port, test gen, error explainer,
etc.) all use the same underlying `window.lingua.ai.complete(prompt,
options)` IPC bridge. Adding new AI features = wiring a button +
prompt template to the existing channel.

### Server surface

`ai.linguacode.dev` Cloudflare Worker:

- `POST /completions` — proxies to OpenRouter or direct vendor based
  on env config; enforces token quota per license; returns SSE
  stream.
- `GET /usage?token=<license>` — returns remaining hosted credits for
  the month (used by the License surface).
- `GET /health` — liveness.

D1 schema gains an `ai_usage` table tracking `(license_id, month,
tokens_used)` with a monthly grain. Reset cron: first of month UTC.

The Worker shares the license-server's token-verification pathway:
it does not need to call the license-server endpoint, because the
license token itself carries `tier` and `expires_at` signed by us.

## Consequences

### What this enables

- A user with no API account can paste a Monthly token and get
  cloud-quality AI for the recurring subscription cost they
  already pay.
- A user with a 16GB+ machine can disable cloud entirely and run
  everything locally.
- A power user with their own OpenAI bill can BYO key and pay
  vendor-direct with zero markup.
- Lingua's privacy story stays defensible: local-first is real, and
  even cloud-routed users see exactly what we send (the renderer
  shows the prompt; the proxy is auditable).

### What this commits us to

- A new sibling Cloudflare Worker (`ai-server/` or `ai.linguacode.dev`)
  with proxy logic, quota enforcement, and SSE streaming.
- A keychain integration in main-process (`src/main/aiKeystore.ts`)
  using `keytar` or platform-native APIs.
- A renderer AI panel + IPC bridge (`window.lingua.ai.*`) parallel to
  `window.lingua.license.*`.
- A `Settings → AI` section with provider + model + endpoint
  configuration.
- An `ai_usage` D1 table on the licensing worker (or the new ai
  worker — TBD when the slice graduates).
- Recurring vendor cost: OpenRouter or direct OpenAI / Anthropic
  invoices. Monthly subscription has to gross enough to cover
  the average user's hosted-credit consumption + 30-50% margin.

### Failure modes considered

- **Local model unavailable** (Ollama not installed) — feature panel
  shows install hint; AI buttons gracefully disable with a translated
  notice. No silent fallback to cloud (would defeat the privacy promise).
- **BYO key revoked or invalid** — surfaces vendor's 401 verbatim
  with a translated wrapper.
- **Hosted credits exhausted** — proxy returns
  `{ ok: false, reason: 'quota-exceeded', resetsAt }`. Renderer shows
  remaining-budget pill + suggested upgrade flow.
- **Proxy down** — Monthly user with hosted credits sees an
  outage notice with an "use BYO instead" button that opens the
  Settings page.
- **Vendor outage** (OpenRouter down) — proxy fails over to a
  configured backup vendor where one is set; if not set, returns
  `{ ok: false, reason: 'vendor-unavailable' }`.

### Why not Stripe-Stripe-credits-direct (paying per-prompt at vendor cost)

Considered: forward the user's prompt to OpenAI directly, charge them
per-token through Stripe at our cost + 5% margin. Rejected because:

- Per-call billing adds latency (we have to hit Stripe before each
  prompt or batch).
- User experience is worse: every prompt feels like spending money.
- Refund / dispute surface is huge.
- Tax handling is nightmare. Polar's MoR (per `LICENSING_ADR`) does
  not cover per-call API resale cleanly.

A monthly hosted-credit cap with a clear "you have N tokens left this
month" pill is a much smoother UX and a much simpler accounting
surface.

### Why not bundle a model in the installer

Considered. Rejected because:

- 1.5 GB minimum bumps installer from ~150 MB to ~1.7 GB. Bandwidth
  cost on every download (we host on GitHub Releases — no free CDN
  margin).
- Updates: model improvements are slower-paced than Lingua releases.
  Bundling a year-old model and only refreshing on app updates means
  users with a managed Ollama install have a better experience than
  bundled.
- Licensing: many local models have non-commercial restrictions
  (Llama 2 Community License, Mistral non-commercial). Bundling
  forces us to vet every model legally.

We point users at Ollama instead. Setup friction is lower than it
seems — Ollama has a one-line install + first-run model pull.

## Slice sequencing (when this graduates from BACKLOG to ROADMAP)

`RL-NNN` will materialize on graduation. Internally the slice plan is:

1. **Slice A — IPC scaffold + provider registry** (no real calls).
   Adds `window.lingua.ai.*` to preload, the AI Settings panel
   skeleton, the keychain integration in main, and the provider
   registry that maps `provider → endpoint + auth scheme`.
2. **Slice B — Local + BYO client implementations**. Stream
   completions from Ollama (local) and from OpenAI / Anthropic
   (BYO). No hosted credits yet.
3. **Slice C — Hosted credit proxy**. New `ai-server/` Cloudflare
   Worker, D1 `ai_usage` table, license-token quota enforcement,
   monthly reset cron.
4. **Slice D — First five AI features**. Cross-language port, test
   gen, error explainer, regex-from-English, mock data generator —
   all wiring against the existing `complete()` bridge.
5. **Slice E — Tier-aware UI**. Settings → License surfaces
   remaining hosted credits; AI panel disables cleanly per tier.
6. **Slice F+** — additional AI features (commit message,
   docstring, variable rename, perf coach) — each a small
   subsequent slice.

## Maintainer-side prerequisites (out of agent scope)

These pieces are outside what an implementation agent provisions
locally and unblock end-to-end smoke for Slice C onwards:

- Choose primary vendor (OpenRouter recommended).
- Sign up for vendor account, fund $X startup credit.
- DNS: `ai.linguacode.dev` as a Cloudflare Workers route + custom domain.
- Provision a second D1 binding (or reuse `lingua-licenses` —
  decided when Slice C graduates).
- Set Cloudflare secrets:
  - `AI_VENDOR_API_KEY` (OpenRouter or direct vendor)
  - Cron schedule for monthly quota reset
- Decide hosted-credit allotment per Monthly tier (1M tokens
  GPT-4o-mini equivalent is the placeholder; tune after observed
  consumption data).
- Update the marketing site pricing page with AI-feature copy once
  Slice D ships.

## References

- [`PLAN.md` §16](./PLAN.md) — v2.0 strategic roadmap that frames this
  decision.
- [`LICENSING_ADR.md`](./LICENSING_ADR.md) — the licensing
  architecture this bridge plugs into for tier gating.
- [`BACKLOG.md` §1](./BACKLOG.md) — the 14 AI features tagged `[ai]`
  that this bridge enables.
