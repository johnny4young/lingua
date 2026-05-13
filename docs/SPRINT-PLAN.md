# Lingua — Sprint Plan

> Tactical, iteration-level execution plan. Each iter here is **one
> `RL-XXX` ticket** in [`docs/ROADMAP.md`](./ROADMAP.md) §4, with the
> extra granularity the roadmap intentionally omits: commit sequencing,
> per-commit file list, edge-case matrix, verification steps, and draft
> commit messages.
>
> ROADMAP is the canonical ticket list + status. This file is the
> execution checklist the agent opens next to it.
>
> **One iter at a time, in the order of §2 "Recommended sequence".**
> Do not interleave commits between iters. The first line of the chat
> when starting an iter is `Executing RL-XXX — <one-liner>`.

---

## 1. Status at a glance (2026-05-05)

Mirrors the authoritative `Status` column in
[`ROADMAP.md`](./ROADMAP.md) §4. **When discrepancies appear, ROADMAP wins.**

| Iter | Ticket | Status | Scope |
|------|--------|:------:|-------|
| Iter 1 | [`RL-072`](./ROADMAP.md) | Shipped (2026-05-08) | Specialty utilities — QR + inspector. Shipped on 2026-05-08 — see RL-072. |
| Iter 2 | [`RL-028`](./ROADMAP.md) | Shipped (2026-05-01) | Execution history — closed by Slice 7 (Compare two runs, code-only diff). See §4. |
| Iter 3 | [`RL-027`](./ROADMAP.md) | Slice 1.5 shipped (2026-05-11) | Debugger MVP — Slice 1.5 closes the user-facing surface: BreakpointGutter (gutter dots + click toggle + `Mod+Shift+B`), mounted `DebuggerDrawer` with chevron collapse, Settings rows (toggle + Disable-all + Clear-all), TS source-map composition, three telemetry events, language-pack capability flip, toolbar pill, runbook + ADR amendment + CAPABILITY_MATRIX rows + blocking e2e smoke. **Slice 1.5b still pending**: conditional-breakpoint + watch-expression evaluation (held behind dedicated security review). See §5. |
| Iter 4 | [`RL-061`](./ROADMAP.md) | Shipped · Slice 5 on 2026-04-30 closes the launch-blocker scope: web build migrated from GH Pages to **Cloudflare Pages** at `app.linguacode.dev`, `update-server` exposes `GET /web/version`, web build polls every 12h and surfaces a `WebUpdateBanner` (Reload + Dismiss) when the remote tag is strictly newer, `release.yml` gains per-platform skip inputs (`release_macos`/`release_windows`/`release_linux`/`release_web`) so web-only releases avoid the ~240-min full matrix. Parent ticket `RL-059` also closed 2026-05-12 as docs-sync (see `docs/PLAN.md#rl-059-license-key-infrastructure` Status Update). | License-key infrastructure. All slices shipped: Slice 0 (main bridge, 2026-04-25), Slice 1 (worker scaffold, 2026-04-26), Slice 2 (Polar+Resend, 2026-04-27), Slice 2.5 (web licenseStore, 2026-04-28), Slice 3 (web devices UI, 2026-04-28), Slice 3.5 (desktop bridge, 2026-04-29), Slice 4 (Trial+Education+Recovery, 2026-04-29), Slice 5 (release pipeline + web update banner, 2026-04-30). See [`LICENSING_ADR.md`](./LICENSING_ADR.md). |
| Iter 5 | [`RL-038`](./ROADMAP.md) | Shipped (2026-05-01) | Language-pack registry — closed by the Slice C closeout. See §7. |
| Iter 6 | [`RL-077`](./ROADMAP.md) | Shipped (2026-05-02) | Capability-based filesystem IPC sandbox — Slice 1 + Slice 2 both landed. See §8. |
| Iter 7 | [`RL-078`](./ROADMAP.md) | Shipped (2026-05-03) | Parent-owned execution timeouts + output / resource limits. See §9. |
| Iter 8 | [`RL-079`](./ROADMAP.md) | Shipped (2026-05-03) | Trusted native execution hardening for Go and Rust. See §10. |
| Iter 9 | [`RL-083`](./ROADMAP.md) | Shipped (2026-05-04); hardened (2026-05-08) | Offline runtime assets + strict CSP — Slice 1 vendored Pyodide for desktop and tightened the desktop CSP; Slice 2 originally closed the web track with a cache-first CDN strategy. The 2026-05-08 hardening follow-up moved web Pyodide to same-origin copied runtime assets. See §11. |
| Iter 10 | [`RL-080`](./ROADMAP.md) | Shipped (2026-05-04) | Release-grade desktop CI + update gates — Slice 1 (update-feed tests + ci.yml worker wiring) + Slice 2 (release-blocking audit + checksum re-verify + RELEASE.md sync) + Slice 3 (offline packaged macOS smoke gate). All ACs closed. See §12. |
| Iter 11 | [`RL-085`](./ROADMAP.md) | Shipped (2026-05-05) | SBOM + third-party license compliance — release SBOM and transitive license report generation, strict runtime license-policy gate, CI/release workflow wiring, and release notice sync. See §13. |
| Iter 12 | [`RL-092`](./ROADMAP.md) | Shipped (2026-05-05) | Release security review checklist — `docs/RELEASE_SECURITY.md` plus a guard test now pin the security sign-off surface. See §14. |
| Iter 13 | [`RL-063`](./ROADMAP.md) | Shipped (2026-05-05) | Marketing site live at https://linguacode.dev from the separate `lingua-marketing` repo (Astro 6 + Tailwind v4 + Cloudflare Pages, EN+ES). Cascades closed `RL-064` (press-kit ZIP at `/press`), `RL-066` (six SEO landing pages live; ranking measurement post-launch), and `RL-081` (live checkout/download copy aligned with desktop entitlement). See §15 + `MARKETING_SITE_ADR.md`. |
| Iter 14 | [`RL-082`](./ROADMAP.md) | Shipped (2026-05-05) | README + docs information-architecture cleanup — README slimmed from 537 → ~130 lines, contributor workflow consolidated into `docs/DEVELOPMENT.md`, end-user reference into `docs/USAGE.md`, docs index updated, `tests/docs/publicDocs.test.ts` absolute-path guard widened beyond the macOS user-home prefix to cover Linux, sandbox, and Windows drive-letter paths. |
| Iter 15 | [`RL-069`](./ROADMAP.md) | Shipped (2026-05-09) | DevUtils-class productivity layer — closed in full. Slice 1 (Cmd+K + Cmd+Shift+C/Cmd+Alt+R + fuzzy search + 5 output providers, 2026-05-05). Slice 2 (`detect()` on 27 panels + `<UtilityToolbar>` + Mod+Shift+A + 29-panel coverage, 2026-05-09). Slice 3 (clipboard-on-focus consent in Settings + per-tool history with isolated `lingua-utility-state` localStorage + 10-entry FIFO + 16KB-per-entry truncation + favorites with `@dnd-kit/sortable` keyboard-accessible drag-reorder + 3 new RL-065 telemetry events + 10 Playwright assertions in `tests/e2e/utilitiesPersonalize.spec.ts`, 2026-05-09). |
| Iter 16 | [`RL-091`](./ROADMAP.md) | Shipped (2026-05-06) | License + update server observability + runbooks — structured logging with sensitive-key redaction across both Cloudflare Workers, error classifier (client / server / upstream / storage), `/health/ready` readiness probes (D1, KV, Polar, Resend on license-server; GitHub on update-server), 5 operator runbooks under `docs/runbooks/`, and the metrics + alerts + dashboards spec at `docs/SERVER_OBSERVABILITY.md`. |
| Iter 17 | [`RL-084`](./ROADMAP.md) | Shipped (2026-05-06) | Local plugin manifest hardening — shared validator at `src/shared/plugins/manifest.ts` (path-safety regex + strict schema + bundled-runtime allowlist), new `unknown` plugin status distinct from `unavailable`, distinct diagnostics for invalid / incompatible / disabled / unknown / unavailable manifests, and full UI test coverage at `tests/components/Settings/PluginsSection.test.tsx`. |
| Iter 18 | [`RL-087`](./ROADMAP.md) | Shipped (2026-05-06) | Watcher reliability + filesystem edge cases — Shipped on 2026-05-06 — see RL-087. |
| Iter 19 | [`RL-088`](./ROADMAP.md) | Shipped (2026-05-06) | Accessibility QA hardening — Shipped on 2026-05-06 — see RL-088. |
| Iter 20 | [`RL-086`](./ROADMAP.md) | Shipped (2026-05-07) | Performance budgets + runtime observability — Shipped on 2026-05-07 — see RL-086. |
| Iter 21 | [`RL-089`](./ROADMAP.md) | Shipped (2026-05-07) | User profile backup, export, and restore — Shipped on 2026-05-07 — see RL-089. |
| Iter 22 | [`RL-090`](./ROADMAP.md) | Shipped (2026-05-07) | Error boundaries + recovery UX — Shipped on 2026-05-07 — see RL-090. |
| Iter 23 | [`RL-026`](./ROADMAP.md) | Shipped (2026-05-11) | Language intelligence beyond Monaco — closed in full. Slice 1 + Slice 2 (Python diagnostics + completions + hover + signature help), Slice 3 (Rust via rust-analyzer), and Slice 4 (Go via gopls + shared `useLspLifecycle` / `LanguageIntelligenceRow` / launcher-Map IPC) all shipped on 2026-05-11. See §17. |
| Iter 24 | [`RL-019`](./ROADMAP.md) | Slice 1 + Slice 3 shipped (2026-05-12) | Explicit JS/TS runtime modes — Slice 1 lands the contract surface (selector + state + telemetry + ADR). **Slice 3 lands the Browser preview backend**: iframe-isolated DOM runtime with strict sandbox (`allow-scripts`, no `allow-same-origin`) + srcdoc CSP (`default-src 'none'`), runId-anchored postMessage bridge, parent-owned timeout, scoped multi-file preview seed (fold A) for sibling `.css` / `.html` tabs, inspect-in-window button via opaque-origin data URL (fold F), per-mode CSP audit added to the ADR (fold B). Slice 2 (desktop Node child-process backend) is the only remaining sub-slice. See §18. |

