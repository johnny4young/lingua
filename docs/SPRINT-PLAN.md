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

## 1. Status at a glance (2026-04-22)

Mirrors the authoritative `Status` column in
[`ROADMAP.md`](./ROADMAP.md) §4. **When discrepancies appear, ROADMAP wins.**

| Iter | Ticket | Status | Scope |
|------|--------|:------:|-------|
| Iter 1 | [`RL-068`](./ROADMAP.md) · [`RL-072`](./ROADMAP.md) + [`RL-070`](./ROADMAP.md) + [`RL-068`](./ROADMAP.md) | Shipping · Hash Generator closeout landed 2026-04-24 (RL-071 Done) | Expand Developer Utilities to DevUtils parity — QR Code generate; JWT Decode/Verify/Sign modes covering all 12 JWS algorithms (HS256/384/512 + RS256/384/512 + ES256/384/512 + PS256/384/512); Base64 Image Encode/Decode panel; Beautify/Minify covering JSON + JS (terser v5) + HTML + CSS + SCSS + LESS + XML; Backslash Escape/Unescape (JS / JSON / Python / SQL-MySQL); Random String Generator (Web Crypto rejection sampling); Lorem Ipsum Generator (words / sentences / paragraphs with canonical-opening toggle + mid-sentence commas); Regex Replace mode with native-spec back-references; SVG → CSS converter (Base64 / URL-encoded with data-URI + CSS block outputs); Cron Parser (cron-parser + cronstrue lazy-imports, human-readable EN + ES description, configurable next-N runs); Hash Generator closeout (MD5 via spark-md5, SHA-384/512, HMAC SHA family, file-drop). See §3 for the closing summary. |
| Iter 2 | [`RL-028`](./ROADMAP.md) | Partial (5 of ~7 slices shipped) | Execution history — replay-by-id + comparison. See §4. |
| Iter 3 | [`RL-027`](./ROADMAP.md) | Partial (ADR only) | Debugger MVP — JS/TS first slice. See §5. |
| Iter 4 | [`RL-059`](./ROADMAP.md) | Partial | License-key infrastructure — Polar webhook + email delivery. Gates the 0.3 launch. See §6. |
| Iter 5 | [`RL-038`](./ROADMAP.md) | Partial (Slices A + B shipped) | Language-pack registry Slice C — capability-aware UI. See §7. |

Gated / deferred tickets are NOT in this table — they live exclusively in
`ROADMAP.md` until the gate clears.

## 2. Recommended sequence

Value-per-day priority. The full reasoning is in
[`ROADMAP.md`](./ROADMAP.md) §5; this list only names the next pulls.

1. **Iter 4 / RL-059** — close the licensing story (~1 week, unblocks
   `RL-061` and `RL-063`, which gate the 0.3 launch).
2. **Iter 1 / RL-068 + RL-071 / RL-072** — finish the Developer Utilities
   trailing slices (~2 days each, diverse code, no external risk).
3. **Iter 2 / RL-028** — replay + benchmarking for execution history
   (~1 week, builds on the ring buffer that already shipped).
4. **Iter 3 / RL-027** — debugger JS/TS MVP (~2 weeks, depends on nothing
   but is a bigger scope — schedule it when a longer uninterrupted block
   is available).
5. **Iter 5 / RL-038 Slice C** — capability-aware UI for language packs
   (~1 week, unblocks `RL-042` incremental language adds).

Anything Gated (none currently) stops the flow and raises a question to
the user — do not speculate a workaround.

---

## 3. Iter 1 / RL-068 — Finish Developer Utilities DevUtils parity

**One-liner**: Close the remaining ~2 DevUtils-equivalent panels that
ROADMAP §4e marks as "remaining" plus the JWT verify/sign and Base64
file-upload slices from RL-071.

**Context**: 16 panels shipped (JSON, Base64, URL, UUID, Hash, Timestamp,
JWT, Regex, Color, Diff, Number Base, Beautify/Minify, URL Parser,
String Case, HTML Entity, String Inspector). The remaining work is the
small-scope trailing slices — use them as "warm-up" work when blocked
on a launch ticket.

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

---

## 4. Iter 2 / RL-028 — Execution history replay + comparison

**One-liner**: Extend the ring-buffer store with per-entry replay that
re-runs the original tab content (captured snapshot), plus a
"compare two runs" view that shows a side-by-side diff of outputs.

**Context**: The ring buffer (metadata-only today) needs an opt-in
snapshot mode for replay. A Pro-gated entitlement already exists for
execution history, so we layer this on top without a new gate.

**4.1 Sequencing (3 commits, ~1 week)**:

