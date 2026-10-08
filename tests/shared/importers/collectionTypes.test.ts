import { resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { MAX_COLLECTION_BYTES, MAX_IMPORT_REQUESTS } from '../../../src/shared/importers/collectionTypes';
import { MAX_COLLECTION_BYTES as postmanBytes, MAX_IMPORT_REQUESTS as postmanRequests } from '../../../src/shared/importers/postmanImporter';
import type {
  CollectionImporterPreview,
  CollectionImporterResult,
  ParsedCollectionRequest,
} from '../../../src/shared/importers/collectionTypes';
import type {
  CollectionImporterPreview as PostmanPreview,
  CollectionImporterResult as PostmanResult,
  ParsedCollectionRequest as PostmanRequest,
} from '../../../src/shared/importers/postmanImporter';
import { parseSourceFile } from '../../__fixtures__/sourceAst';

const root = resolve(__dirname, '../../..');

/** Every static module specifier a file depends on: imports and re-exports alike. */
function moduleSpecifiers(file: string): string[] {
  const { program } = parseSourceFile(resolve(root, file), file);
  return program.body.flatMap(statement => {
    if (statement.type === 'ImportDeclaration' || statement.type === 'ExportAllDeclaration') {
      return [statement.source.value];
    }
    if (statement.type === 'ExportNamedDeclaration' && statement.source) {
      return [statement.source.value];
    }
    return [];
  });
}

const endsWithModule = (name: string) => (specifier: string) =>
  specifier === `./${name}` || specifier.endsWith(`/${name}`);

describe('collection contract ownership', () => {
  // Checked by typecheck:tests as well as Vitest: the compatibility facade
  // must retain every moved type without changing the canonical leaf shape.
  it('preserves the Postman compatibility type exports', () => {
    expectTypeOf<PostmanRequest>().toEqualTypeOf<ParsedCollectionRequest>();
    expectTypeOf<PostmanPreview>().toEqualTypeOf<CollectionImporterPreview>();
    expectTypeOf<PostmanResult>().toEqualTypeOf<CollectionImporterResult>();
  });

  it('keeps compatible caps without a format-parser dependency in the contract leaf', () => {
    expect(MAX_COLLECTION_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_IMPORT_REQUESTS).toBe(100);
    expect(postmanBytes).toBe(MAX_COLLECTION_BYTES);
    expect(postmanRequests).toBe(MAX_IMPORT_REQUESTS);
    const leaf = moduleSpecifiers('src/shared/importers/collectionTypes.ts');
    expect(leaf.some(endsWithModule('postmanImporter'))).toBe(false);
    expect(leaf.some(endsWithModule('brunoImporter'))).toBe(false);
  });

  it('routes Bruno and generic preview contracts to the format-neutral leaf', () => {
    for (const file of [
      'src/shared/importers/brunoImporter.ts',
      'src/renderer/hooks/brunoDirectoryImport.ts',
      'src/renderer/hooks/importPreviewModel.ts',
      'src/renderer/hooks/importPreviewConfirm.ts',
      'src/renderer/components/ImportPreview/ImportPreviewBody.tsx',
    ]) {
      const specifiers = moduleSpecifiers(file);
      expect(specifiers.some(endsWithModule('collectionTypes')), file).toBe(true);
      if (file.endsWith('brunoImporter.ts') || file.endsWith('brunoDirectoryImport.ts')) {
        expect(specifiers.some(endsWithModule('postmanImporter')), file).toBe(false);
      }
    }
  });
});