Gated / deferred tickets are NOT in this table — they live exclusively in
`ROADMAP.md` until the gate clears.

## 2. Recommended sequence

Value-per-day priority. The full reasoning is in
[`ROADMAP.md`](./ROADMAP.md) §5; this list only names the next pulls.

1. **Security launch hardening** — closed. `RL-077`, `RL-078`,
   `RL-079`, and `RL-083` are all `Done` (RL-083 was hardened on
   2026-05-08 to self-host web Pyodide assets — see §11). Move on.
2. **Launch blockers** — closed. `RL-063` shipped 2026-05-05 (site live
   at https://linguacode.dev from the separate `lingua-marketing` repo;
   see `docs/MARKETING_SITE_ADR.md`). `RL-061` shipped 2026-04-30.
   `RL-059` closed 2026-05-12 as docs-sync — the named remaining scope
   (Polar webhook + email delivery) shipped under `RL-061`; the
   verifier + bridge scaffolding lives in production at
   `src/main/license.ts` + `src/renderer/stores/licenseStore.ts` +
   `src/shared/license.ts`.
3. **Release, legal, and compliance readiness** — closed. `RL-080`,
   `RL-085`, `RL-092`, and `RL-081` are all `Done` (RL-081 closed
   2026-05-05 once the live `linguacode.dev` surface aligned with the
   desktop entitlement copy).
