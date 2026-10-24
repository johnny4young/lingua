# SQL editor input synchronization

## Behavior and cause

Rapid per-character input can reach the SQL editor's Monaco model, then be
replaced by an earlier React draft. The resulting text is also saved after the
500 ms debounce. This was reproduced with native Electron using both Stagewright
and direct Playwright, including a reduction importing the real editor and store.
It is not necessary to change language or reach a save boundary: an idle English
case also reproduces it.

The controlled Monaco wrapper reconciles its value in a passive effect. With
asynchronous draft publication, a previously committed value can be applied after
the next native input event. The SQL editor observes the draft immediately and commits its latest visual
publication in a microtask after Monaco updates its cursor, before the next native
input task and controlled reconciliation. Programmatic cursor insertion from its own React effect
keeps the normal callback path, avoiding a nested flush during an effect.

Base: `c894c977005d1447c2fc5550360ffe2c2542ee1f`, Lingua 1.6.2.
Observed tools: Node 24.21.0, pnpm 11.3.0, React 19.3.0, Monaco 0.55.1,
Monaco React 4.7.0, Playwright 1.63.0 and Electron 44.3.0. Use the project's
pinned dependencies; no database credentials, real services or signed license
from a production issuer are required.

## Native regression and complementary browser coverage

Use a disposable checkout. Review install/build scripts and prepare the pinned
project dependencies in that checkout. The canonical runner mints a synthetic
license and serves local production assets; its fixtures intercept service calls.

```sh
pnpm install --frozen-lockfile --ignore-scripts
CI=1 node scripts/run-playwright-web-validation.mjs tests/e2e/sqlEditorTyping.spec.ts --workers=1 --retries=0 --trace=on
```

The portable native fixture is the regression reproducer. Provision the project's
verified official Electron binary in the isolated environment, then run:

```sh
node scripts/smoke-sql-editor-input.mjs --electron-executable /verified/official/Electron
```

It compiles the real editor/store reduction into an owned temporary directory,
uses a hidden isolated profile, refuses external browser traffic, mocks credential
storage and clipboard APIs, and checks model, store, persisted source and Run.
It also checks effect-driven cursor insertion in EN/ES, publication before each
next character, and same-task unmount, query switch, Run and byte-limit safety.
The fixture records only synthetic requests: it never executes SQL. It retains a JSON report
and verifies the native process exit. Review the fixture and launcher first.
The macOS CI job uploads only the synthetic report and containment record as
`sql-editor-native-input`; it does not upload the disposable profile.
The portable launcher was run unchanged against the recorded base and repair:
7/12 typing cases passed on the base and 12/12 on the repair using the final
ESM fixture (the earlier CommonJS preparation observed 5/12 on the base). Both candidates
passed 2/2 effect-driven insertions, with zero console errors and native exit 0.
The base returned process exit 1 for the observed text mismatches; the repair
returned exit 0. Counts describe those runs, not a probability guarantee.

The two browser cases exercise English and a live transition to Spanish. They replace
the query through real per-character events, assert the rendered text and then
its persisted draft. The pending-save scenarios start near the existing debounce
boundary; these are functional checks, not performance thresholds. The browser case passed on the recorded unpatched Chromium153 run; it is
complementary coverage and is not claimed as a deterministic native reproduction.
The existing
single-event `keyboard.insertText` helper does not exercise this race.

To keep product code on the failing base, from the PR checkout:

```sh
git worktree add --detach ../lingua-input-base c894c977005d1447c2fc5550360ffe2c2542ee1f
git show HEAD:tests/e2e/sqlEditorTyping.spec.ts > ../lingua-input-base/tests/e2e/sqlEditorTyping.spec.ts
cd ../lingua-input-base
pnpm install --frozen-lockfile --ignore-scripts
CI=1 node scripts/run-playwright-web-validation.mjs tests/e2e/sqlEditorTyping.spec.ts --workers=1 --retries=0 --trace=on
```

For the native failing base, also copy only these test helpers from the PR:

```sh
for file in scripts/smoke-sql-editor-input.mjs tests/__fixtures__/sql-editor-input/index.html tests/__fixtures__/sql-editor-input/main.mjs tests/__fixtures__/sql-editor-input/electron.mjs tests/__fixtures__/sql-editor-input/vite.config.mts; do
  mkdir -p "../lingua-input-base/$(dirname "$file")"
  git show "HEAD:$file" > "../lingua-input-base/$file"
done
```

