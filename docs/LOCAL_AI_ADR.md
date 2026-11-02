# Local / hybrid AI — "Explain this error"  ADR

**Status:** Accepted (2026-07-03) — initial wiring shipped
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
   API key (their account, their data-processing terms); a server on
   `localhost` or `127.0.0.1` takes none. Default wire shape is
   the widely-supported **OpenAI-compatible `/chat/completions`** JSON, which
   also targets Anthropic (compat endpoint), local servers (Ollama, LM Studio,
   llama.cpp), and gateways. Lingua ships **no default key and no default
   hosted endpoint** — there is no "Lingua sends your code to Anthropic by
   default" path. This keeps our attack/liability surface minimal and honours
   the local-first brand.
2. **First feature: "Explain this error."** Smallest useful surface: when a run
   errors, an opt-in "Explain" action sends the *error message* + a *bounded
   code excerpt* + the language, and renders the explanation. No autocomplete,
   no whole-repo context, no agentic file access in the first version.
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
5. **Transport.** See § Modes and transport. No telemetry payload ever
   includes prompt content.

## Considered alternatives

- **Bundled hosted model (Lingua-keyed).** Rejected for the first version: it makes
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
- The always-mounted `AiExplainCodeHost` keeps only the shared request
  subscription and a localized loading/error shell at startup. The complete
  consent dialog, request builder, answer renderer, and provider client load
  after an explicit explain-code request; a failed chunk can retry on the next
  action.
- Settings → AI: a **Local · Ollama** / **My endpoint** mode control over two
  profiles (endpoint and model each; the key belongs to My endpoint only) in
  an isolated `lingua-ai` persist boundary, plus "Detect local AI (Ollama)",
  which fills the Local profile. The anchored panel shows the same control
  with the active model and host; a profile that is not filled in yet stays
  disabled and says what is missing.
- Error surfaces: notebook cells, SQL results, and HTTP failures open the
  consent dialog; the editor console and the failing line open the anchored
  panel (below). The answer renders as structured
  Markdown, supports streaming + follow-up questions, and offers Apply & re-run
  where the host surface can safely replace code behind a diff preview.
- Code tabs open the same consent flow in a panel anchored beside the editor
  (from the actions at the end of the failing line or the Console). The preview is still the exact
  payload. Its one addition is opt-in: **Include runtime values**, off by
  default, appends the paused locals or the last run's top-level variables as
  `name = value` lines, with secret-looking names (including initialisms and
  header names), secret-named fields nested inside a value, URL credentials
  and token-shaped values redacted (`formatRuntimeValues`), each value and the
  block capped, and the redacted count added to the notice. Once sent, the
  preview shows the payload that went out, which follow-ups re-send; the
  thread is bound to the endpoint it was approved for. The conversation lives
  in memory per tab and is never persisted; a Helpful / Not helpful vote stores
  the error's kind, the vote and its time in `lingua-explain-ratings`.
- SQL workspace: "Ask AI" sends only the live schema and typed question, then
  inserts the generated SQL for user review; it never auto-runs generated SQL.
- Labs › Palette autodetect sends a question typed in the command palette to
  the Explain this code consent dialog, with the tab's last run (Console output
  and error, redacted, capped) appended to the payload preview. Empty SQL
  queries offer starter prompts that only prefill Ask AI.
- Edit with AI (`src/shared/ai/editSelection.ts`, `EditWithAiDialog`) sends
  the file with the span to edit marked, only 60 lines around it once the
  file passes 12,000 characters. Redaction runs before the markers go in,
  on the text before, inside and after the span. If that differs from
  redacting the whole file, because a boundary splits a secret, the span widens
  to whole lines, then to the whole file. The answer's first fenced
  block replaces the span. Only on an explicit **Run preview**, JavaScript,
  TypeScript and Python run the file before and after the change through
  `runtime/aiEditPreview.ts` on a
  throwaway Worker or Pyodide, never Node, Deno or Bun, on the redacted file,
  with network requests blocked, no user env vars and a 5 s timeout. Nothing is applied until
  Accept, which is one undoable edit and refuses a stale model version or an
  answer that still holds `<redacted>`.

