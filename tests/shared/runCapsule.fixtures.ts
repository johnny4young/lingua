/**
 * RL-094 Slice 1 fold G — RunCapsuleV1 fixture catalog.
 *
 * 10 representative capsule shapes that every downstream world-class
 * ticket consumes as a shared smoke surface:
 *
 *   - RL-036 share-link tests round-trip these through the URL
 *     fragment encoder + decoder.
 *   - RL-098 CLI tests pipe each through `lingua capsule validate`
 *     and assert the exit codes.
 *   - RL-097 HTTP request tests embed `http` fixtures and the
 *     pipeline emits a capsule per response.
 *   - RL-099 pipeline tests stamp one capsule per step.
 *   - RL-100 importer tests assert cURL → capsule produces the
 *     `http-get-200` fixture shape.
 *   - RL-039 Slice B lesson tests reference `lesson-assertion` as the
 *     expected-output baseline.
 *
 * The catalog is intentionally JSON-serialisable (no helper closures,
 * no runtime functions) so downstream tests can `import { ... } from`
 * a single source-of-truth file without dragging the renderer
 * Settings component or the build helpers into their context.
 *
 * Adding a new fixture: append to FIXTURES, add a brief description
 * comment, update `docs/CAPSULE_TEST_MATRIX.md` so consumers know
 * what's available. Renaming an existing fixture is a wire-format
 * break — bump `version` and migrate every downstream consumer.
 */

import type { RunCapsuleV1 } from '../../src/shared/runCapsule';

const APP_VERSION = '0.0.0-fixture';

function baseCapsule(
  overrides: Partial<RunCapsuleV1> & {
    capsuleId: string;
    tab: RunCapsuleV1['tab'];
    source: RunCapsuleV1['source'];
    result: RunCapsuleV1['result'];
    environment: RunCapsuleV1['environment'];
  }
): RunCapsuleV1 {
  return {
    version: 1,
    capsuleId: overrides.capsuleId,
    createdAt: '2026-05-21T13:00:00.000Z',
    appVersion: APP_VERSION,
    tab: overrides.tab,
    source: overrides.source,
    input: overrides.input ?? {},
    result: overrides.result,
    environment: overrides.environment,
    privacy: overrides.privacy ?? {
      redactionVersion: '2026-05-21',
      omittedFields: [],
    },
  };
}

/** 1. Minimal happy-path capsule. JS scratchpad, no stdin, no rich output. */
export const FIXTURE_MINIMAL_JS: RunCapsuleV1 = baseCapsule({
  capsuleId: '00000000-0000-4000-8000-000000000001',
  tab: {
    name: 'scratchpad.js',
    language: 'javascript',
    runtimeMode: 'worker',
    workflowMode: 'scratchpad',
  },
  source: {
    content: 'const x = 1 + 2; console.log(x);',
    contentHash:
      '8502d5f0da07a61c2fe53eb873e2230064f5ce475828d5493e97cb1a1969ae18',
  },
  result: {
    status: 'success',
    durationMs: 3,
    stdout: '3\n',
  },
  environment: { platform: 'web', runner: 'javascript' },
});

/** 2. Full happy-path capsule. TS, stdin, every result field populated. */
export const FIXTURE_FULL_TS: RunCapsuleV1 = baseCapsule({
  capsuleId: '00000000-0000-4000-8000-000000000002',
  tab: {
    name: 'demo.ts',
    language: 'typescript',
    runtimeMode: 'worker',
    workflowMode: 'run',
  },
  source: {
    content: 'const name = prompt(); console.log(`hi ${name}`);',
    contentHash:
      '4641f278128211b595367d0bd19b5b7a460cc74ef61997950752171f1a44d911',
  },
  input: { stdin: 'Ada\n' },
  result: {
    status: 'success',
    durationMs: 12,
    stdout: 'hi Ada\n',
    lineResults: [{ line: 2, value: 'hi Ada' }],
    diagnostics: [],
  },
  environment: { platform: 'web', runner: 'typescript' },
});

