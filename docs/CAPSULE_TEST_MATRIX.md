# Run Capsule test matrix

> **Status:** Live — RL-094 Slice 1 (`2026-05-21`).
>
> Reference for downstream world-class tickets (RL-036, RL-097, RL-098,
> RL-099, RL-100, RL-039 Slice B) that consume the
> `tests/shared/runCapsule.fixtures.ts` catalog and the
> `tests/shared/runCapsule.test.ts` cross-cut assertions.

## Why this doc exists

`RunCapsuleV1` is the universal wire format every downstream
world-class ticket serialises through. Each downstream slice adds at
least one new consumer (URL fragment, CLI replay, AI prompt preview,
HTTP response, pipeline step, lesson assertion). Re-inventing a
fixture catalog per ticket would cause silent drift between consumer
expectations and capsule reality.

This doc pins:

1. The **dimensions** the capsule contract must hold across every
   consumer.
2. The **fixture catalog** in `tests/shared/runCapsule.fixtures.ts`
   that exercises those dimensions.
3. The **per-ticket consumption guide** so each downstream slice
   imports the right fixtures and runs the right assertions.

The matrix is enforced at CI time via `tests/shared/runCapsule.test.ts`;
adding a new fixture without updating this doc is allowed but
strongly discouraged — the doc is the only place a reviewer can
verify coverage by reading.

## Dimensions

| # | Dimension | Where the assertion lives |
|---|---|---|
| 1 | Schema round-trip per fixture | `runCapsule.test.ts → "parseRunCapsule + JSON round-trip (per fixture)"` |
| 2 | Builder shape (defaults / overrides / hash determinism) | `runCapsule.test.ts → "buildRunCapsule"` |
| 3 | Sanitiser redaction proof (license / dependency / source) | `runCapsule.test.ts → "sanitizeRunCapsule — redaction proof"` |
| 4 | Stream truncation at `MAX_STREAM_BYTES` (1 MiB each) | `runCapsule.test.ts → "sanitizeRunCapsule — stream truncation"` |
| 5 | Parser version gating + oversized rejection | `runCapsule.test.ts → "parseRunCapsule — version gating"` |
| 6 | Parser shape validation (load-bearing fields) | `runCapsule.test.ts → "parseRunCapsule — shape validation"` |
| 7 | Summary helper format stability | `runCapsule.test.ts → "summarizeRunCapsule"` |
| 8 | `contentHash` collision-resistance smoke (10 000 inputs) | `runCapsule.test.ts → "computeContentHash — collision smoke (Dimension 8)"` |

If a downstream ticket needs an additional dimension (e.g. URL
fragment percent-encoding round-trip for RL-036) that dimension goes
in the consumer's own test file but MUST import from
`runCapsule.fixtures.ts` instead of inlining a capsule literal.

## Fixture catalog

`tests/shared/runCapsule.fixtures.ts` exports ten frozen capsules
plus the `ALL_FIXTURES` array. Names match the import re-exports:

| Fixture | Why it exists | Primary consumer (Slice 1 + downstream) |
|---|---|---|
| `FIXTURE_MINIMAL_JS` | Minimal happy-path, no rich output. | Settings export smoke, RL-036 fragment encoder default. |
| `FIXTURE_FULL_TS` | Every field populated incl. `lineResults` + `diagnostics`. | RL-097 HTTP step assertion, RL-099 pipeline step. |
| `FIXTURE_PYTHON_CHART` | Vega-Lite chart embedded under `richOutputs`. | RL-036 cross-language preview test, RL-098 CLI render. |
| `FIXTURE_PYTHON_ERROR` | Status `'error'` + structured stderr. | RL-039 Slice B lesson assertion (negative). |
| `FIXTURE_TIMEOUT` | Status `'timeout'` with the parent-killer message. | RL-098 CLI replay status-bucket coverage. |
| `FIXTURE_STOPPED` | Status `'stopped'` (user clicked Stop). | RL-098 CLI replay status-bucket coverage. |
| `FIXTURE_LARGE_STDOUT` | 1.2 MiB stdout — exercises the sanitiser truncation. | Stream-cap coverage, RL-036 share-link size budget. |
| `FIXTURE_LICENSE_LEAK_PROBE` | Source content contains a fake JWT substring. | Sanitiser must NEVER strip `source.content` (capsules ARE replay artifacts); the consumer-side flow MUST surface a preview before publishing. RL-036 share-link confirmation modal. |
| `FIXTURE_DESKTOP_DEP_SUMMARY` | Desktop platform + flat dependency summary with one nested object. | Sanitiser drops nested objects + records the field in `omittedFields`. |
| `FIXTURE_LESSON_ASSERTION` | Stable timestamp + minimal env so two runs on different days byte-equal after sanitise. | RL-039 Slice B lesson expected-output reference. |

