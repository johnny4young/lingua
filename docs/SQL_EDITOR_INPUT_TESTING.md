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
the next native input event. The SQL editor now commits native model changes before
that reconciliation. Programmatic cursor insertion from its own React effect
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
It also checks effect-driven cursor insertion in EN/ES. It retains a JSON report
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

## Scheduling cost to review

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
