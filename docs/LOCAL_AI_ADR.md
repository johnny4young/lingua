# Local / hybrid AI — "Explain this error"  ADR

**Status:** Accepted (2026-07-03) — initial implementation wiring shipped
**Roadmap item:** implementation / internal (Tier 4)
**Reserved entitlement:** `LOCAL_AI` (already in `src/shared/entitlements.ts`)

## Why this needs a decision (not just code)

Every prior Lingua capability runs **on the device** — code executes in a
sandboxed worker or a local subprocess, licenses verify locally, and the
privacy story ("your code never leaves your machine") is a brand pillar. AI
assistance is the first feature that can send **user source + error text to a
third party**. That is a product/privacy decision, so this ADR captures the
proposed model for sign-off; the pure request-building core ships now (no
network), and the provider client + UI are gated on approval.

The governing constraint is the existing **"no silent network call"**
principle: nothing may reach the wire without an explicit, per-invocation user
action and a preview of exactly what is sent.

## Proposed decision

1. **BYO-API-key, provider-agnostic.** The user supplies their own endpoint +
   API key (their account, their data-processing terms). Default wire shape is
   the widely-supported **OpenAI-compatible `/chat/completions`** JSON, which
   also targets Anthropic (compat endpoint), local servers (Ollama, LM Studio,
   llama.cpp), and gateways. Lingua ships **no default key and no default
   hosted endpoint** — there is no "Lingua sends your code to Anthropic by
   default" path. This keeps our attack/liability surface minimal and honours
   the local-first brand.
2. **First feature: "Explain this error."** Smallest useful surface: when a run
   errors, an opt-in "Explain" action sends the *error message* + a *bounded
   code excerpt* + the language, and renders the explanation. No autocomplete,
   no whole-repo context, no agentic file access in implementation.
3. **Strict consent, every time.**
   - The action is **explicit** (a button on the error surface). Nothing is
     ever sent automatically, on a timer, or in the background.
   - Before the first send (and available on every send) the user sees a
     **preview of the exact payload** that will leave the device.
   - Obvious secrets in the code excerpt are **redacted before preview**
     (string literals assigned to secret-looking identifiers via the existing
     `looksSecret` heuristic, plus token-shaped values like `sk-…`). Redaction
     is defense-in-depth; the preview is the real control.
   - The API key is stored **locally only** (Settings), never written to run
     capsules, share links, telemetry, or logs — same posture as HTTP
     workspace secrets.
4. **Entitlement-gated.** `LOCAL_AI` is a paid entitlement; the UI is hidden /
   upsells on free, consistent with the free-vs-paid model.
5. **Transport.** On desktop the request can ride the internal implementation SSRF-guarded
   main proxy (arbitrary user endpoint, no CORS). On web it uses `fetch` and is
   subject to the provider's CORS policy (documented limitation; local servers
   often need a CORS flag). No telemetry payload ever includes prompt content.

## Considered alternatives

- **Bundled hosted model (Lingua-keyed).** Rejected for implementation: it makes
  Lingua the data processor for users' source, contradicts the local-first
  brand, and adds cost + liability. Can be a *later, clearly-labelled* opt-in.
- **On-device model (transformers.js / Ollama-in-app).** Attractive for the
  "no network at all" story but heavy (model download, RAM) and lower quality
  for error explanation. BYO-key reaches usefulness first; a local-model
  provider slots into the same provider-agnostic client later.
- **Silent/auto "explain on every error."** Rejected outright — violates the
  no-silent-network principle.

## implemented scope

- `src/shared/ai/explainError.ts`:
  - `redactSecretsFromCode(code)` — mask secret-looking assignments + token
    values before anything is previewed or sent.
  - `buildExplainErrorRequest(input)` — build the provider-agnostic
    `{ messages }` request AND the human-readable **preview** of exactly what
    would be sent (the consent surface consumes this). Pure; performs no I/O.
- `src/renderer/runtime/aiClient.ts`: POST to the configured OpenAI-compatible
  endpoint, parse JSON or streaming SSE responses, enforce a timeout, and
  return typed failure envelopes without ever echoing the API key.
- Settings → AI: endpoint + key + model entry in an isolated `lingua-ai`
  persist boundary, plus "Detect local AI (Ollama)" for loopback servers.
- Error surfaces: notebook cells, the editor console, SQL results, and HTTP
  failures can open the consent dialog. The answer renders as structured
  Markdown, supports streaming + follow-up questions, and offers Apply & re-run
  where the host surface can safely replace code behind a diff preview.
- SQL workspace: "Ask AI" sends only the live schema and typed question, then
  inserts the generated SQL for user review; it never auto-runs generated SQL.

## Follow-up transport work

- Desktop currently allows loopback local AI servers directly from the
  renderer CSP. Remote desktop endpoints should move through the internal implementation
  SSRF-guarded main proxy before they are enabled broadly.
- The web build keeps the documented CORS limitation: remote HTTPS providers
  work only when their CORS policy allows the Lingua origin, while production
  web blocks plain-http localhost.
- `PRIVACY.md` / the privacy-trust Settings row should be kept aligned any
  time a new AI surface changes what payload can leave the device.

## Resolved decisions (2026-07-03 sign-off)

- **Provider default:** ✅ OpenAI-compatible `/chat/completions` is the baseline
  wire shape. A provider-native adapter (e.g. Anthropic messages API) can slot
  into the same client later without changing the request-builder core.
- **Web transport:** ✅ accept the CORS limitation. The feature ships on **both**
  web and desktop via `fetch`; on web it works only with CORS-enabled endpoints
  (documented; local servers often need a CORS flag). Desktop can later route
  through the internal implementation SSRF-guarded main proxy once that transport seam is
  wired to the renderer — a follow-up, not a blocker.
- **Redaction strength:** **preview-only, no hard block** (implementer's call).
  Rationale: the payload **preview** is the real consent control — the user sees
  exactly what would leave the device and approves or cancels. Auto-redaction of
  obvious secrets stays as defense-in-depth, and the consent surface shows a
  visible "N secrets redacted" indicator so the user knows masking happened. A
  hard block on a secret heuristic is rejected: it adds false-positive friction
  (blocking legitimate sends) and false confidence (heuristics miss secrets),
  whereas showing the user the exact payload is both honest and unbounded by
  heuristic coverage.