4. **Runtime/platform surface hardening** — closed in full. `RL-091`
   closed 2026-05-06 (server observability + runbooks); `RL-084` closed
   2026-05-06 (plugin manifest hardening); `RL-087` closed 2026-05-06
   (watcher lifecycle audit + typed failure diagnostics + ignored-paths
   filter + USAGE.md platform-limitations section). Lane done.
5. **Product quality and supportability** — closed in full. `RL-088`
   closed 2026-05-06 (axe-core gate + keyboard-only flows +
   OverlayBackdrop focus restoration + `docs/A11Y.md` manual
   checklist). `RL-086` closed 2026-05-07 (bundle/runtime budgets,
   CI logs, desktop smoke runtime/memory). `RL-089` closed
   2026-05-07 (versioned profile export/import + three conflict
   policies + replace-confirm modal + file picker + paste fallback
   + explicit exclusion list). `RL-090` closed 2026-05-07 (top-level
   error boundaries + safe-mode boot + boot-loop counter / factory
   mode + RecoverySection with five scoped resets + reveal-folder +
   `docs/RECOVERY.md`).
6. **Utilities polish** — closed in full. `RL-072` closed 2026-05-08
   (QR decode + Copy-as-PNG + colors + SVG + `utilityOutputStore`
   wiring). `RL-069` closed 2026-05-09 across Slice 1 (productivity
   foundation), Slice 2 (detect + Apply + 29-panel coverage), and
   Slice 3 (clipboard-on-focus + history + favorites).
7. **Debugger + language intelligence** — `RL-026` closed 2026-05-11
   after Go via gopls shipped on the shared LSP scaffold; `RL-027`
   Slice 1.5 is shipped. Remaining work is `RL-027` Slice 1.5b
   (conditional breakpoints + watch expressions behind security review).
8. **Runtime mode expansion** — `RL-019` + `RL-020` after the runtime
   contract is stable.
9. **Notebook + rich output** — `RL-043` + `RL-044` as a paired slice.
10. **Personalization + lessons** — `RL-039` in-app lesson browser,
    then `RL-041` static export.
11. **Growth / SEO / marketing / docs IA** — `RL-082` closed 2026-05-05
    (README slim-down + `DEVELOPMENT.md` + `USAGE.md`). `RL-032`
    continues as the remaining polish ticket after the core launch ships
    (`RL-066` closed 2026-05-05 with the marketing-site cascade).

Anything Gated (none currently) stops the flow and raises a question to
the user — do not speculate a workaround.

---

## 3. Iter 1 / RL-072 — Specialty utilities (QR + inspector)

Shipped on 2026-05-08 — see RL-072. Final closeout slice landed QR
decode (drag-drop image, jsQR), Copy-as-PNG, FG/BG color pickers with
WCAG-AA 4.5:1 contrast guard, high-contrast preset, SVG download
alongside PNG, and `utilityOutputStore` wiring (Cmd+Shift+C /
Cmd+Alt+R). Camera capture remains explicitly deferred per the
original scope decision.

<details>
<summary>Historical detail (collapsed — see commit history for the per-commit log)</summary>

The earlier per-commit narrative covering RL-068 / RL-070 / RL-071
DevUtils parity (Iter 1 commits 1–16) is preserved below for
provenance; ROADMAP wins on Status conflicts.

**3.1 Sequencing (2 commits, ~1.5 days)**:

1. **Commit 1 — QR utility (from `RL-072`)** — Shipped on 2026-04-23. See [`RL-072` in ROADMAP §4e](./ROADMAP.md) for the landed slice (PNG preview + L/M/Q/H levels + Download-as-PNG). Read mode still deferred.

2. **Commit 2 — JWT verify + sign (from `RL-071`)** — Shipped on 2026-04-23. See [`RL-071` in ROADMAP §4e](./ROADMAP.md) for the landed slice (HS256/384/512 + RS256 via Web Crypto, `src/renderer/utils/jwt.ts` extraction, panel mode toggle). ES/PS algorithms + regex replace + Base64 file upload still pending.

3. **Commit 3 — HTML Beautify / Minify (from `RL-070`)** — Shipped on 2026-04-23. See [`RL-070` in ROADMAP §4e](./ROADMAP.md) for the landed slice (Prettier html plugin wired, hand-rolled whitespace-only `minifyHtml` that preserves `<pre>` / `<textarea>` / `<script>` / `<style>` content byte-for-byte and strips HTML comments + IE conditional comments). CSS / SCSS / LESS / XML languages and the code-conversion bundle still pending.

