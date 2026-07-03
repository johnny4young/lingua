# Local / hybrid AI — "Explain this error" (T19) ADR

**Status:** Proposed — product decision required before wiring network egress
**Roadmap item:** T19 / RL-031 (Tier 4)
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
   no whole-repo context, no agentic file access in slice 1.
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
5. **Transport.** On desktop the request can ride the RL-097 T7 SSRF-guarded
   main proxy (arbitrary user endpoint, no CORS). On web it uses `fetch` and is
   subject to the provider's CORS policy (documented limitation; local servers
   often need a CORS flag). No telemetry payload ever includes prompt content.

## Considered alternatives

- **Bundled hosted model (Lingua-keyed).** Rejected for slice 1: it makes
  Lingua the data processor for users' source, contradicts the local-first
  brand, and adds cost + liability. Can be a *later, clearly-labelled* opt-in.
- **On-device model (transformers.js / Ollama-in-app).** Attractive for the
  "no network at all" story but heavy (model download, RAM) and lower quality
  for error explanation. BYO-key reaches usefulness first; a local-model
  provider slots into the same provider-agnostic client later.
- **Silent/auto "explain on every error."** Rejected outright — violates the
  no-silent-network principle.

## This slice (ships now, no network)

- `src/shared/ai/explainError.ts`:
  - `redactSecretsFromCode(code)` — mask secret-looking assignments + token
    values before anything is previewed or sent.
  - `buildExplainErrorRequest(input)` — build the provider-agnostic
    `{ messages }` request AND the human-readable **preview** of exactly what
    would be sent (the consent surface consumes this). Pure; performs no I/O.
- Unit tests for redaction + request/preview construction.

## Following slices (gated on approval of this ADR)

1. Provider client: POST the request to the user endpoint (desktop via T7
   proxy; web via `fetch`), stream/parse the completion. Never throws; typed
   failure envelope like `httpClient.ts`.
2. Settings → AI: endpoint + key entry (local-only storage), model field, a
   "test connection" affordance.
3. Error-surface "Explain" button + the consent preview modal + the result
   panel; i18n (en/es); `LOCAL_AI` gating + upsell.
4. `PRIVACY.md` / privacy-trust Settings row updated to describe exactly what
   the AI feature sends and when.

## Open questions for sign-off

- **Provider default:** OpenAI-compatible chat as the baseline wire shape — OK?
  Any provider you want first-class (Anthropic-native messages API) beyond the
  compat path?
- **Web transport:** accept the CORS limitation on web (feature effectively
  desktop-first, web works only with CORS-enabled endpoints), or make it
  desktop-only in slice 1?
- **Redaction strength:** preview-only (user decides) vs. also hard-blocking a
  send when a high-confidence secret is detected?