1. **Commit 1 — snapshot mode for the ring buffer** (~2 days)
   - Add `snapshot: { code: string, language: Language } | null` to the
     store entry. Default off; a Settings toggle under Execution History
     section flips the opt-in (UI copy: "Keep a copy of the code for
     replay — off by default, stays on your machine").
   - On each `record()` call, if opt-in is on, snapshot the tab's
     current content. Otherwise `snapshot: null`.
   - Persistence contract unchanged: the store stays in-memory only
     (RL-028 §Privacy posture).
   - Tests: record with opt-in off stores null; opt-in on captures code
     + language; flipping off mid-session stops snapshots going forward
     but does not wipe existing ones.

2. **Commit 2 — replay action** (~2 days)
   - Add `Replay` button next to `Re-run` in the popover entry row.
     Replay opens a NEW tab with the snapshot code and triggers run.
     Disabled + tooltip "Opt in to snapshots to enable replay" when the
     entry has `snapshot: null`.
   - Wire a new palette action `executionHistory.palette.replay.label`.
   - Tests: click replay → new tab opened with matching code, run
     dispatched exactly once; replay on a null-snapshot entry is
     a no-op with notice.

3. **Commit 3 — compare two runs** (~2 days)
   - Add a `Compare` affordance when the user selects exactly two
     entries in the popover (checkbox UI). Opens a dedicated
     `ExecutionComparisonModal` with two side-by-side output panes and
     a summary strip (language, duration delta, exit status).
   - Reuse `diffLines` from `src/renderer/utils/diff.ts` for the
     output diff.
   - i18n keys: `executionHistory.compare.*`.
   - Tests: select 2 → Compare button enables; modal renders diffed
     output; one + two + three selections update enable state cleanly.

**4.2 Edge cases**:
- Two entries of different languages → comparison still renders but
  the summary strip notes the mismatch.
- Replay while a run is in progress → refused with a translated notice,
  no tab leakage.
- Snapshot opt-in flipped off while the popover is open → existing
  entries with snapshots stay replay-eligible.

**4.3 Draft commit messages**:

```
feat(execution-history): opt in snapshot capture for future replay

- add snapshot field to ring buffer entries gated by a Settings toggle
- persistence still in memory only to respect the existing privacy posture
- record captures code and language when the opt in is active
- cover toggle on off plus round trip tests
```

```
feat(execution-history): replay a recorded run in a new tab

- add Replay action in the history popover and the command palette
- open a new tab preloaded with the snapshot code then dispatch run
- disabled state with translated tooltip when the entry has no snapshot
- cover replay dispatch single fire and the no snapshot no op path
```

```
feat(execution-history): compare two runs with inline output diff

- add a Compare action when exactly two entries are selected
- render an ExecutionComparisonModal with side by side output panes
- reuse diffLines from utils diff for the output delta
- add executionHistory compare keys in en and es
- cover selection gating and cross language comparison
```

---

## 5. Iter 3 / RL-027 — Debugger MVP (JS/TS first slice)

**One-liner**: Minimal breakpoint + step-over debugger for JS and TS
tabs in the worker runtime. Desktop-first; web build gets a deferred
"available in desktop" notice.

**Context**: The ADR (`docs/DEBUGGER_ADR.md`) picked a V8 inspector
approach piped over IPC for desktop. No production code yet. This iter
lands the smallest end-to-end slice so the debugger surface is live and
can be iterated.

**5.1 Sequencing (5 commits, ~2 weeks)**:

Detailed sequencing to be filled in when this iter is picked. At
minimum: (a) IPC surface + main-process inspector connection; (b)
breakpoint column gutter in Monaco; (c) paused-execution side panel
with call stack + variables; (d) step over / continue / stop controls;
(e) i18n + tests + desktop smoke.

**Open questions before starting** (must be answered by the user):
- Pyodide debugger parity — in or out of the MVP?
- Source-map support for TypeScript — V8 inspector reads the transpiled
  code; do we re-map column markers to the user's TS source?

---

## 6. Iter 4 / RL-059 — License-key infrastructure (closing slices)

**One-liner**: Polar.sh webhook handler + email delivery so the full
buy-verify-activate loop is live. The verifier, Settings UI, and tier
gates are already shipped.

**Context**: RL-059 shipped the offline Ed25519 verifier, the Settings
License section, the pasted-token apply flow, and `useEntitlement()`
everywhere. The remaining gap is the server-side delivery path that
issues signed tokens after a Polar checkout completes.

**Full detail to land when this iter is picked.** Must sequence with
`RL-061` (Polar product setup) since they share the contract.

---

## 7. Iter 5 / RL-038 — Language-pack registry Slice C

**One-liner**: Make the UI capability-aware so new languages added via
`src/shared/languagePacks.ts` automatically show up in the toolbar,
file tree, tooltips, and run-button disabled states without per-call-site
code.

**Context**: Slice A (declarative registry) and Slice B (runner dispatch)
shipped. Slice C moves the remaining consumers — toolbar language menu,
file tree capability badge, Run button proOnly/desktopOnly tooltips,
and the Settings capability matrix — off their per-language switch
statements and onto `getLanguagePackById()`.

**Sequencing to be filled in when this iter is picked.**

---

## 8. Cross-iteration concerns

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

## 9. Verification matrix (per iter, before the closing commit)

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

## 10. Closure protocol

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