4. **Commit 4 — Backslash Escape / Unescape (from `RL-068`)** — Shipped on 2026-04-23. See [`RL-068` in ROADMAP §4e](./ROADMAP.md) for the landed slice. New `src/renderer/utils/backslashEscape.ts` with 4 language presets (JavaScript, JSON, Python, SQL-MySQL); escape path encodes named + control + non-ASCII per preset; unescape path is a tagged-union state machine covering `\xHH`, `\uHHHH`, `\u{…}`, `\UHHHHHHHH`, octal, simple one-char escapes, with closed `UnescapeReason` enum for structural errors. YAML↔JSON, JSON↔CSV, Lorem Ipsum, Random String, Cron Parser, Markdown Preview, SQL Formatter still pending under the RL-068 umbrella.

5. **Commit 5 — JWT ES + PS algorithm families (from `RL-071`)** — Shipped on 2026-04-23. See [`RL-071` in ROADMAP §4e](./ROADMAP.md) for the landed slice. `JWT_SUPPORTED_ALGORITHMS` grew from 4 to 10 entries; `src/renderer/utils/jwt.ts` gained ECDSA (ES256 / ES384 / ES512 with P-256 / P-384 / P-521 curves) and RSA-PSS (PS256 / PS384 / PS512 with salt length = hash output in bytes) branches in both `verifyJwt` and `signJwt`. The latent `isHsAlgorithm` bug (previously `!== 'RS256'`, which would have routed ES/PS through HMAC) was flipped to `.startsWith('HS')` in the same diff. RS384 / RS512, regex replace, and Base64 file upload remain pending under RL-071.

6. **Commit 6 — CSS + XML Beautify / Minify (from `RL-070`)** — Shipped on 2026-04-23. See [`RL-070` in ROADMAP §4e](./ROADMAP.md) for the landed slice. `MinifyLanguage` grew to `json | javascript | html | css | xml`. CSS beautify routes through the already-bundled `prettier/plugins/postcss`; a new `minifyCss` state machine strips `/* */` comments, preserves single / double-quoted strings and url() function bodies (both quoted and unquoted) byte-for-byte, drops the trailing `;` before `}`, and applies asymmetric DROP_BEFORE / DROP_AFTER sets so `@media (…)`, `calc(100% - 20px)`, and `:not(.x)` keep their required spaces. XML pulls in the new `@prettier/plugin-xml` runtime dep (MIT, dynamic import — lazy chunk); a new `minifyXml` state machine preserves CDATA sections, processing instructions, and quoted attribute values. A trim-trailing-space tidy-up also applies to `minifyHtml` as a consistency fix for the HTML slice shipped last session. SCSS / LESS and the code-conversion bundle remain pending under RL-070.

7. **Commit 7 — Random String Generator (from `RL-068`)** — Shipped on 2026-04-23. See [`RL-068` in ROADMAP §4e](./ROADMAP.md) for the landed slice. New `src/renderer/utils/randomString.ts` with `buildCharset` (lowercase / uppercase / digits / symbols + ambiguous-char exclusion — `0 O o 1 l I |`) and `generateRandomStrings` (Web Crypto `getRandomValues(Uint32Array)` with rejection sampling using `threshold = floor(2^32 / size) * size` for an unbiased residue distribution). New `RandomStringPanel` with length + count number inputs, 5 charset checkboxes, Generate button, per-row `CopyButton` output matching the UUID pattern. Catalog count bumped 18 → 19. YAML↔JSON, JSON↔CSV, Lorem Ipsum, Cron Parser, Markdown Preview, SQL Formatter remain pending under RL-068.

8. **Commit 8 — JWT RS384 + RS512 + Base64 Image panel (from `RL-071`)** — Shipped on 2026-04-23. See [`RL-071` in ROADMAP §4e](./ROADMAP.md) for the landed slice. `JWT_SUPPORTED_ALGORITHMS` grew from 10 to 12; `rsaHashForAlgorithm` + `importRsaKey` widened to the full RS family via `isRsAlgorithm(a) = a.startsWith('RS')`; the unsupported-algorithm canary moved from `RS384` → `EdDSA` so it keeps meaning as the tuple grows. New `src/renderer/utils/base64Image.ts` with `encodeFileToDataUri` (FileReader-backed, tagged-union result, 10 MB cap, non-image MIME rejection) and `decodeDataUri` (regex-parsed, base64 + percent-encoded SVG bodies, byte-size reporting via `atob`). New `Base64ImagePanel` with Encode / Decode mode toggle, drag-drop dropzone + file input, paste-to-preview textarea, `<img src={dataUri}>` preview with MIME + size metadata, CopyButton on the data-URI output. Catalog count bumped 19 → 20. Regex replace + Hash Generator additions remain pending under RL-071.