Run that copy command from the PR checkout before changing to the base directory.
Run the same native launcher there with the same verified Electron binary.
Only tests and helpers are copied. Preserve the failing trace and compare the
same command in the separate patched checkout. Do not reuse an installed app,
real user profile or running preview; CI mode disables preview reuse.

## Native reproduction and limits

In an isolated Electron profile, open a SQL scratch query. Focus
`[data-testid="sql-query-editor-monaco"] .monaco-editor .overflow-guard`, select
all with Meta+A (Control+A on other platforms) and call
`page.keyboard.type('SELECT 424201 AS answer')` with the default zero key delay.
The equivalent Stagewright operation is `electron_type_into_editor` with that
selector, text, `replace:true` and `timeoutMs:6000`. Verify the actual source and
saved draft independently of the typing tool's success response. Repeat after
changing EN to ES, and while the previous draft is approaching its save boundary.
No SQL execution is necessary to observe the text defect.

Recorded baseline reduction: 7/12 mismatches per driver with timeline probes;
without component instrumentation, 6/12 MCP and 10/12 direct mismatches. All
requested key events arrived. Model rollback occurred before the first save in
an idle case. A private synchronous-publication intervention passed 12/12 per
driver with zero console errors. These counts describe the recorded run, not a
probability guarantee. The checked-in native fixture supplies the failing-base reproduction;
the browser test supplies complementary coverage. Native profiles and screenshots
remain private evidence.

The fix is limited to SQL editor input. It does not change SQL execution,
connection security, the save debounce, other editors or the MCP. Synchronous
publication changes scheduling under fast synthetic input; do not interpret
controller wall time as product performance or claim a signed-release check.

## Historical synchronous-publication control

A separate idle-only native profiling control used three cold/warm pairs per
input rate on an Apple M3 Pro (11 logical CPUs, 18 GiB RAM), with the same pinned
tools. At 125 ms between keys, every base sample recorded 23 root commits and
every repaired sample recorded 46. Root counts do not identify which component
rendered or prove all added commits are unnecessary. Text and cursor state are
separate updates; attributing the extra commits to their scheduling is still a
hypothesis to verify before further changes.

The typing-window task-CPU medians were 480.825 to 471.574 ms cold and 404.063 to
453.993 ms warm, base to repair. With three samples per group, no performance
threshold or overall speed claim is justified. Zero-delay base samples defer
React work outside that window, so their CPU numbers cannot qualify the total
update cost against synchronous publication. The next profiling check must
include the settled draft/save window and a timestamped text/cursor commit trace.
These hidden, unthrottled-window measurements include a 60 ms pre-type settle
and do not replace the functional native failing-base reproduction.

No caching, lazy-loading policy, assets or database queries were optimized by
this change. The native functional smoke does not qualify IME/composition, large
buffers, visible-frame smoothness, release signing or notarization.

## Batched publication and portable performance bank

The synchronous repair at `8c87e55e748225d4b107b3fe666a614c278a9e21`
provides the matched control for batching. Preserve that checkout. The batched
candidate observes text immediately for cleanup and Run, coalesces model updates
with a generation token, and flushes visual text in a microtask after the native
cursor event. On unmount the queued render is invalidated; the owner persists its
already-observed draft. Run derives both source and byte-cap validation from that
current buffer. Effect-driven insertion retains its ordinary callback.

Two rejected private variants establish safety requirements: postponing the
owner's draft observation lost a same-task unmount; postponing Run's source and
byte check dispatched the old query instead of the newest or oversized buffer.
The checked-in component and native assertions cover these without executing SQL.
Do not weaken the persisted-source or pre-next-key oracles to optimize counts.

Run serially, with no other build/profile competing for the machine:

```sh
node scripts/profile-sql-editor-input.mjs --electron-executable /verified/official/Electron
```

This runs three fresh-process cold/warm pairs at each of 0 and 125 ms per key.
Cold means an empty owned profile, not a flushed OS disk cache; warm means the
same process/profile with a new component/model. Each pair builds the fixture
before timing. Both typing and at least 650 ms plus the observed save are measured.
CDP CPU is sampled before dump serialization. The report retains source hashes,
hardware, versions, raw text/cursor root timelines, unmatched publications, CPU,
publication latency and per-group medians/ranges. Root commits are not individual
component render counts. The observer is fixture-only and tied to React 19 hooks;
a missing observer is a harness limitation, never zero renders or a product bug.

