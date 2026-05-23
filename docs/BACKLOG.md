# Lingua — Backlog

> Raw capture for work that **is not yet a commitment**. Anything here
> has no acceptance criteria, no priority, or no sized scope. It is
> the buffer between "somebody had an idea" and the formal engineering
> backlog in [`docs/ROADMAP.md`](./ROADMAP.md) §4.
>
> **Promotion flow**: when an item here matures — acceptance criteria
> clear, scope sized, priority agreed — move it to `ROADMAP.md` §4 as
> a new `RL-NNN` row with `Status: Planned`, and delete it from here.
> That is the single migration direction. Items do not demote back.
>
> **What does NOT belong here**: work that already has acceptance
> criteria (that's a ROADMAP `RL-NNN` ticket), shipped work (stays in
> ROADMAP §6 archive or inside its `Partial` row's `Readiness` field),
> or deferred tickets (they keep their row in ROADMAP with the
> `Deferred study` / `Research-backed spike` / `Superseded` status).

## Conventions

- One bullet per item. Keep it short; if it needs more than two lines,
  it is already mature enough to graduate to ROADMAP as a new `RL-NNN`.
- Tag items with `[domain]` so the list is scannable. Common tags for
  Lingua: `[editor]`, `[runtime]`, `[ui]`, `[devutils]`, `[licensing]`,
  `[i18n]`, `[perf]`, `[docs]`, `[infra]`, `[bug]`, `[research]`.
- Dated captures welcome (`— 2026-04-22 (jy)`) so decay is visible.
- When you promote an item to ROADMAP, **delete the bullet here** in
  the same commit. Do not leave stale duplicates — git history is the
  audit trail.

## 1. Ideas without acceptance criteria

Product / strategic ideas that have not been sized. A human decides
whether they graduate to ROADMAP, die here, or stay pending more
research.

- ~~[research] World-class candidate packet (WC-001..WC-010)~~ — PROMOTED 2026-05-20 to `RL-094` .. `RL-107` (14 new rows) + 4 extensions (RL-024, RL-031, RL-039, RL-050) + `docs/ANTI_FEATURES.md`. See `docs/WORLD_CLASS_TO_RL_PROPOSAL.md` for the mapping rationale and `docs/WORLD_CLASS_TICKETS.md` for the quick-reference index. Implementation order in `docs/ROADMAP.md` §5 slots 9-26.
- [security] [ux] `// @origin off` / `# @origin off` directive (RL-044 Sub-slice G Fold F) matches anywhere in the buffer, including inside string literals (`console.log("// @origin off")` silently suppresses the chip). Privacy-safe (over-suppress) but surprises users. Open question: tokenise the buffer (acorn / Babel AST) for string-literal-aware detection, or document the limitation in Settings + the Fold F directive description and leave the regex as is. AC still TBD. — 2026-05-22 (jy)
- [infra] Auto-update staging channel. Public readiness audit (2026-05-07) added the repo-side pieces: `GITHUB_RELEASE_CHANNEL=draft` for isolated update-worker deployments, `npm run check:update-feed`, and `docs/runbooks/desktop-update-draft-validation.md`. Remaining launch work is operational provisioning: create the staging route, decide who can trigger it, and run the first signed macOS/Windows candidate through the full install/update/rollback path. AC still TBD. — 2026-05-07 (jy)
- [infra] Signed macOS public release readiness. Use `docs/MACOS_SIGNING.md` to configure Developer ID signing/notarization secrets, then validate release workflow signing, packaged smoke, and a real update cycle before macOS artifacts leave draft. AC still TBD. — 2026-05-07 (jy)
- [infra] Signed Windows public release readiness. Use `docs/WINDOWS_SIGNING.md` to choose the Authenticode strategy, configure `WIN_CERT_FILE` / `WIN_CERT_PASSWORD` or promote a provider-specific signing slice, verify Squirrel installer signing, and run update smoke on a Windows VM before public Windows release. AC still TBD. — 2026-05-07 (jy)
- [security] Scheduled public-release secret/security audit. Promote when repo visibility changes: run full-history Gitleaks, dependency audit triage, release-security checklist artifact, and public docs claim review on a recurring cadence. AC still TBD. — 2026-05-07 (jy)
- [perf] Startup and memory-leak launch budget thresholds. RL-086 now records launcher-to-smoke-ready, first editor interaction, first JS/TS/Python run, and memory deltas in `runtimeObservability`; the remaining work is setting release thresholds after a few stable smoke runs establish normal variance. AC still TBD. — 2026-05-07 (jy)
- [infra] Pro-tier UI smoke harness for web preview MCP. RL-028 Slice 7 (compare two runs) discovered that synthetic clicks on the toolbar Settings opener don't bubble through Headless UI's portal under the Claude Preview MCP, so the License paste flow can't be exercised programmatically — every Pro-gated slice ends up trusting component tests for the unlocked path. Goal: add a dev-only hook (e.g. `window.__LINGUA_DEV__.applyLicenseToken(token)` exposed only when `import.meta.env.MODE === 'development'`) that calls `useLicenseStore.getState().setLicenseToken(token)` directly, so the smoke pass can paste the `dev:web:pro` token without fighting the modal. Belt-and-braces: gate the hook behind a build-time `LINGUA_DEV_LICENSE_HOOK=1` env var so production bundles can never expose it. ~1h. AC still TBD. — 2026-05-01 (jy)
- [ui] Mobile (<768px) responsive del shell — fuera de scope cuando se arregló el `pl-[70px]` de Toolbar en web (slice tablet+desktop, 2026-04-30). Lo que NO funciona hoy en mobile: el toolbar trunca "+ New JavaScript" sin afford de icon-only, el tab bar de `SettingsModal` no scrollea (5 tabs aprietan en 375px), `AppLayout` `minSize={320}/{220}` en px crea overflow horizontal en <540px, `KeyboardShortcutsModal` `ShortcutRow` `flex justify-between` no envuelve. Si en algún momento se decide soportar mobile, los top-5 ofensores ya están scopeados — mirar las screenshots `10-mobile-375-empty-state.png` / `11-mobile-375-shell.png` (en `git status` antes del slice). Sin AC. — 2026-04-30 (jy)
- [infra] Auto-trigger the release pipeline on `push: tags: [v*]`. Decision 6 contemplates a tag push as the release trigger but Slice 5 kept `workflow_dispatch` only — an accidental tag push must not ship a bad desktop build. Promote when desktop E2E tests are robust enough to validate a build before publish (currently `npm run smoke:desktop` only covers boot, not full feature parity). Estimation: ~1h of YAML once the precondition tests are in place. — 2026-04-30 (jy)
- [marketing] Crear repo `lingua-marketing` (Astro + Tailwind + MDX) y configurar `linguacode.dev` como custom domain (HIGH PRIORITY). Repo público separado para el marketing site. Secciones: Home, Features, Pricing, Docs, "Go to app" (link a `app.linguacode.dev`). Stack: Astro (SSG con buen SEO, MDX para feature pages), Tailwind compartiendo design tokens con la app, deploy a CF Pages con custom domain `linguacode.dev`. Beneficios de repo público: GH Actions ilimitado, código indexable por Google, ciclos de deploy independientes del producto. Alternativa: Next.js con `output: 'export'`. Estimación: 8-12h para v1 con copywriting básico. Re-define el scope de `RL-063` (Download landing page) y `RL-032` (Marketing website + docs hub) — ambos tickets se redirigen al nuevo repo. — 2026-04-30 (jy)
- [licensing] Trial email verification (magic-link). Phase 1 of RL-061 ships without it; promote when observed abuse exceeds ~5% of trial volume. Schema + `/trials/start` already supports a follow-up flow. — 2026-04-25 (jy)
- [licensing] Slice 3b — device rename UI + `/licenses/devices/rename` worker endpoint. RL-061 Slice 3 shipped per-row Remove on web Settings → License but rename was deferred because the worker has no rename handler today (`license-server/src/handlers/licenses.ts` only exposes activate / status / remove). Adding rename means a new POST endpoint with token auth, an UPDATE on the `devices.device_name` column, the matching `licenseServer.ts` wrapper, and an inline-edit affordance in `DeviceList`. AC still TBD. — 2026-04-28 (jy)
- [testing] Playwright-Electron harness for desktop renderer specs. Slice 3.5 deferred its end-to-end e2e because no harness exists today — `playwright.license-web.config.mts` is web-only, the existing specs run against the Vite preview, and `smoke:desktop` is a custom child-process launcher (not Playwright). Closing the gap means a separate Playwright project that uses `_electron.launch()`, mocks the `/licenses/*` routes via `session.webRequest` or a localhost stub, asserts the renderer-side state through `window.evaluate`, and ships a new `npm run test:e2e:desktop` script. ~3-4h of pure infra before the first assertion. AC still TBD. — 2026-04-29 (jy)
- [infra] Audit every consumer of `import.meta.env.VITE_*` and build-time `process.env.LINGUA_*` for the envDir / loadEnv coupling. RL-061 Slice 3 surfaced two latent gaps in the desktop build (renderer config missing `envDir`, main config missing `loadEnv` in its function form) that mirrored Slice 2.5's web fix. Goal: `grep -rn "import\\.meta\\.env\\.VITE_\\|process\\.env\\.LINGUA_" src/ build/` and confirm every consumer is reachable from a packaged `make:desktop` build, not just `dev:desktop:*` (the dev launchers inject vars via process.env and mask both gaps). Output: a checklist in `AGENTS.md` cross-referencing each var and the build path that loads it. — 2026-04-29 (jy)
- [security] RL-061 license-server threat-model audit + LICENSING_ADR § Threat model section. The 2026-04-29 audit before Slice 4a confirmed the cryptographic floor (Ed25519 unforgeable without prod private key, renderer cannot accept unsigned tokens, signature gate fires before any D1 lookup so unknown-license cannot leak via timing) and surfaced three actionable items worth tracking. Goal: append a `## Threat model` block to `docs/LICENSING_ADR.md` capturing (a) what the design tolerates by intent — token reuse cross-device when leaked, trial abuse via IP rotation per Decision 5 — and (b) the catastrophic single points of failure (`LINGUA_LICENSE_PRIVATE_KEY_JWK` and `POLAR_WEBHOOK_SECRET` rotation runbooks). AC still TBD. — 2026-04-29 (jy)
- [security] Device-cap race in `POST /licenses/activate` (`license-server/src/handlers/licenses.ts:71-115`). The activate handler reads `countActiveDevices` then `INSERT`s without a SELECT-then-INSERT atomic guarantee. D1 / SQLite has no row-level lock and each `prepare().run()` is its own transaction, so two concurrent activates from different `device_id`s against the same `license_id` can both pass `activeCount < device_limit` before either INSERT lands and end up with `device_limit + 1` active devices on the surface. Severity: medium-low — exploitable race window is tens of ms, the gain is +1-2 devices on a license the attacker already legitimately holds (no license creation, no cross-license bypass), and the legitimate user can `removeDevice` to recover the slot. Fix candidates: (1) slot-based UNIQUE — add `slot_index INTEGER` column with `UNIQUE(license_id, surface, slot_index)`, activate tries `INSERT (slot=0..limit-1)` and the first wins, atomic per SQLite; (2) post-INSERT validation — count after insert, if `> limit` rollback the just-inserted row; (3) Durable Objects to serialize per-license writes. AC still TBD; option (1) is the lightest. — 2026-04-29 (jy)
- [security] CF Workers logging policy for `/licenses/*` and `/trials/start` response bodies. Slice 4a's `/trials/start` will return the freshly-minted token in the response body when Resend email send fails (best-effort fallback so the user does not get stranded waiting for an email that will never arrive). If CF Workers Logs / Logpush is configured to capture response bodies, that token persists in observability storage with a 14-day Pro entitlement. Goal: confirm `wrangler.toml` and the CF dashboard logging settings exclude response bodies for `/licenses/*` and `/trials/*`, document the constraint in `LICENSING_ADR.md`, and add a CI check that `console.log` of token-bearing payloads is forbidden under `license-server/src/handlers/`. AC still TBD. — 2026-04-29 (jy)
- [security] Rate-limiter PoP-race bypass on Workers KV. Slice 4a's `/trials/start` rate limit (3 trials/IP/day, KV-backed) is eventually consistent across CF PoPs (~60s sync window). An attacker hitting four PoPs simultaneously can pass 4 trials before the counter syncs. Severity: low — gain is +1-3 trials over the cap, no license-creation primitive, and the schema-level UNIQUE(email)/UNIQUE(device_id) constraints still bound the abuse. Fix candidates: (1) accept the bypass (Phase 2 magic-link verification mitigates the underlying abuse vector); (2) move to Durable Objects for strongly-consistent counters; (3) add a secondary `INSERT INTO trials_attempts (ip, day) UNIQUE` race — but trades KV for D1 write amplification. AC still TBD. — 2026-04-29 (jy)
- [licensing] GitHub Education API integration to replace the static `.edu` allow-list in `license-server/src/lib/educationEmail.ts`. Slice 4 ships an explicit list of educational TLDs (`edu`, `ac.uk`, `edu.mx`, `edu.au`, `edu.ca`, `edu.br`, `ac.in`); a real OAuth flow against `api.github.com/user/education` would give us a stronger signal (proof of educational enrolment) and let us approve students at non-`.edu` institutions (e.g. private universities with `.com` domains). Non-trivial: needs a callback endpoint, GH OAuth app registration, refresh-token storage, and a fallback for users without a GH account. AC still TBD. — 2026-04-29 (jy)
- [devutils] Dev-only `GET /preview-email` endpoint for visual review of the six RL-061 Slice 4 HTML email templates without sending a real email. Slice 4's snapshot tests + opening the `.html` file directly cover the verify-and-test story for now, but a maintainer wanting to iterate on copy + styling can be served better by a worker route that renders against fixture vars and returns the full HTML. Gated to `dev` env only via a wrangler.toml var. AC still TBD. — 2026-04-29 (jy)
- [licensing] Desktop main-side stale-token auto-pickup. RL-061 Slice 4 added the renderer-side flow on web (when `setLicenseToken` / `revalidate` finds a locally-expired-but-signature-valid token, attempt `/licenses/status` and silently swap if the server has a `refreshedToken`). The desktop main bridge has its own `setLicenseToken` flow in `src/main/license.ts` that drops out on `local:expired`; closing the gap means adding the same `attemptStaleTokenRefresh` helper in `src/main/license.ts`, exposing it through the IPC bridge, and wiring the renderer's desktop `licenseStore` branch to receive a `recoverHint` from the main snapshot. ~1-2h. AC still TBD. — 2026-04-29 (jy)
- [testing] Web e2e perf — make targeted validation `<10 min`. Today `npm run test:e2e:web` runs the full 98-test suite serially (~25-30 min wall clock) and `--grep` filtering fails in isolation because tests depend on implicit shared state across parallel workers (tour-dismissed-by-test-N, license-stored-by-test-M, ...). Surfaced 2026-05-21 during RL-095 Slice 1: corrí full suite 3 veces (~75 min total) when 2 runs of `--grep "Settings — structural"` should have sufficed but failed. Goal: a senior dev validating a one-surface slice should not wait >10 min for e2e signal. Vectors ranked by leverage: **(1) Test isolation** — audit shared state, migrate to explicit Playwright `storageState` per test, guarantee `--grep` works standalone (4-6h, unblocks the rest). **(2) Parallel workers** — once isolated, set `workers: '50%'` in playwright config; 98 tests × 12s / 4 workers ≈ 6 min (30 min, low risk once 1 lands). **(3) Sharding by area** — free with 1; `--grep "Settings"` runs the 5 settings tests in ~1 min. **(4) Pyodide/browser fixture caching** — `beforeAll` warms Pyodide WASM + browser context, `beforeEach` resets storage only; saves ~20s of cold-start per slow test (2-3h). **(5) Demote e2e → component tests where possible** — audit which of the 98 actually need a real browser vs Vitest+RTL; demoted tests run in ms (1-2h audit + N hours migration). Promote when next slice touches a renderer surface and the iteration cost exceeds ~30 min; estimation `~1 day` to hit <10 min for slice-scope validation. AC still TBD. — 2026-05-21 (jy)
- [infra] Desktop release pipeline (macOS / Windows / Linux) end-to-end. Surfaced when the first full release of `RL-061` Slice 5 (`v0.2.3`, run `#6`) tried to build all three platforms and every job failed in a different place. Three independent sub-issues with very different cost profiles, recommended priority **MEDIUM-HIGH** because the web build is shipping today and unblocks Free/Trial/Education users, while desktop installers gate the paid Pro/Team experience promised by `LICENSING_ADR.md` Decision 3. Sub-issues: **(a) macOS signing — `Validate macOS signing inputs` step fails fast** with "Missing required macOS release secrets: APPLE_ID APPLE_ID_PASSWORD APPLE_TEAM_ID APPLE_SIGNING_IDENTITY APPLE_CERT_P12_BASE64 APPLE_CERT_PASSWORD". Requires Apple Developer Program enrollment ($99/yr), a Developer ID Application certificate exported as `.p12` + base64-encoded for `APPLE_CERT_P12_BASE64`, and an app-specific password for notarization (`APPLE_ID_PASSWORD`). Until the certs land, the macOS job will keep failing fast (~17s) without burning many minutes; the pre-flight is doing its job. **(b) Windows signing — `Validate Windows signing inputs` step fails** with "Missing required Windows release secrets: WIN_CERT_FILE WIN_CERT_PASSWORD". Requires an OV code-signing cert (~$200/yr from Sectigo/DigiCert) or EV (~$300-500/yr; SmartScreen reputation is faster with EV). Same fail-fast pattern as macOS (~1m 13s — the npm ci runs before validation, hence longer). **(c) Linux artifacts — different failure**: build steps pass green but `Verify Linux artifacts` reports `find: 'out/make': No such file or directory`. Root cause is most likely missing makers in `forge.config.ts` for Linux (`@electron-forge/maker-deb`, `@electron-forge/maker-rpm`, eventually AppImage). Linux does NOT need signing certs (unsigned distribution is fine for OSS / source-available licensing) so this sub-issue is the cheapest to close — pure config + maker deps install. Recommendation: ship Linux first (~2-4h, no money), file macOS + Windows as separate sub-tickets gated on Apple Developer enrollment + cert procurement (business decision). AC still TBD. — 2026-04-30 (jy)

### v2.0 strategic roadmap entries (see [`PLAN.md` §16](./PLAN.md))

Captured 2026-04-26 in one batch. AC still TBD; each graduates to ROADMAP `RL-NNN` only when sized.

#### AI features (Pillar 1) — all enabled by [`AI_BRIDGE_ADR.md`](./AI_BRIDGE_ADR.md)

- [ai] AI bridge IPC scaffold + provider registry. `window.lingua.ai.complete()` channel, keychain integration via main, AI Settings panel skeleton with provider + model + endpoint configuration. Slice A of the AI bridge. **Headline feature for v2.0.** — 2026-04-26 (jy)
- [ai] Local + BYO completions: Ollama-compatible local + OpenAI / Anthropic / Groq / OpenRouter via BYO key. Streaming SSE renderer panel. Slice B of the AI bridge. — 2026-04-26 (jy)
- [ai] Hosted credit proxy at `ai.linguacode.dev`: Cloudflare Worker + `ai_usage` D1 table + license-token quota enforcement + monthly reset cron. Pro Monthly + Team only. Slice C of the AI bridge. — 2026-04-26 (jy)
- [ai] Cross-language port: "translate this Python to Rust idiomatically" with diff view. Pro feature. — 2026-04-26 (jy)
- [ai] Test generator: function/class → Jest / pytest / Go test / Rust test scaffolding. Inline AI panel feature. — 2026-04-26 (jy)
- [ai] Error explainer: paste stacktrace → plain-English breakdown + likely-fix bullets. Free or trial-tier candidate. — 2026-04-26 (jy)
- [ai] Regex from natural language: "match IPv6 addresses" → working regex with sample inputs the AI verified the pattern against. — 2026-04-26 (jy)
- [ai] Docstring + JSDoc generator: select a function → AI emits the doc comment block in the target language idiom. — 2026-04-26 (jy)
- [ai] Variable rename suggestions: context-aware idiomatic naming based on usage in the snippet. — 2026-04-26 (jy)
- [ai] SQL builder: natural language → SQL against a connected DB schema. Synergy with the SQL playground panel. — 2026-04-26 (jy)
- [ai] Commit message from git diff: paste a diff → conventional commit message. Free tier. — 2026-04-26 (jy)
- [ai] Data inference: paste JSON / CSV → TypeScript / Pydantic / JSON-Schema / Zod / Avro types. — 2026-04-26 (jy)
- [ai] Algorithm coach + Big-O analysis: explain complexity of a snippet + suggest optimizations. — 2026-04-26 (jy)
- [ai] Codepath simulator: step-through execution with variable values inline (visualizes what RL-047 envisioned but AI-driven). — 2026-04-26 (jy)
- [ai] Image-to-code: paste a UI mockup → React / HTML component (vision API). Pro feature. — 2026-04-26 (jy)
- [ai] Prompt builder + token counter: meta-tool for users building LLM apps in the editor. — 2026-04-26 (jy)

#### Tools (Pillar 2 + extras)

- [tool] HTTP client panel — Postman-light. Multi-tab requests, history, auth methods (Bearer / Basic / OAuth simulator), env vars per request, response viewer, cURL import/export. Top-3 v2.0 must-have. — 2026-04-26 (jy)
- [tool] SQL playground panel — DuckDB-WASM (web) + native bridges (desktop) for SQLite / Postgres / MySQL. Query history, schema explorer. Top-3 v2.0 must-have. — 2026-04-26 (jy)
- [tool] GraphQL client panel — like HTTP panel but introspection-aware. Synergy with HTTP panel codebase. — 2026-04-26 (jy)
- [tool] OpenAPI client codegen — paste spec → fetch / axios / requests / Go client implementations. — 2026-04-26 (jy)
- [tool] Database explorer — read-only browse tables, with AI-assisted query when the AI bridge ships. — 2026-04-26 (jy)
- [tool] Image tools panel — resize / crop / convert formats / extract-from-data-uri / compress. — 2026-04-26 (jy)
- [tool] PDF tools panel — split / merge / extract text via pdf-lib WASM. — 2026-04-26 (jy)
- [tool] CSV / TSV table editor — mini-Excel UI with SQL-against-CSV via DuckDB-WASM. — 2026-04-26 (jy)
- [tool] Mermaid renderer — first-class diagram preview tab (markdown + standalone). — 2026-04-26 (jy)
- [tool] LaTeX renderer — first-class equation preview tab via KaTeX. — 2026-04-26 (jy)
- [tool] Encryption playground — AES-GCM, RSA, ECC, key generation, cross-format export. Synergy with JWT debugger. — 2026-04-26 (jy)
- [tool] OAuth flow simulator — demo authorization_code / PKCE / client_credentials flows offline. — 2026-04-26 (jy)
- [tool] Time tools panel — TZ math, business-day arithmetic, duration parser, ISO ↔ epoch ↔ human-readable. — 2026-04-26 (jy)
- [tool] Color tools v2 — palette generator (AI-assisted), accessibility checker, design tokens export to Tailwind / CSS vars. — 2026-04-26 (jy)
- [tool] Mock data generator — Faker.js + AI for realistic data based on a schema description. — 2026-04-26 (jy)
- [tool] Docs viewer offline (Dash-style) — vendored MDN / Python docs / Go docs, searchable. Free tier. — 2026-04-26 (jy)

#### Languages runnable (Pillar 3)

- [lang] SQL runnable — DuckDB-WASM in web build (~5MB), native sqlite / duckdb bridge in desktop. Plays with the SQL playground panel. Top-3 v2.0 must-have language. — 2026-04-26 (jy)
- [lang] Java runnable — TeaVM or CheerpJ WASM tier. Captures enterprise developers who currently have no scratchpad. Top-3 v2.0 must-have language. — 2026-04-26 (jy)
- [lang] Bash runnable — desktop-only, sandboxed sh subprocess via main IPC. — 2026-04-26 (jy)
- [lang] C / C++ runnable — Emscripten WASM tier with a stdin/stdout shim. — 2026-04-26 (jy)
- [lang] Lua runnable — fengari-luastate WASM. Aligns with the deferred lua entries in `RL-042`. — 2026-04-26 (jy)

#### Notebooks + viz (Pillar 4)

- [notebook] Notebook mode — promote `RL-043` from Planned. Cell-based execution with persistent outputs across reload. — 2026-04-26 (jy)
- [notebook] Inline data viz — promote `RL-044` from Planned. Auto-detect tables / images / matplotlib / plotly outputs and render richly. — 2026-04-26 (jy)
- [notebook] Notebook export to HTML — share a standalone snapshot. — 2026-04-26 (jy)

#### Collaboration (Pillar 5)

- [collab] Share by link — cloud snapshot endpoint (Cloudflare Pages + R2). Tab + history → shareable URL. — 2026-04-26 (jy)
- [collab] Embed mode — read-only iframe of a shared snapshot for blogs / docs. — 2026-04-26 (jy)
- [collab] Public snippet gallery — opt-in user profiles listing shared snippets. — 2026-04-26 (jy)

#### Plugin SDK (Pillar 6)

- [plugin] Plugin SDK v1 — promote `RL-038` Slices C + D. Typed API for utility-panel plugins, registered through the manifest already shipped in Slices A + B. — 2026-04-26 (jy)
- [plugin] Plugin marketplace — Pro feature, browse + install + auto-update plugins from `linguacode.dev/plugins`. Polar-billed for paid plugins. — 2026-04-26 (jy)
- [plugin] First-party launch plugins — OpenAPI codegen, Mermaid, LaTeX, Excalidraw embed, time tracker. Each one is a small slice once the SDK lands. — 2026-04-26 (jy)

#### Polish (cross-cutting)

- [polish] Smart paste — promote `RL-069` Slice 1. Detect any pasted content and suggest the right utility panel automatically. Major UX win that lifts the whole utilities surface. — 2026-04-26 (jy)
- [polish] Cross-tool piping — promote `RL-069` Slice 2. Base64 decode → JSON format → diff in three clicks without re-paste. — 2026-04-26 (jy)
- [polish] Recent inputs history per panel — every utility remembers the last 10 inputs locally so coming back the next day picks up where you left off. — 2026-04-26 (jy)
- [polish] Universal command palette improvements — fuzzy search across all panels + commands + tabs + recent inputs in one ranked list. — 2026-04-26 (jy)
- [polish] Onboarding tour v2 — interactive tutorial covering the 5 highest-value panels (whatever the analytics show). — 2026-04-26 (jy)

## 2. Small bugs / polish

Cosmetic or low-severity issues that do not warrant a dedicated
`RL-NNN` ticket. Group into a single `RL-NNN` when you have ~5 and
want to batch them into one sprint.

- [tests] Clean up the recurring React act(...) warnings across component suites so green runs are warning-free again — 2026-04-23
- [devutils] `unescapeWithPreset('python')` returns `expected-eight-hex-digits` when `\UHHHHHHHH` digits are well-formed but the codepoint exceeds `U+10FFFF`. Add a dedicated `codepoint-out-of-range` `UnescapeReason` variant + matching en/es i18n copy so the error message matches the root cause. Only reachable with Python preset and a value like `\U00200000`; cosmetic today. — 2026-04-23
- [devutils] Add an adversarial-forged-token test for `verifyJwt` ECDSA curve rejection: craft a token whose header claims `alg: ES256` but whose signature segment was produced against a P-384 key. That path reaches `importEcdsaKey` with a curve mismatch (the current curve-mismatch test trips the earlier algorithm-mismatch guard). Low-severity — not a realistic paste mistake — but worth pinning so the `invalid-jwk` branch classification stays stable. — 2026-04-23
- [editor] Align the hardcoded `ANSI_FG` / `ANSI_BRIGHT_FG` maps in `src/renderer/components/Console/ConsolePanel.tsx` (~lines 24-41) with the semantic `--app-*` CSS variables in `src/renderer/index.css`. Today ANSI-colored runtime output renders with static hex that won't track the theme-token system; if RL-073's Signal-Slate palette evolves, the console decorations will drift. Discovered during the RL-073 audit — 2026-04-24
- [editor] Selection-background alpha is inconsistent across redistributed themes in `src/renderer/components/Editor/editorThemes.ts` (dracula uses `#44475a40` with 40% alpha, monokai / one-dark-pro / nord-night declare opaque). Cosmetic: when a user switches between third-party themes the selection contrast flickers. Discovered during the RL-073 audit — 2026-04-24
- [editor] Surface a per-tab error indicator on `EditorTabs` for the tab whose last execution failed. Requires lifting per-tab execution status out of the global `executionHistoryStore` (today only the global ring buffer knows about it) so the tab strip can read a `lastExecutionStatus` field directly off `FileTab`. Punted from RL-076 to keep that slice focused on visuals + context menu. — 2026-04-26
- [editor] Drag-and-drop reorder for `EditorTabs`. The DS spec on `signal-tabs-editor.jsx` shows a drag handle on hover; implementing it needs a new `moveTab(fromId, toIndex)` store action plus DnD wiring (HTML5 drag-drop or react-dnd). Deferred from RL-076. — 2026-04-26
- [editor] Overflow dropdown with hidden-tabs count badge for `EditorTabs`. When tabs exceed the viewport, render a chevron button at the end with a `+N` badge that opens a list of the hidden tabs (jump-to-tab UX). Today the strip falls through to horizontal scroll. Deferred from RL-076. — 2026-04-26
- [editor] Pin tab, Reveal in Finder, Copy path on the tab context menu. Pin requires a new `isPinned` field on `FileTab` and a sort step in render; Reveal in Finder + Copy path need IPC handlers in `electron/preload.ts`. All three are referenced in the DS spec but were skipped in RL-076. — 2026-04-26
- [ui] Display the global keyboard shortcut inline next to Command Palette entries that have a binding in `KEYBOARD_SHORTCUTS` (e.g. `Open Settings · ⌘,`). Cross-reference the catalog from `src/renderer/data/keyboardShortcuts.ts` by command id. Punted from RL-074 to keep that slice focused on grouping. — 2026-04-25
- [ui] Promote recent-runs to their own Command Palette scope (separate eyebrow header) instead of riding inside `action`. Requires extending the `CommandCategory` enum or a new field on `CommandEntry`; deferred until we see whether users discover recent runs in the action grouping or ask for them to be more prominent. — 2026-04-25
- [runtime] Ruby loop protection (RL-042 fold F deferred). Both the WASM and desktop subprocess paths can hang on `loop { }` / `while true` / `Enumerable#each` without a yield. Needs a renderer-side Ruby AST (Tree-sitter or ANTLR — both heavy) or a hand-rolled regex pre-pass that handles `loop do`, `while … end`, `until … end`, one-line modifiers, and block forms. Mirrors the JS/Python `injectLoopProtection` shape. Estimated ~90 LOC + tests once the parser dep is picked. — 2026-05-20
- [editor] Document Monaco built-in muscle-memory shortcuts that Lingua inherits for free in the `KeyboardShortcutsModal`. Today the modal only lists the 30 entries from `keyboardShortcuts.ts`, so the user assumes Lingua has no support for multi-cursor (Cmd+D, Cmd+Shift+L, Alt+click), toggle comment (Cmd+/), line move/copy (Alt+Up/Down, Shift+Alt+Up/Down), find next/prev (F3, Shift+F3), select line (Cmd+L), or fold/unfold (Cmd+K Cmd+0 / Cmd+K Cmd+J). Monaco handles all of these natively — surfacing them in the modal closes a perceptual gap without writing runtime code. Pure docs + add a "Monaco built-in" group to the modal that renders read-only chips. ~2h. — 2026-05-21 (jy)
- [editor] Inverse highlight pairing (RL-044 Sub-slice I candidate). Counterpart to Sub-slice G: when the user hovers a line in Monaco that produced ≥ 1 console output entry, briefly outline every console row whose `origin.line === hoveredLine` in the bottom panel. Useful for the "I have 200 console.logs in a hot loop, which ones came from line 42?" flow. Reuses the `origin` payload field already added by Sub-slice G. Slice 1 surface: outline animation + a "scroll to first match" affordance. AC still TBD pending Sub-slice G ship. — 2026-05-21 (jy)
- [editor] Bookmarks (mark + jump). VSCode's Bookmarks extension is the canonical UX: Cmd+Alt+K toggles a bookmark on the current line, Cmd+Alt+L jumps to the next bookmark across all open tabs. Especially valuable for the scratchpad audience that uses Lingua as a "scrap of paper" — pinning the 3 spots they keep coming back to during exploration. Requires: a new `bookmarksStore` (per-tab Set<lineNumber>), a Monaco gutter decoration, 2-3 keyboard shortcuts, persistence behind the same `lingua-debugger-state`-style isolated key. ~6h including tests. Low-priority because the same effect can be hacked via breakpoints, but the cognitive overload of mixing breakpoints + bookmarks is real. — 2026-05-21 (jy)
- [editor] Recent edit location ring (Cmd+U / Cmd+Shift+U back/forward). Beyond Cmd+P (open file) and Cmd+G (go to line), senior devs miss the "jump back to where I was just editing" gesture. IntelliJ binds this to Cmd+[ / Cmd+] and VSCode to Ctrl+- / Ctrl+Shift+-. Implementation: per-tab ring buffer of the last 20 edit locations, Cmd+U pops back, Cmd+Shift+U pops forward. Reuses the existing `editorAccess.ts` Monaco ref. ~4h. — 2026-05-21 (jy)
- [editor] Python LSP (Pyright in a worker). RL-026 closed for Go (gopls) + Rust (rust-analyzer) but Python is still no-LSP — F12 go-to-def, F2 rename, F1 hover (RL-118 Slice 2) all degrade to "no info" for `.py` buffers. Pyright bundles cleanly into a Web Worker (the Pylance maintainers ship it) and Pyodide already proves we can load Python machinery in the browser. Slice 1 scope: Pyright worker boot + LSP-over-postMessage adapter + Monaco hover/definition/rename providers wired to it. Likely heavy (~3-5 days incl. desktop parity + bundle-size impact assessment) but the perceptual ROI is large — Python is Lingua's biggest non-JS language. Promote to RL when the audit of Pyright bundle size against `RL-086` perf budgets clears. — 2026-05-21 (jy)
- [runtime] BrowserPreview HMR (true hot module replacement) — RL-119 Slice 1 ships full-iframe re-eval on each keystroke, which loses state (variables, event listeners). For prototyping React components or canvas animations the lost state is friction. A real HMR adapter would let the user keep their bouncing-ball animation running while tweaking the colors. Cost: significant — needs a Vite-style module graph + boundary detection, only practical for ESM JS/TS. Defer until RL-119 ships and we measure how often users complain about the state loss. — 2026-05-21 (jy)
- [editor] Edit value inline during debug pause (RL-120 Slice 3 fold). When paused at a breakpoint with inline values visible (`▸ x = 42`), let the user double-click the decoration to edit the value and continue with the new value. VSCode supports this for primitives + simple objects via the Variables view; doing it via inline decoration is the more discoverable surface. Requires plumbing a `set-frame-variable` message through the worker debugger protocol + handling commit/rollback. ~1 day of work; promote once RL-120 Slice 3 ships and validates the inline values UX is loved. — 2026-05-21 (jy)
- [editor] Status bar lint-counts segment Pro/Free differentiation. RL-112 Slice 1 plans a single lint count for everyone, but the Free tier ceiling on inline lint markers might create a "3 errors visible, 47 hidden" surface mismatch. Audit when RL-108 + RL-112 both ship; decide whether the status bar surfaces the hidden-count as an upsell or stays silent. — 2026-05-21 (jy)

## 3. Spikes and research

Time-boxed exploration to decide something. Not implementation work.
Outcome is a recommendation or an ADR, not shipped feature code.

- _(none captured yet — candidates worth capturing here: service
  worker / offline cache hardening follow-up to the deferred study in
  `PLAN.md`, pt-BR locale bundle effort estimate, WebGPU-accelerated
  Monaco diff renderer feasibility)_

## 4. Parked feature requests

Requests from users, operators, or stakeholders that are real but not
currently prioritized. Note who asked and when so decay is visible.

- _(none captured yet)_