9. **Commit 9 — SCSS + LESS + JS terser upgrade (from `RL-070`)** — Shipped on 2026-04-23. See [`RL-070` in ROADMAP §4e](./ROADMAP.md) for the landed slice. `MinifyLanguage` grew to `json | javascript | html | css | scss | less | xml` (7 languages). SCSS + LESS beautify routes through the already-bundled postcss plugin via new `scss: 'scss'` + `less: 'less'` entries in `PRETTIER_PARSER_BY_LANGUAGE` (no new Prettier plugin import needed). `minifyCss` gained a `//` line-comment branch that fires in code mode and consumes to end-of-line, covering the SCSS / LESS syntactic supersets; the trailing-`;`-drop look-ahead now skips whitespace AND line + block comments before checking for `}`. The hand-rolled whitespace-only `minifyJavaScript` state machine (~160 LOC) was replaced with a `terser@^5.46.2` dynamic import (BSD-2-Clause, ~100 KB gzipped, lazy-loaded inside the panel chunk — main editor chunk untouched); `minifySource` flipped from sync to async. The old `jsMinifyHint` key was removed (terser is a real minifier, no honesty hint needed); `cssMinifyHint` was renamed to `cssFamilyMinifyHint` with copy covering the CSS / SCSS / LESS family. Every unit + component + Playwright test updated to await the async dispatcher. Code-conversion bundle (HTML→JSX, SVG→CSS, cURL→Code) remains pending under RL-070.

10. **Commit 10 — Lorem Ipsum Generator (from `RL-068`)** — Shipped on 2026-04-24. See [`RL-068` in ROADMAP §4e](./ROADMAP.md) for the landed slice. New `src/renderer/utils/loremIpsum.ts` with a classical Latin word corpus + `generateLorem(options)` producing words / sentences / paragraphs. Sentences are 5-12 words with a single mid-sentence comma sprinkled for natural reading cadence; paragraphs are 3-6 sentences separated by blank lines. Optional `startWithClassic` forces the canonical "Lorem ipsum dolor sit amet, consectetur adipiscing elit." opening as the first sentence (or as the first words in words mode, truncated if count < 8). New `LoremIpsumPanel` with unit select, count number input, classic-opening checkbox, Generate button, output textarea with `CopyButton`. Catalog count bumped 20 → 21. YAML↔JSON, JSON↔CSV, Cron Parser, Markdown Preview, SQL Formatter remain pending under RL-068.

11. **Commit 11 — Regex Replace mode (from `RL-071`)** — Shipped on 2026-04-24. See [`RL-071` in ROADMAP §4e](./ROADMAP.md) for the landed slice. New `applyRegexReplace` in `src/renderer/utils/developerUtilities.ts` returning a tagged-union `{ ok, output, replacementCount, truncatedCount }` with the pre-existing `REGEX_MATCH_LIMIT` as a clamp on the reported count. A hand-rolled `expandReplacement` helper implements JS-native back-reference semantics (`$1` / `$2` / `$<name>` / `$&` / `$$`) inside the callback so the counter can increment alongside template expansion. `RegexUtilityPanel` gains a Match / Replace mode toggle; in Replace mode the right pane swaps to a read-only output textarea + plural-aware count summary + `CopyButton`; zero-matches falls through to the neutral `regex.empty` hint rather than a green success banner (consistent with Match mode). 9 new i18n keys in each locale. Hash Generator additions (MD5, SHA-384/512, HMAC, file-drop) remain pending under RL-071.

12. **Commit 12 — SVG to CSS converter (from `RL-070`)** — Shipped on 2026-04-24. See [`RL-070` in ROADMAP §4e](./ROADMAP.md) for the landed slice. New `src/renderer/utils/svgToCss.ts` with `convertSvgToCss(svg, options)` returning a tagged-union `{ ok: true, dataUri, cssBlock, encoding, size? } | { ok: false, errorKey }`. Two encodings: `base64` (UTF-8 → `btoa` → `data:image/svg+xml;base64,…`) and `percent` (`encodeURIComponent` plus a `'` tighten so output is safe inside both double- and single-quoted CSS strings). Size detection prefers the root `<svg>` tag's `width` + `height` attrs, falls back to `viewBox` entries 3 and 4, rejects non-positive values, and silently omits the `background-size` line when neither resolves. The opening-tag scanner is quote-aware so attribute values containing `>` do not terminate parsing early. Input is rejected before encoding with three localized error keys (empty / notSvg / tooLarge with a 100 KB cap). `SvgToCssPanel` hosts a mode select, an SVG markup textarea, and two read-only output textareas (data-URI + CSS block) with per-output `CopyButton`s and an optional detected-size hint. Catalog count bumped 21 → 22. 15 new i18n keys per locale. Remaining under RL-070: HTML → JSX and cURL → Code converters.

13. **Commit 13 — Cron Parser (from `RL-068`)** — Shipped on 2026-04-24. See [`RL-068` in ROADMAP §4e](./ROADMAP.md) for the landed slice. New `src/renderer/utils/cronParser.ts` with async `parseCronExpression(expr, options)` returning a tagged-union `{ ok: true, description, nextRuns } | { ok: false, errorKey, message? }`. Two MIT deps lazy-imported inside the helper: `cron-parser@^5` for validation + next-run iteration (supports 5-field expressions, 6-field expressions with seconds, nicknames like @daily/@monthly, list/range/step syntax), and `cronstrue/i18n.js@^3` for the human-readable explanation in both EN and ES. The cronstrue import uses the explicit root `i18n.js` file because native Node ESM does not resolve the extensionless package subpath without an exports map; `toString` is resolved from named, default, or `module.exports` shapes. Iteration runs against an optional `tz` (tests pin `UTC`; runtime defaults to machine local). `CronParserPanel` wires an async useEffect with try/catch + cancelled-flag guard so module-load rejections never strand the loading spinner, plus a raw library message line rendered in muted mono below the translated error prefix so ES users don't see half-English banners. Configurable next-N runs input clamped to [1, 100]. Catalog count bumped 22 → 23. 19 new i18n keys per locale. Remaining under RL-068: YAML↔JSON, JSON↔CSV, Markdown Preview, SQL Formatter.

