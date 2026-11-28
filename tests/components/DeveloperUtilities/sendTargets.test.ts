import { describe, expect, it } from 'vitest';
import { describeOutput, readSendTargets } from '../../../src/renderer/components/DeveloperUtilities/sendTargets';

const ids = async (output: string, exclude?: Parameters<typeof readSendTargets>[1]) =>
  (await readSendTargets(output, exclude)).map((target) => target.utilityId);

describe('send targets', () => {
  it('ranks a JSON output as hash, Base64 and minify', async () => {
    expect(await ids('{\n  "sub": "user_42",\n  "role": "admin"\n}')).toEqual(['hash', 'base64-encode', 'json-minify']);
  });

  it('leads with the decoder for an encoded value', async () => {
    expect((await ids('a%20b'))[0]).toBe('url-decode');
    expect((await ids(btoa('hello there')))[0]).toBe('base64-decode');
  });

  it('skips the excluded adapter and any that hand the output back unchanged', async () => {
    // A hex digest: URL encoding and slugify change nothing.
    const targets = await ids('9e81e946881a37e0', 'hash');
    expect(targets).not.toContain('hash');
    expect(targets).not.toContain('url-encode');
    expect(targets).toHaveLength(3);
  });

  it('previews what the adapter answers', async () => {
    const [hash, base64] = await readSendTargets('{"a":1}');
    expect(hash).toMatchObject({ utilityId: 'hash', tag: 'text·64' });
    expect(hash!.preview).toMatch(/^[0-9a-f]{6}…[0-9a-f]{4}$/);
    expect(base64).toMatchObject({ utilityId: 'base64-encode', tag: 'text·12', preview: '"eyJhIjo…"' });
    expect(describeOutput('json-format', '{\n  "a": 1,\n  "b": 2\n}')).toEqual({ tag: 'object·2', preview: '{ "a": …' });
  });

  it('stops between batches once aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await readSendTargets('plain words', undefined, controller.signal)).toEqual([]);
  });

  it('keeps the ranking but reads no previews for an empty output', async () => {
    const targets = await readSendTargets('');
    expect(targets.map((target) => target.utilityId)).toEqual(['hash', 'base64-encode', 'url-encode']);
    expect(targets.every((target) => target.preview === null && target.tag === null)).toBe(true);
  });
});
