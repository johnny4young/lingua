import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../..');
const componentsRoot = path.join(repoRoot, 'src/renderer/components');
const keyboardOwnedFileInput =
  'src/renderer/components/ui/FileDropZone.tsx';

interface FileInputRecord {
  readonly file: string;
  readonly classes: ReadonlyArray<string>;
}

function walkTsxFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...walkTsxFiles(absolute));
    } else if (entry.endsWith('.tsx')) {
      files.push(absolute);
    }
  }
  return files;
}

function collectFileInputs(): FileInputRecord[] {
  const records: FileInputRecord[] = [];

  for (const absolute of walkTsxFiles(componentsRoot)) {
    const source = readFileSync(absolute, 'utf8');
    const sourceFile = ts.createSourceFile(
      absolute,
      source,
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TSX
    );
    const visit = (node: ts.Node) => {
      if (
        ts.isJsxSelfClosingElement(node) &&
        node.tagName.getText(sourceFile) === 'input'
      ) {
        const attributes = new Map(
          node.attributes.properties
            .filter(ts.isJsxAttribute)
            .map((attribute) => [attribute.name.getText(sourceFile), attribute])
        );
        const type = attributes.get('type')?.initializer;
        if (type && ts.isStringLiteral(type) && type.text === 'file') {
          const className = attributes.get('className')?.initializer;
          const classes =
            className && ts.isStringLiteral(className)
              ? className.text.split(/\s+/u).filter(Boolean)
              : [];
          records.push({
            file: path.relative(repoRoot, absolute).split(path.sep).join('/'),
            classes,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return records;
}

describe('native file input accessibility policy', () => {
  it('keeps programmatic inputs out of the focus order', () => {
    const records = collectFileInputs();
    expect(records.length).toBeGreaterThanOrEqual(9);

    expect(
      records
        .filter((record) => record.classes.includes('sr-only'))
        .map((record) => record.file)
    ).toEqual([keyboardOwnedFileInput]);

    for (const record of records) {
      if (record.file === keyboardOwnedFileInput) continue;
      expect(
        record.classes,
        `${record.file} exposes a native file control beside its visible picker button`
      ).toContain('hidden');
    }
  });

  it('preserves the label-owned drop zone as a keyboard target', () => {
    const source = readFileSync(path.join(repoRoot, keyboardOwnedFileInput), 'utf8');
    expect(source).toContain('<label');
    expect(source).toContain('htmlFor={inputId}');
    expect(source).toContain('className="sr-only"');
  });
});