14. **Commit 14 — Hash Generator closeout (from `RL-071`, closes the ticket)** — Shipped on 2026-04-24. See [`RL-071` in ROADMAP §6](./ROADMAP.md) for the landed slice. New `computeHash(input, options)` in `src/renderer/utils/developerUtilities.ts` returning a tagged-union `{ ok: true, hex, algorithm, mode, inputByteLength } | { ok: false, errorKey, message? }` that covers MD5 + SHA-1/256/384/512 in plain mode and HMAC over the full SHA family (HMAC-MD5 intentionally rejected). SHA digests route through `crypto.subtle.digest`; HMAC routes through `crypto.subtle.importKey` + `crypto.subtle.sign`; MD5 lazy-imports `spark-md5@^3` (MIT/WTFPL, ~2.7 KB gzipped) with a defensive interop fallback across `module.default.ArrayBuffer`, `module.ArrayBuffer`, and a `typeof === 'function'` guard so the module loads identically under Vite browser build + Vitest SSR. Input is normalized to `ArrayBuffer` up front; text and file paths share the downstream pipeline; a 50 MB cap (`HASH_FILE_MAX_BYTES`) protects the renderer since SubtleCrypto has no streaming API. `HashUtilityPanel` fully rewritten with three selects (mode plain/hmac, input source text/file, algorithm) + conditional HMAC key input + drag-drop file dropzone with `role="region"` for screen readers, all wired through an async useEffect with cancelled-flag guard. File reads use a monotonic generation counter so rapid file swaps never commit a stale `setFile` from a superseded read. HMAC + MD5 is auto-corrected to `SHA-256` inside the mode-change handler itself (same React render tick) so users never see the invalid-combo banner flash. 25 new i18n keys per locale (algorithm labels, mode/source toggles, drop hint, byte-length summary, 6 error branches); dead `utilities.tool.hash.error` key removed. Legacy `hashText(value, algorithm)` kept as a thin throw-on-error wrapper around `computeHash` for backward compatibility. Catalog count unchanged (same panel). RL-071 flipped from `Partial` to `Done` and moved to ROADMAP §6 archive.

15. **Commit 15 — Code-conversion bundle closeout: HTML → JSX + cURL → Code (from `RL-070`, closes the ticket)** — Shipped on 2026-04-24. See [`RL-070` in ROADMAP §6](./ROADMAP.md) for the landed slice. Two new deps-free helpers + two new panels land together. `src/renderer/utils/htmlToJsx.ts` uses built-in `DOMParser` to walk `document.head.childNodes` + `document.body.childNodes` (concatenation keeps top-level `<meta>` / `<title>` / `<link>` inputs from being silently promoted into `<head>` and disappearing) and emits 2-space-indented JSX with a ~30-entry attribute map (`class` → `className`, `for` → `htmlFor`, `charset` → `charSet`, event handlers lowercased-to-camelCase, etc.), `data-*` / `aria-*` passthrough, inline `style` parsed into an object literal with camelCased CSS property names, void elements self-closed, HTML comments rewritten as JSX comments, and `{` / `}` in text nodes escaped. `src/renderer/utils/curlToCode.ts` ships a POSIX argv tokenizer with CRLF-aware line-continuation handling + four code generators (`fetch`, `undici`, Python `requests`, Go `net/http`) behind `convertCurlToCode(input, { target })`. Unknown flags surface as inline warning comments rather than hard failures; file-backed body forms such as `--data @file`, `--data-binary @file`, and `--data-urlencode @file` are rejected with a translated error; `--data-urlencode` values are percent-encoded per cURL's name=value / =value / value rules; `-u` plus an explicit `Authorization` header emits a warning about the clobber. Both panels render tagged-union results with empty / error / warning branches; catalog count bumped 23 → 25. ~30 new i18n keys per locale in tuteo per AGENTS.md. Acceptance: 10-invocation cURL fixture + unit + component + Playwright round-trips for both panels. RL-070 flipped from `Partial` to `Done` and moved to ROADMAP §6 archive; the same staged closeout adds RL-073, so ROADMAP §6 now tracks 33 Done tickets.

16. **Commit 16 — RL-068 closeout: YAML ↔ JSON + JSON ↔ CSV + Markdown Preview + SQL Formatter (from `RL-068`, closes the ticket)** — Shipped on 2026-04-24. See [`RL-068` in ROADMAP §6](./ROADMAP.md) for the landed slice. Four new helpers + four new panels close every remaining DevUtils-parity item. `src/renderer/utils/yamlJson.ts` wraps the already-bundled `js-yaml@^4` (no dep delta) with a tagged-union helper covering both directions plus a comment-detection pass that respects YAML's `''` apostrophe escape inside single-quoted scalars. `src/renderer/utils/jsonCsv.ts` ships a deps-free RFC 4180 state machine with configurable delimiter (`,` / `\t` / `;` / `|`), a header-row toggle, sparse-row tolerance, embedded-quote/newline support, and detailed row+column metadata. `src/renderer/utils/markdownPreview.ts` lazy-loads `marked@^18` (MIT) and `dompurify@^3` (MPL-2.0 / Apache-2.0), strips remote `<img src="…">` via a regex pre-pass, and lets DOMPurify drop every remaining `src` attribute as the definitive backstop so no remote fetch can fire — the panel ships only the sanitized HTML textarea (no inline preview iframe; the iframe approach produced spurious sandbox console warnings in Playwright). `src/renderer/utils/sqlFormatter.ts` statically imports `sql-formatter@^15` (MIT, ~30 KB gz, lazy chunk regardless) and exposes ANSI / PostgreSQL / MySQL dialects with indent and keyword-case toggles. The combined panel surface bumps the catalog count 25 → 29 (`yaml-json`, `json-csv`, `markdown-preview`, `sql-formatter`). 67 new i18n keys per locale in tuteo. ~53 unit cases plus 10 component cases plus 4 Playwright round-trips cover the slice. RL-068 flipped from `Partial` to `Done` and moved to ROADMAP §6 archive; ROADMAP §6 now tracks 34 Done tickets.

