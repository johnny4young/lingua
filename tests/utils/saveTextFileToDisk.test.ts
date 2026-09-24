import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveOrDownloadTextFile } from '../../src/renderer/utils/saveTextFileToDisk';

const originalLingua = window.lingua;

afterEach(() => {
  Object.defineProperty(window, 'lingua', { configurable: true, value: originalLingua });
});

describe('saveOrDownloadTextFile', () => {
  it('reports the file name chosen in the native save dialog', async () => {
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      value: {
        platform: 'darwin',
        fs: {
          saveDialog: vi.fn().mockResolvedValue({
            canceled: false,
            rootId: 'root-1',
            fileRelativePath: 'run 2.json',
          }),
          write: vi.fn().mockResolvedValue(true),
          revokeRoot: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
    const onOk = vi.fn();
    await saveOrDownloadTextFile('{}', 'lingua-run.capsule.json', 'application/json', {
      onOk,
      onError: vi.fn(),
    });
    expect(onOk).toHaveBeenCalledWith('run 2.json');
  });
});