For a matched control, copy only `scripts/smoke-sql-editor-input.mjs`,
`scripts/profile-sql-editor-input.mjs` and `tests/__fixtures__/sql-editor-input/`
from this PR to a separate checkout at the control SHA. Install the same pinned
versions and use the same official binary and command. Preserve each report
before the next run. Never copy product source into the control.

A private three-pair comparison on Apple M3 Pro, 11 logical CPUs, 18 GiB RAM,
Darwin 27, Node 24.21.0 and the versions above recorded 46 to 23 typing root
commits and 47 to 24 settled root commits at 125 ms per key. At zero delay both
had 23 typing commits, with 25 to 24 settled. Text/cursor timelines identified
separate commits in the synchronous control and combined publications in the
candidate; the required per-character updates and the save remain measured.
All 36 base/control/candidate profiling samples had exact final model/store/
persisted text. Those idle settled samples do not replace the native regression:
a fresh unpatched native matrix still produced 4/12 wrong final buffers.

Task-CPU settled medians (control to private batching candidate) were 84.934 to
84.567 ms cold and 68.243 to 64.776 ms warm at zero delay; at 125 ms, 519.777 to
464.138 ms cold and 439.134 to 437.401 ms warm. Samples varied widely: the last
warm group ranged 207.761–468.566 ms. No overall CPU improvement is claimed.
Median publication latency increased from 1.8 to 2.9 ms cold and 1.6 to 2.7 ms
warm at 125 ms; the observed cold maximum increased from 4.8 to 6.1 ms. These
are hidden-window observations with three runs per group, not absolute budgets,
visible-frame qualification, or proof every removed root commit was unnecessary.

Private additional checks covered 16/64 KiB buffers at both rates and CDP
EditContext composition with exact persisted CJK text. CDP emulation does not
qualify a real operating-system IME. These optional experiments are not claimed
as coverage supplied by the default portable smoke.

Change-to-check map: UI/state changes rerun native data safety, root timelines
and EN/ES web smoke; imports/dependencies/routes rerun bundle and startup gates;
network/cache changes require request traces; DB/model changes require isolated
SQL/query traces; assets/build changes rerun image/font/script budgets. This
SQL scheduling change does not justify new caching, lazy loading or asset/SQL
optimizations. Production Sentry access is not required or used.

### Portable matched results

The checked-in [numeric report](benchmarks/sql-editor-batching.json) records the
actual batched source and the unchanged `8c87e55` control with the portable
launcher. The earlier private experiment used a different fixture/build lifecycle;
keep its CPU numbers separate. All 24 portable samples had exact model/store/
persisted text, zero missed intermediate publications and publication before
all 23 next-character boundaries. All six native processes per variant exited 0
and reported zero console errors. Three observations per group are not independent
hardware replications or an absolute regression budget.

| Delay | Cache | Settled root commits, median (range), control → batched | Settled task CPU ms, median (range), control → batched | Publication latency ms, pooled median (max), control → batched |
| --- | --- | --- | --- | --- |
| 0 ms | cold | 28 (28–30) → 24 (24–24) | 59.934 (56.954–64.063) → 61.273 (56.461–62.502) | 0.3 (0.7) → 0.4 (1.9) |
| 0 ms | warm | 29 (27–29) → 24 (24–24) | 34.578 (33.635–38.011) → 35.048 (33.455–35.383) | 0.2 (0.6) → 0.4 (0.9) |
| 125 ms | cold | 47 (47–47) → 24 (24–24) | 368.614 (331.761–370.283) → 324.763 (298.190–341.265) | 1.7 (4.1) → 2.6 (5.5) |
| 125 ms | warm | 47 (47–47) → 24 (24–24) | 292.331 (279.876–295.249) → 277.142 (275.530–283.036) | 1.4 (3.6) → 2.5 (4.5) |

Across the 12 candidate samples, the root trace contained 276 combined text/cursor
commits, no text-only or cursor-only commits, and 12 other commits including save.
The control had 111 combined, 165 text-only, 165 cursor-only and 12 other commits.
The reduction is attributed to batching those state publications; the necessary
23 character publications and save still occur. CPU at zero delay is slightly
higher by the recorded median and ranges overlap. Publication is slightly later.
No broad CPU speedup, visible-frame smoothness, full-app startup or cache/SQL
improvement is claimed. Source hashes normalized by the same project formatter
bind the measured source to the minimal diff after removing unrelated formatting.
