/**
 * RL-098 Slice 1 fold F — `--json` output snapshot tests.
 *
 * Pins the `--json` envelope shape across all 5 adapters. Adding
 * fields to the envelope is allowed (downstream consumers can
 * ignore unknown keys); removing or renaming existing fields is
 * forbidden — CI scripts depend on them.
 *
 * Snapshots live next to the test (Vitest's `toMatchSnapshot()`
 * format), reviewed manually when the contract intentionally
 * evolves.
 */

import { describe, expect, it } from 'vitest';
import { runUtilityCommand } from '../../src/cli/commands/utility';
import { runValidateCapsuleCommand } from '../../src/cli/commands/capsule';
import { FIXTURE_MINIMAL_JS } from '../shared/runCapsule.fixtures';
import { createFakeIo } from './io-fake';

describe('--json envelope snapshots (fold F)', () => {
  it('utility json-format: success', async () => {
    const { io, state } = createFakeIo({ stdin: '{"a":1}' });
    await runUtilityCommand(
      { utilityId: 'json-format', options: [], json: true, quiet: false },
      io
    );
    expect(JSON.parse(state.stdout)).toMatchSnapshot();
  });

  it('utility json-format: failure', async () => {
    const { io, state } = createFakeIo({ stdin: 'not json' });
    await runUtilityCommand(
      { utilityId: 'json-format', options: [], json: true, quiet: false },
      io
    );
    const parsed = JSON.parse(state.stdout) as Record<string, unknown>;
    // The `detail` field carries the platform-specific JSON.parse
    // diagnostic. Strip it so the snapshot stays stable across Node
    // versions while still locking the envelope shape.
    const stable = { ...parsed, detail: '<stripped>' };
    expect(stable).toMatchSnapshot();
  });

  it('utility base64-encode: success', async () => {
    const { io, state } = createFakeIo({ stdin: 'hello' });
    await runUtilityCommand(
      { utilityId: 'base64-encode', options: [], json: true, quiet: false },
      io
    );
    expect(JSON.parse(state.stdout)).toMatchSnapshot();
  });

  it('utility base64-decode: success', async () => {
    const { io, state } = createFakeIo({ stdin: 'aGVsbG8=' });
    await runUtilityCommand(
      { utilityId: 'base64-decode', options: [], json: true, quiet: false },
      io
    );
    expect(JSON.parse(state.stdout)).toMatchSnapshot();
  });

  it('utility url-parse: success', async () => {
    const { io, state } = createFakeIo({
      stdin: 'https://example.com:8080/path?x=1&y=2#hash',
    });
    await runUtilityCommand(
      { utilityId: 'url-parse', options: [], json: true, quiet: false },
      io
    );
    expect(JSON.parse(state.stdout)).toMatchSnapshot();
  });

  it('utility regex-replace: success', async () => {
    const { io, state } = createFakeIo({ stdin: 'abc123def' });
    await runUtilityCommand(
      {
        utilityId: 'regex-replace',
        options: [
          { key: 'pattern', value: '\\d+' },
          { key: 'flags', value: 'g' },
          { key: 'replacement', value: 'N' },
        ],
        json: true,
        quiet: false,
      },
      io
    );
    expect(JSON.parse(state.stdout)).toMatchSnapshot();
  });

  it('utility diff-text: success', async () => {
    const { io, state } = createFakeIo({ stdin: 'line2' });
    await runUtilityCommand(
      {
        utilityId: 'diff-text',
        options: [
          { key: 'baseline', value: 'line1' },
          { key: 'mode', value: 'unified' },
        ],
        json: true,
        quiet: false,
      },
      io
    );
    expect(JSON.parse(state.stdout)).toMatchSnapshot();
  });

  it('capsule validate: success', async () => {
    const validJson = JSON.stringify(FIXTURE_MINIMAL_JS);
    const { io, state } = createFakeIo({ files: { '/tmp/c.json': validJson } });
    await runValidateCapsuleCommand(
      { filePath: '/tmp/c.json', json: true, quiet: false },
      io
    );
    const parsed = JSON.parse(state.stdout) as Record<string, unknown>;
    // Strip the duration-sensitive summary so the snapshot stays
    // stable across runs.
    const stable = { ...parsed, summary: '<stripped>' };
    expect(stable).toMatchSnapshot();
  });

  it('capsule validate: invalid-json failure', async () => {
    const { io, state } = createFakeIo({ files: { '/tmp/bad.json': '{' } });
    await runValidateCapsuleCommand(
      { filePath: '/tmp/bad.json', json: true, quiet: false },
      io
    );
    const parsed = JSON.parse(state.stdout) as Record<string, unknown>;
    // Strip the parser-specific detail string.
    const stable = { ...parsed, detail: '<stripped>' };
    expect(stable).toMatchSnapshot();
  });
});
