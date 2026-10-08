import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCapsuleWorkspace,
  parseCapsuleWorkspace,
  verifyCapsuleWorkspaceFiles,
} from '../../src/shared/capsuleWorkspace';
import { FIXTURE_FULL_TS } from './runCapsule.fixtures';

const hash = (content: string) => createHash('sha256').update(content, 'utf8').digest('hex');
async function workspace(content = 'original') {
  const built = await buildCapsuleWorkspace(FIXTURE_FULL_TS, [
    { path: 'src/helper.ts', language: 'typescript', content },
  ]);
  if (!built.ok) throw new Error(built.reason);
  // Exercise the existing exporter serialization and unchanged import parser.
  // Verification covers the decoded text, never the original on-disk bytes.
  const parsed = parseCapsuleWorkspace(built.json);
  if (!parsed.ok) throw new Error(parsed.reason);
  expect(parsed.value.files[0]!.content).toBe(content);
  expect(parsed.value.files[0]!.contentHash).toBe(built.value.files[0]!.contentHash);
  return parsed.value;
}
afterEach(() => vi.unstubAllGlobals());

describe('Capsule Workspace attached-file integrity', () => {
  it.each([
    '',
    'plain ASCII',
    '漢字😀é',
    '\uFEFFtext',
    'line\nnext\n',
    'line\r\nnext\r\n',
    'line\rnext',
    'e\u0301',
    '\u00e9',
    '\u0000',
    '\ud800',
    '\udc00',
  ])('verifies exact UTF-8 encoding without normalization: %j', async content => {
    const value = await workspace(content);
    expect(value.files[0]!.contentHash).toBe(hash(content));
    expect(await verifyCapsuleWorkspaceFiles(value)).toEqual([
      { path: 'src/helper.ts', status: 'verified' },
    ]);
    expect(value.files[0]!.content).toBe(content);
  });
  it.each([
    ['original', 'changed'],
    ['\uFEFFtext', 'text'],
    ['a\r\nb', 'a\nb'],
    ['e\u0301', '\u00e9'],
    ['text', ''],
    ['', 'text'],
  ])('reports changed content %j → %j', async (original, changed) => {
    const value = await workspace(original);
    const altered = { ...value, files: [{ ...value.files[0]!, content: changed }] };
    expect(parseCapsuleWorkspace(JSON.stringify(altered)).ok).toBe(true);
    expect(await verifyCapsuleWorkspaceFiles(altered)).toEqual([
      { path: 'src/helper.ts', status: 'mismatch' },
    ]);
  });
  it('reports a well-formed incorrect declared hash', async () => {
    const value = await workspace();
    expect(
      await verifyCapsuleWorkspaceFiles({
        ...value,
        files: [{ ...value.files[0]!, contentHash: '0'.repeat(64) }],
      })
    ).toEqual([{ path: 'src/helper.ts', status: 'mismatch' }]);
  });
  it('keeps missing hashes invalid under the existing v1 contract', async () => {
    const value = await workspace();
    const { contentHash: _hash, ...file } = value.files[0]!;
    expect(parseCapsuleWorkspace(JSON.stringify({ ...value, files: [file] }))).toMatchObject({
      ok: false,
      reason: 'invalid-shape',
    });
  });
  it('reports unavailable crypto without implying success', async () => {
    const value = await workspace();
    vi.stubGlobal('crypto', undefined);
    expect(await verifyCapsuleWorkspaceFiles(value)).toEqual([
      { path: 'src/helper.ts', status: 'not-verified' },
    ]);
  });
  it('continues independently after one digest failure and preserves file order', async () => {
    const value = await workspace();
    const digest = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockImplementation((algorithm, bytes) => webcrypto.subtle.digest(algorithm, bytes));
    vi.stubGlobal('crypto', { subtle: { digest } });
    expect(
      await verifyCapsuleWorkspaceFiles({
        ...value,
        files: [value.files[0]!, { ...value.files[0]!, path: 'second.ts' }],
      })
    ).toEqual([
      { path: 'src/helper.ts', status: 'not-verified' },
      { path: 'second.ts', status: 'verified' },
    ]);
  });
  it('accepts the existing 24-file limit and preserves portable file identity', async () => {
    const built = await buildCapsuleWorkspace(
      FIXTURE_FULL_TS,
      Array.from({ length: 24 }, (_, i) => ({
        path: `src/file-${i}.txt`,
        language: 'text',
        content: i % 2 ? '漢😀' : '',
      }))
    );
    if (!built.ok) throw new Error(built.reason);
    const result = await verifyCapsuleWorkspaceFiles(built.value);
    expect(result).toEqual(
      built.value.files.map(file => ({ path: file.path, status: 'verified' }))
    );
  });
  it.each([
    { path: '../notes.txt', reason: 'invalid-path' },
    { path: '/notes.txt', reason: 'invalid-path' },
    { path: 'src\\notes.txt', reason: 'invalid-path' },
  ])('continues rejecting invalid paths: $path', async ({ path, reason }) => {
    const value = await workspace();
    expect(
      parseCapsuleWorkspace(JSON.stringify({ ...value, files: [{ ...value.files[0]!, path }] }))
    ).toMatchObject({ ok: false, reason });
  });
  it('continues rejecting duplicate paths and UTF-8 size overflow before hashing', async () => {
    const value = await workspace();
    const file = value.files[0]!;
    expect(
      parseCapsuleWorkspace(
        JSON.stringify({ ...value, files: [file, { ...file, path: file.path.toUpperCase() }] })
      )
    ).toMatchObject({ ok: false, reason: 'duplicate-path' });
    expect(
      parseCapsuleWorkspace(
        JSON.stringify({ ...value, files: [{ ...file, content: '😀'.repeat(65537) }] })
      )
    ).toMatchObject({ ok: false, reason: 'file-too-large' });
  });
  it('snapshots all file text and declarations before awaiting digests', async () => {
    const value = await workspace();
    const files = [{ ...value.files[0]! }, { ...value.files[0]!, path: 'second.ts' }];
    let resume!: (digest: ArrayBuffer) => void;
    const digest = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ArrayBuffer>(resolve => {
            resume = resolve;
          })
      )
      .mockImplementation((algorithm, bytes) => webcrypto.subtle.digest(algorithm, bytes));
    vi.stubGlobal('crypto', { subtle: { digest } });
    const pending = verifyCapsuleWorkspaceFiles({ ...value, files });
    files[1]!.content = 'changed after verification started';
    resume(await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('original')));
    expect(await pending).toEqual([
      { path: 'src/helper.ts', status: 'verified' },
      { path: 'second.ts', status: 'verified' },
    ]);
  });
});