/** 3. Python with chart payload (RL-044 cross-language parity). */
export const FIXTURE_PYTHON_CHART: RunCapsuleV1 = baseCapsule({
  capsuleId: '00000000-0000-4000-8000-000000000003',
  tab: {
    name: 'plot.py',
    language: 'python',
    runtimeMode: 'worker',
    workflowMode: 'run',
  },
  source: {
    content:
      '__lingua.chart({"data": {"values": [{"a": 1, "b": 2}]}, "mark": "bar"})',
    contentHash:
      '0f22c118cab80d4b54d6b556b32eb82b783b30052cf1ba7862bcb6558aede83f',
  },
  result: {
    status: 'success',
    durationMs: 28,
    richOutputs: [
      {
        kind: 'chart',
        spec: { data: { values: [{ a: 1, b: 2 }] }, mark: 'bar' },
      },
    ],
  },
  environment: { platform: 'web', runner: 'python' },
});

/** 4. Python with explicit error + structured traceback. */
export const FIXTURE_PYTHON_ERROR: RunCapsuleV1 = baseCapsule({
  capsuleId: '00000000-0000-4000-8000-000000000004',
  tab: {
    name: 'boom.py',
    language: 'python',
    runtimeMode: 'worker',
    workflowMode: 'run',
  },
  source: {
    content: 'raise ValueError("boom")',
    contentHash:
      'edb4d85f047c15b373c3b61a486677c296b53f90c522d364dfeae75fabc470a0',
  },
  result: {
    status: 'error',
    durationMs: 5,
    stderr: 'ValueError: boom\n',
    errorMessage: 'ValueError: boom',
    diagnostics: [
      {
        kind: 'error',
        message: 'ValueError: boom',
        line: 1,
      },
    ],
  },
  environment: { platform: 'web', runner: 'python' },
});

/** 5. Run terminated by parent timeout. */
export const FIXTURE_TIMEOUT: RunCapsuleV1 = baseCapsule({
  capsuleId: '00000000-0000-4000-8000-000000000005',
  tab: {
    name: 'loop.js',
    language: 'javascript',
    runtimeMode: 'worker',
    workflowMode: 'run',
  },
  source: {
    content: 'while (true) { /* hot loop */ }',
    contentHash:
      '87848b6f52769e4e0e5c972aca590c9a84fa3cb21f06c6de8ebbf7d3420cb4b1',
  },
  result: {
    status: 'timeout',
    durationMs: 5000,
    errorMessage: 'Execution exceeded the long preset (5000 ms).',
  },
  environment: { platform: 'web', runner: 'javascript' },
});

/** 6. User-stopped run. */
export const FIXTURE_STOPPED: RunCapsuleV1 = baseCapsule({
  capsuleId: '00000000-0000-4000-8000-000000000006',
  tab: {
    name: 'sleep.js',
    language: 'javascript',
    runtimeMode: 'worker',
    workflowMode: 'scratchpad',
  },
  source: {
    content: 'await new Promise(r => setTimeout(r, 60_000));',
    contentHash:
      '0999becc3d9a4571ad6063def0781f442027290171a3bfc23bbf8e8bcacf6225',
  },
  result: {
    status: 'stopped',
    durationMs: 1234,
    errorMessage: 'Execution stopped by user.',
  },
  environment: { platform: 'web', runner: 'javascript' },
});

/** 7. Run with stdout overflow that triggers MAX_STREAM_BYTES truncation. */
export const FIXTURE_LARGE_STDOUT: RunCapsuleV1 = baseCapsule({
  capsuleId: '00000000-0000-4000-8000-000000000007',
  tab: {
    name: 'noisy.js',
    language: 'javascript',
    runtimeMode: 'worker',
    workflowMode: 'run',
  },
  source: {
    content: "for (let i = 0; i < 1e7; i += 1) console.log('x');",
    contentHash:
      '1e463fb1d71db3f1d58025fddb50993041f094d0e36c9e2ce25eedfafa296f38',
  },
  result: {
    status: 'success',
    durationMs: 250,
    // Note: this is the *pre-truncation* shape. sanitizeRunCapsule
    // applies the clamp and appends 'result.stdout' to omittedFields.
    stdout: 'x\n'.repeat(600_000),
  },
  environment: { platform: 'web', runner: 'javascript' },
});

/**
 * 8. Worst-case redaction probe: source carries a fake license token
 * substring so a forgotten redactor regression is loud. The capsule
 * is intentionally honest about embedding the source — that's the
 * whole replay-artifact promise — so the consumer sees the token
 * in `source.content`. Downstream RL-036 share-link emission MUST
 * route any user-confirmation flow through this fixture so the UI
 * never silently publishes a token.
 */