## Per-ticket consumption guide

### RL-036 share-links (slot 14)

```ts
import {
  FIXTURE_MINIMAL_JS,
  FIXTURE_LICENSE_LEAK_PROBE,
  FIXTURE_LARGE_STDOUT,
} from '../shared/runCapsule.fixtures';
```

- Use `FIXTURE_MINIMAL_JS` for the default round-trip.
- Use `FIXTURE_LICENSE_LEAK_PROBE` to assert the share modal renders
  the source content and requires explicit user confirmation before
  emitting the URL fragment.
- Use `FIXTURE_LARGE_STDOUT` to assert the URL fragment encoder
  fails closed (HTTP-error-style) rather than silently truncating
  beyond what the URL fragment can hold.

### RL-097 HTTP + SQL workspace (slot 20)

```ts
import { FIXTURE_FULL_TS } from '../shared/runCapsule.fixtures';
```

- HTTP step emits a capsule shaped like `FIXTURE_FULL_TS` with
  `environment.runner = 'http'`. Use the fixture as a baseline.

### RL-098 CLI companion (slot 23)

```ts
import {
  FIXTURE_MINIMAL_JS,
  FIXTURE_PYTHON_CHART,
  FIXTURE_TIMEOUT,
  FIXTURE_STOPPED,
} from '../shared/runCapsule.fixtures';
```

- `lingua capsule validate` runs each fixture through stdin and
  asserts exit codes (0 for happy, 0 for chart, 0 for timeout / stopped
  — they're valid capsules even if the run wasn't successful).

### RL-099 utility pipelines (slot 21)

```ts
import { FIXTURE_FULL_TS } from '../shared/runCapsule.fixtures';
```

- Pipeline step output is a capsule. Use `FIXTURE_FULL_TS` as the
  baseline shape for `step.output`.

### RL-100 importers (slot 24)

```ts
import { FIXTURE_FULL_TS } from '../shared/runCapsule.fixtures';
```

- cURL importer produces a capsule shaped like `FIXTURE_FULL_TS`
  with `environment.runner = 'http'`. Assert the shape.

### RL-039 Slice B lessons (slot 25)

```ts
import { FIXTURE_LESSON_ASSERTION } from '../shared/runCapsule.fixtures';
```

- Lesson assertion runs the user's code through `executeTabManually`,
  then JSON-compares the resulting capsule (after sanitise) to
  `FIXTURE_LESSON_ASSERTION`. Stable timestamp + minimal env in the
  fixture keeps byte-equality plausible across CI runs.

## Adding a new fixture

1. Add the export in `tests/shared/runCapsule.fixtures.ts` with a
   block comment describing the dimension it covers.
2. Append to the `ALL_FIXTURES` array so cross-cut tests pick it up.
3. Add a row to the **Fixture catalog** table above.
4. Add a row under **Per-ticket consumption guide** if the fixture
   targets a specific downstream ticket.
5. The cross-cut tests in `runCapsule.test.ts` automatically widen
   coverage — no test-file edit needed unless the fixture exercises
   a new dimension.

## Adding a new dimension

1. Add a `describe` block in `runCapsule.test.ts` named
   `"<dimension name> (Dimension N)"`.
2. Add a row to the **Dimensions** table above with the path to the
   `describe`.
3. If the dimension is invariant across every fixture, iterate
   `ALL_FIXTURES`. Otherwise add a targeted assertion on the
   relevant fixture(s).

## Anti-patterns

- **Inlining a capsule literal in a downstream test.** Use a fixture
  import. If no fixture covers the shape, add one (see above).
- **Mutating a fixture.** Fixtures are frozen-shape literals; use the
  spread operator to derive a test-local copy.
- **Asserting on `createdAt` byte-equality without overriding.** Pass
  `createdAtMs` to `buildRunCapsule` for byte-stable tests.
- **Bypassing `sanitizeRunCapsule` before serialising.** All export
  paths (Settings, palette, RL-036, RL-098, etc.) MUST call the
  sanitiser before `JSON.stringify` so `privacy.omittedFields` is
  honest and the redactor's rule set is applied uniformly.
