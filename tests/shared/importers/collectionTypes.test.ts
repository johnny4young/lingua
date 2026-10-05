import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_COLLECTION_BYTES, MAX_IMPORT_REQUESTS } from '../../../src/shared/importers/collectionTypes';
import { MAX_COLLECTION_BYTES as postmanBytes, MAX_IMPORT_REQUESTS as postmanRequests } from '../../../src/shared/importers/postmanImporter';

const root = resolve(__dirname, '../../..');

describe('collection contract ownership', () => {
  it('keeps compatible caps without a format-parser dependency in the contract leaf', () => {
    expect(MAX_COLLECTION_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_IMPORT_REQUESTS).toBe(100);
    expect(postmanBytes).toBe(MAX_COLLECTION_BYTES);
    expect(postmanRequests).toBe(MAX_IMPORT_REQUESTS);
    const leaf = readFileSync(resolve(root, 'src/shared/importers/collectionTypes.ts'), 'utf8');
    expect(leaf).not.toMatch(/from ['"][^'"]*(?:postmanImporter|brunoImporter)['"]/u);
  });

  it('routes Bruno and generic preview contracts to the format-neutral leaf', () => {
    for (const file of [
      'src/shared/importers/brunoImporter.ts',
      'src/renderer/hooks/brunoDirectoryImport.ts',
      'src/renderer/hooks/importPreviewModel.ts',
      'src/renderer/hooks/importPreviewConfirm.ts',
      'src/renderer/components/ImportPreview/ImportPreviewBody.tsx',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source, file).toMatch(/from ['"][^'"]*collectionTypes['"]/u);
      if (file.endsWith('brunoImporter.ts') || file.endsWith('brunoDirectoryImport.ts')) {
        expect(source, file).not.toMatch(/from ['"][^'"]*postmanImporter['"]/u);
      }
    }
  });
});
