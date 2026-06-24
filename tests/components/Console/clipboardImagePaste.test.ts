import { describe, it, expect } from 'vitest';
import {
  extractClipboardImageFile,
  readPastedImageFile,
  readClipboardImage,
  MAX_PASTED_IMAGE_BYTES,
} from '../../../src/renderer/components/Console/clipboardImagePaste';

/**
 * Build a synthetic `DataTransfer`-shaped object the helper can read.
 * jsdom's real DataTransfer is too thin for `items`/`getAsFile`, so we
 * mimic only the surface `extractClipboardImageFile` touches.
 */
function fakeClipboard(opts: {
  items?: Array<{ kind: string; type: string; file: File | null }>;
  files?: File[];
}): DataTransfer {
  const items = (opts.items ?? []).map((it) => ({
    kind: it.kind,
    type: it.type,
    getAsFile: () => it.file,
  }));
  return {
    items: items as unknown as DataTransferItemList,
    files: (opts.files ?? []) as unknown as FileList,
  } as unknown as DataTransfer;
}

const pngFile = (bytes = 8, type = 'image/png') =>
  new File([new Uint8Array(bytes)], 'paste.png', { type });

describe('extractClipboardImageFile', () => {
  it('returns null for null / empty clipboard', () => {
    expect(extractClipboardImageFile(null)).toBeNull();
    expect(extractClipboardImageFile(fakeClipboard({}))).toBeNull();
  });

  it('returns null when the only item is text', () => {
    const data = fakeClipboard({
      items: [{ kind: 'string', type: 'text/plain', file: null }],
    });
    expect(extractClipboardImageFile(data)).toBeNull();
  });

  it('returns the first image File from items', () => {
    const file = pngFile();
    const data = fakeClipboard({
      items: [
        { kind: 'string', type: 'text/plain', file: null },
        { kind: 'file', type: 'image/png', file },
      ],
    });
    expect(extractClipboardImageFile(data)).toBe(file);
  });

  it('falls back to files[] when items are absent', () => {
    const file = pngFile();
    const data = fakeClipboard({ files: [file] });
    expect(extractClipboardImageFile(data)).toBe(file);
  });
});

describe('readPastedImageFile', () => {
  it('falls back to too-large when an over-cap image cannot be resized to fit', async () => {
    const big = pngFile(MAX_PASTED_IMAGE_BYTES + 1);
    // Inject a resize that cannot fit the cap (the real canvas resize is
    // DOM-only; the e2e covers the success path in Chromium).
    const result = await readPastedImageFile(big, async () => null);
    expect(result).toEqual({
      ok: false,
      reason: 'too-large',
      byteLength: MAX_PASTED_IMAGE_BYTES + 1,
    });
  });

  it('falls back to too-large instead of throwing when the resize path fails', async () => {
    const big = pngFile(MAX_PASTED_IMAGE_BYTES + 1);
    await expect(
      readPastedImageFile(big, async () => {
        throw new Error('canvas failed');
      })
    ).resolves.toEqual({
      ok: false,
      reason: 'too-large',
      byteLength: MAX_PASTED_IMAGE_BYTES + 1,
    });
  });

  it('downscales an over-cap image to fit and flags it resized', async () => {
    const big = pngFile(MAX_PASTED_IMAGE_BYTES + 1);
    const result = await readPastedImageFile(big, async () => ({
      dataUri: 'data:image/jpeg;base64,/9j/resized',
      mime: 'image/jpeg',
      byteLength: 1234,
    }));
    expect(result).toEqual({
      ok: true,
      dataUri: 'data:image/jpeg;base64,/9j/resized',
      mime: 'image/jpeg',
      byteLength: 1234,
      resized: true,
    });
  });

  it('does not attempt a resize for an image already within the cap', async () => {
    let resizeCalls = 0;
    const result = await readPastedImageFile(pngFile(16), async () => {
      resizeCalls += 1;
      return null;
    });
    expect(resizeCalls).toBe(0);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resized).toBeUndefined();
  });

  it('reads a small image into a validated data:image URI', async () => {
    const result = await readPastedImageFile(pngFile(16));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dataUri.startsWith('data:image/')).toBe(true);
      expect(result.mime).toBe('image/png');
      expect(result.byteLength).toBe(16);
    }
  });

  it('rejects a non-image blob as unreadable (validateImageSrc gate)', async () => {
    const textFile = new File([new Uint8Array(4)], 'note.txt', {
      type: 'text/plain',
    });
    const result = await readPastedImageFile(textFile);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unreadable');
  });
});

describe('readClipboardImage', () => {
  it('returns no-image (telemetry-silent) when the clipboard has no image', async () => {
    const result = await readClipboardImage(
      fakeClipboard({ items: [{ kind: 'string', type: 'text/plain', file: null }] })
    );
    expect(result).toEqual({ ok: false, reason: 'no-image' });
  });

  it('reads a clipboard image end to end', async () => {
    const result = await readClipboardImage(
      fakeClipboard({ items: [{ kind: 'file', type: 'image/png', file: pngFile(16) }] })
    );
    expect(result.ok).toBe(true);
  });
});