export const FIXTURE_LICENSE_LEAK_PROBE: RunCapsuleV1 = baseCapsule({
  capsuleId: '00000000-0000-4000-8000-000000000008',
  tab: {
    name: 'leak.js',
    language: 'javascript',
    runtimeMode: 'worker',
    workflowMode: 'scratchpad',
  },
  source: {
    content:
      'const token = "fake-jwt.eyJpc3MiOiJsaW5ndWEiLCJzdWIiOiJ0ZXN0IiwidGllciI6InBybyJ9.x"; console.log(token.length);',
    contentHash:
      '48cfe32122acae79eda5c4d73c79937ff5e2f4e2f6993a8112ab5b5306e83996',
  },
  result: {
    status: 'success',
    durationMs: 1,
    stdout: '95\n',
  },
  environment: { platform: 'web', runner: 'javascript' },
});

/**
 * 9. Desktop platform with a non-empty dependencySummary that exercises
 * the redactor's flat-object pass (drops anything non-primitive,
 * keeps the rest, records the field in omittedFields).
 */
export const FIXTURE_DESKTOP_DEP_SUMMARY: RunCapsuleV1 = baseCapsule({
  capsuleId: '00000000-0000-4000-8000-000000000009',
  tab: {
    name: 'fetch.ts',
    language: 'typescript',
    runtimeMode: 'node',
    workflowMode: 'run',
  },
  source: {
    content: 'console.log(await fetch("https://example.com").then(r => r.status));',
    contentHash:
      'a4698223df7864f37b31093f57cc149d28b3f89f97b24e602fd0963cf74f0cc0',
  },
  result: {
    status: 'success',
    durationMs: 142,
    stdout: '200\n',
  },
  environment: {
    platform: 'desktop',
    runner: 'node-22.4.0',
    dependencySummary: {
      node: '22.4.0',
      npm: '10.8.1',
      // Non-primitive sub-objects should be dropped by sanitizeRunCapsule.
      modules: { undici: '6.0.0' },
    },
  },
});

/**
 * 10. Lesson-assertion baseline (RL-039 Slice B reference). Identical
 * shape to FIXTURE_FULL_TS but with a stable timestamp + stripped
 * dependencySummary so two snapshots taken on different days produce
 * byte-identical capsule JSON when sanitised. Downstream lesson
 * tests assert the user's run JSON equals this fixture after
 * `sanitizeRunCapsule` + JSON.stringify.
 */
export const FIXTURE_LESSON_ASSERTION: RunCapsuleV1 = baseCapsule({
  capsuleId: '00000000-0000-4000-8000-000000000010',
  createdAt: '2026-01-01T00:00:00.000Z',
  tab: {
    name: 'lesson-01.js',
    language: 'javascript',
    runtimeMode: 'worker',
    workflowMode: 'run',
  },
  source: {
    content: "console.log('Hello, lesson');",
    contentHash:
      '74ab5b59988c393cdca00254dc125592060b51310caf0070f2811c3b238629ad',
  },
  result: {
    status: 'success',
    durationMs: 1,
    stdout: 'Hello, lesson\n',
  },
  environment: { platform: 'web', runner: 'javascript' },
});

/**
 * Catalog used by `runCapsule.test.ts` to apply property-based
 * assertions to every fixture (round-trip, redaction, omittedFields
 * shape, etc.). Downstream tickets MAY import individual fixtures
 * directly when they need a specific shape.
 */
export const ALL_FIXTURES: ReadonlyArray<{
  name: string;
  fixture: RunCapsuleV1;
}> = [
  { name: 'minimal-js', fixture: FIXTURE_MINIMAL_JS },
  { name: 'full-ts', fixture: FIXTURE_FULL_TS },
  { name: 'python-chart', fixture: FIXTURE_PYTHON_CHART },
  { name: 'python-error', fixture: FIXTURE_PYTHON_ERROR },
  { name: 'timeout', fixture: FIXTURE_TIMEOUT },
  { name: 'stopped', fixture: FIXTURE_STOPPED },
  { name: 'large-stdout', fixture: FIXTURE_LARGE_STDOUT },
  { name: 'license-leak-probe', fixture: FIXTURE_LICENSE_LEAK_PROBE },
  { name: 'desktop-dep-summary', fixture: FIXTURE_DESKTOP_DEP_SUMMARY },
  { name: 'lesson-assertion', fixture: FIXTURE_LESSON_ASSERTION },
];