**3.2 Edge cases**:
- QR: empty payload → empty placeholder, not a broken SVG. Payload
  longer than QR capacity (~4000 chars at level L) → inline error, not
  exception. Unicode + emoji round-trip.
- JWT: invalid JWK → translated error. HS256 with a short key → library
  warning surfaces as a "weak key" notice. Missing `alg` claim in
  header → rejected with a pointer to the spec.

**3.3 Draft commit messages**:

```
feat(devutils): add QR Code utility panel with payload and error level selector

- new src/renderer/utils/qrCode.ts wraps the qrcode library
- new QrCodePanel renders an inline SVG preview and a Download as PNG action
- register qr-code in DeveloperUtilities catalog and lazy router
- add utilities.tool.qrCode.* keys in en and es
- unit + component tests plus a Playwright assertion in overlays.spec.ts
- bump the catalog-count assertion in commandPaletteModel test
```

```
feat(devutils): jwt verify and sign modes with Web Crypto

- extend src/renderer/utils/jwt.ts with verifyJwt and signJwt covering HS and RS
- extend JwtUtilityPanel with a decode verify sign mode toggle
- copy buttons on every produced field mirror the rest of the utilities
- add utilities.tool.jwt.verify and utilities.tool.jwt.sign keys in en and es
- unit round trip plus component + Playwright tests for mode switching
```

</details>

---

## 4. Iter 2 / RL-028 — Execution history replay + comparison

Shipped on 2026-05-01 — see [`RL-028`](./ROADMAP.md) §6 archive for the
full slice-by-slice history (1 → 5 metadata + popover + palette
surfaces, 6 snapshot capture + Replay, 7 Compare two runs code diff).

---

## 5. Iter 3 / RL-027 — Debugger MVP (JS/TS first slice)

Shipped on 2026-05-11 — see [`RL-027`](./ROADMAP.md) and
[`docs/DEBUGGER_SLICE1.md`](./DEBUGGER_SLICE1.md) for the full operator
runbook covering Slice 1 (store + instrumenter + worker protocol) and
Slice 1.5 (gutter + drawer + Settings + TS source-map composition +
telemetry). Conditional-breakpoint + watch-expression evaluation remain
deferred to Slice 1.5b behind a dedicated security review.

---

## 6. Iter 4 / RL-059 + RL-061 — Licensing infrastructure (sequenced slices)