## Modes and transport

The mode is global and lives in `lingua-ai`; Settings and the panel change
it. Persisted v1 state migrates by host: a loopback endpoint becomes the
Local profile, any other host becomes My endpoint with its key.

| Mode | Desktop | Web |
| --- | --- | --- |
| Local · Ollama (loopback, no key) | Direct `fetch`; the renderer CSP allows `http://localhost:*` and `http://127.0.0.1:*` | Direct `fetch`; the same two origins are the only plain-http entries in the web CSP. The server must allow the Lingua origin (`OLLAMA_ORIGINS`) |
| My endpoint (HTTPS, key) | `http:execute` through the SSRF-guarded main proxy, private hosts blocked; no CORS and no renderer CSP room | Direct `fetch`, bound by the provider's CORS policy |

- **Streaming through main.** The renderer adapter
  (`src/renderer/runtime/aiProxyFetch.ts`) asks for SSE and opens the
  response as soon as main's progress reports an event-stream status; each
  progress update carries the whole body so far, coalesced to 100 ms, and the
  adapter feeds only the new suffix. Token-per-event streams raise the SSE
  message cap to 20 000 (validated in the IPC handler); main still caps the
  body at 4 MiB. A run cut at either cap is a `limit` failure.
- **Keys.** A server on this machine needs no key and gets no
  `Authorization` header. On desktop the key goes to main inside the request
  headers for that one run; main strips it on a cross-origin redirect.
- **Web loopback trade-off.** Allowing loopback lets page code reach other
  services on this machine too; they answer only when their CORS allows the
  Lingua origin. Any port is allowed because each server picks its own.
- `PRIVACY.md` / the privacy-trust Settings row should be kept aligned any
  time a new AI surface changes what payload can leave the device.

## Resolved decisions (2026-07-03 sign-off)

- **Provider default:** ✅ OpenAI-compatible `/chat/completions` is the baseline
  wire shape. A provider-native adapter (e.g. Anthropic messages API) can slot
  into the same client later without changing the request-builder core.
- **Web transport:** ✅ accept the CORS limitation. The feature ships on **both**
  web and desktop via `fetch`; on web it works only with CORS-enabled endpoints
  (documented; local servers often need a CORS flag). Desktop routes remote
  endpoints through the SSRF-guarded main proxy (§ Modes and transport).
- **Redaction strength:** **preview-only, no hard block** (implementer's call).
  Rationale: the payload **preview** is the real consent control — the user sees
  exactly what would leave the device and approves or cancels. Auto-redaction of
  obvious secrets stays as defense-in-depth, and the consent surface shows a
  visible "N secrets redacted" indicator so the user knows masking happened. A
  hard block on a secret heuristic is rejected: it adds false-positive friction
  (blocking legitimate sends) and false confidence (heuristics miss secrets),
  whereas showing the user the exact payload is both honest and unbounded by
  heuristic coverage.

## Response resource budgets

Every JSON and error body is read incrementally with a 2 MiB wire cap; SSE gets
16 MiB because each token carries a JSON envelope. SSE pending lines are capped
at 256 KiB; generated text at 256 KiB UTF-8. Those renderer budgets apply as
they stand to a direct `fetch` (web, and Local on desktop). On desktop, My
endpoint reaches the renderer through main, whose 4 MiB body cap and 20 000
SSE message cap apply first; either one ends the run as a `limit` failure.
The default inactivity deadline remains 60 seconds, with a separate five-minute
absolute ceiling that keepalives cannot extend. `[DONE]`, cancellation, and
budget failures close the reader; normal EOF remains compatible with local
providers. Streaming updates are coalesced to 50 ms plus first/final text.

A budget failure is a typed failure, not a successful truncated answer. The
EN/ES consumers do not retain partial output as an assistant turn or SQL to
insert. This does not change explicit consent, entitlement, or BYO transport.
