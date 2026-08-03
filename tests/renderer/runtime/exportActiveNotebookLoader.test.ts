import { describe, expect, it, vi } from 'vitest';
import {
  createActiveNotebookExporterLoader,
  type ActiveNotebookExporterModule,
} from '../../../src/renderer/runtime/exportActiveNotebookLoader';

const exporterModule = {
  exportActiveNotebookAsLinguanb: vi.fn(),
} as unknown as ActiveNotebookExporterModule;

describe('active notebook exporter loader', () => {
  it('shares concurrent imports and caches the fulfilled exporter', async () => {
    const importExporter = vi.fn().mockResolvedValue(exporterModule);
    const loader = createActiveNotebookExporterLoader(importExporter);

    const first = loader.load();
    const second = loader.load();

    expect(first).toBe(second);
    await expect(first).resolves.toBe(exporterModule);
    await expect(loader.load()).resolves.toBe(exporterModule);
    expect(importExporter).toHaveBeenCalledTimes(1);
  });

  it('evicts a rejected import so a later export can retry', async () => {
    const error = new Error('chunk unavailable');
    const importExporter = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(exporterModule);
    const loader = createActiveNotebookExporterLoader(importExporter);

    await expect(loader.load()).rejects.toBe(error);
    await expect(loader.load()).resolves.toBe(exporterModule);
    expect(importExporter).toHaveBeenCalledTimes(2);
  });
});