Shipped on 2026-04-30 — see RL-061 in [`docs/PLAN.md`](./PLAN.md#rl-061-polarsh-integration) for the full slice-by-slice history (0 → 1 → 2 → 2.5 → 3 → 3.5 → 4 → 5).

---


## 7. Iter 5 / RL-038 — Language-pack registry Slice C

Shipped on 2026-05-01 — see RL-038 in [`docs/PLAN.md`](./PLAN.md#rl-038-build-a-conservative-language-pack-architecture-before-expanding-plugins) for the full slice history (descriptor, runner dispatch, Toolbar / FileTree / Run-button capability UI, SnippetsModal, and EditorEmptyState).

---

## 8. Iter 6 / RL-077 — Capability-based filesystem IPC sandbox

Shipped on 2026-05-02 — see [`RL-077`](./PLAN.md#rl-077-capability-based-filesystem-ipc-sandbox).

---

## 9. Iter 7 / RL-078 — Parent-owned execution timeouts + resource limits

Shipped on 2026-05-03 — see [`RL-078`](./PLAN.md#rl-078-parent-owned-execution-timeouts-and-outputresource-limits).

---

## 10. Iter 8 / RL-079 — Trusted native execution hardening for Go and Rust

Shipped on 2026-05-03 — see [`RL-079`](./PLAN.md#rl-079-trusted-native-execution-hardening-for-go-and-rust).

---

## 11. Iter 9 / RL-083 — Offline runtime assets + strict CSP

Shipped on 2026-05-04 — see [`RL-083`](./PLAN.md#rl-083-offline-runtime-assets-and-strict-csp). Slice 1 vendored Pyodide for desktop and tightened the desktop CSP; Slice 2 originally closed the web track with cache-first SW + documented limitation. Hardened on 2026-05-08: web now uses the same copied, same-origin Pyodide runtime assets as desktop, and the web CSP no longer allows jsDelivr. ADR: [`RUNTIME_ASSETS_ADR.md`](./RUNTIME_ASSETS_ADR.md).

---

## 12. Iter 10 / RL-080 — Release-grade desktop CI + update gates

Shipped on 2026-05-04 — see [`RL-080`](./PLAN.md#rl-080-release-grade-desktop-ci-and-update-validation-gates). Slice 1 added the update-feed test matrix + ci.yml worker wiring; Slice 2 added a release-blocking production dependency audit + checksum re-verify; Slice 3 added the offline macOS packaged smoke gate.

---

## 13. Iter 11 / RL-085 — SBOM + third-party license compliance

Shipped on 2026-05-05 — see [`RL-085`](./PLAN.md#rl-085-sbom-and-third-party-license-compliance). The slice added `npm run check:licenses`, `npm run license:report`, `npm run compliance:release`, a generated transitive runtime license report, CI/release license gates, and release-uploaded SBOM/license artifacts.

---

## 14. Iter 12 / RL-092 — Release security review checklist

Shipped on 2026-05-05 — see [`RL-092`](./PLAN.md#rl-092-release-security-review-checklist). The slice added `docs/RELEASE_SECURITY.md` as the public-release security sign-off and `tests/docs/releaseSecurity.test.ts` as the guard for Electron/preload, IPC/filesystem, runners, update artifacts, licensing, telemetry/crash reporting, dependency notices, and public docs claims.

---

## 15. Iter 13 / RL-063 — Marketing site closure (cascades RL-064, RL-066, RL-081)

Shipped on 2026-05-05 — see [`RL-063`](./PLAN.md#rl-063-download-landing-page-at-linguacodedev) and [`MARKETING_SITE_ADR.md`](./MARKETING_SITE_ADR.md). The marketing surface lives in a separate repo (`lingua-marketing`) on Astro 6 + Tailwind v4 + Cloudflare Pages and auto-deploys from `main` to https://linguacode.dev. The closure cascades: `RL-064` Done (press-kit ZIP shipped at `/press`), `RL-066` Done (six SEO landing pages live in EN+ES with sitemap + JSON-LD; ranking measurement deferred to post-launch tracking), `RL-081` Done (live checkout/download/pricing surface aligned with desktop entitlement copy).

---

## 16. Iter 20 / RL-086 — Performance budgets and runtime observability

Shipped on 2026-05-07 — see [`RL-086`](./PLAN.md#rl-086-performance-budgets-and-bundleruntime-observability). Public-readiness follow-up folded desktop smoke runtime metrics into `performance:report` as `runtimeObservability`.

---

## 17. Iter 23 / RL-026 — Language intelligence beyond Monaco

Shipped on 2026-05-11 — see [`RL-026`](./ROADMAP.md) §6 archive. Closed
in full across four slices on the same day: Slice 1 + Slice 2 (Python
renderer adapter — diagnostics + completions + hover + signature help
over the shared `PythonSymbolTable`); Slice 3 (Rust via rust-analyzer
over a main-process LSP bridge — generic `lspProcess` JSON-RPC framing,
launcher-Map IPC with shared `ALLOWED_LSP_REQUESTS` allowlist, env
filtered through `buildNativeRunnerEnv`, conditional Settings row,
one-shot toast, single auto-restart with 500ms backoff); Slice 4 (Go
via gopls — same scaffold, generalised through `useLspLifecycle` +
`LanguageIntelligenceRow` so the rust + go paths share their effect
bodies and Settings rendering byte-identically). Capability triad
(`available` / `unavailable` / `degraded`) is owned by independent
per-language Zustand stores; the marker owner
`lingua-language-intelligence` is shared so Python, Rust, and Go
diagnostics cohabit on the same Monaco model.

---

## 18. Cross-iteration concerns

- **i18n parity** must stay green after each iter — both locales bump
  in the same commit that introduces a new key.
- **Coupled invariants** that frequently drift: `commandPaletteModel`
  catalog count, `appInfo.test.ts` + `adapter.test.ts` version pins.
  Update them in the same commit that bumps the corresponding source.
- **Electron boundary** — any peripheral, filesystem, or process call
  goes through `ipcMain.handle` → `preload` → `window.lingua.*`. Never
  `require('fs')` in the renderer.
- **Playwright** — every iter that adds a renderer surface extends
  `tests/e2e/overlays.spec.ts` (or a sibling) with the smallest
  assertion that would fail on regression.

## 19. Verification matrix (per iter, before the closing commit)

| Check | Command | Must pass |
|-------|---------|-----------|
| Lint | `npm run lint` | zero warnings |
| Typecheck | `npx tsc --noEmit` | zero errors |
| i18n parity | `npm run check:i18n` | both locales green |
| Renderer copy guard | `npm run check:i18n:copy` | no hardcoded user strings |
| Unit + component | `npm test -- --run` | all green |
| Playwright (web) | `npm run test:e2e:web` | when the iter touches renderer |
| Desktop smoke | `npm run smoke:desktop` | when the iter touches desktop-only IPC |
| Review skills | `typescript-react-reviewer` + `node` on the diff | zero HIGH blockers |

## 20. Closure protocol

When an iter closes, do three things in the final commit:

1. **Update this file** — move the iter row in §1 from `Partial` /
   `Planned` to `Shipped (<date>)`; shrink the iter's detailed §N
   section to a one-line "Shipped on `<date>` — see
   [`RL-XXX`](./ROADMAP.md)" reference.
2. **Update the matching row in [`docs/ROADMAP.md`](./ROADMAP.md) §4**
   — flip `Status` to `Done` (or keep `Partial` with updated
   `Readiness` if only a subset of slices shipped).
3. **If the iter introduced new docs (ADR, runbook, spec)** — register
   them in the [`docs/README.md`](./README.md) index.
