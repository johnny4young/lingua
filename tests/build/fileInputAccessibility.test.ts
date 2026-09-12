import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSourceFile, walk } from '../__fixtures__/sourceAst';

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
    const relative = path.relative(repoRoot, absolute).split(path.sep).join('/');
    const parsed = parseSourceFile(absolute, relative);

    walk(parsed.program, (node) => {
      // Only self-closing `<input />`, as the TypeScript-based version of
      // this scan matched. A `<input type="file"></input>` would slip past
      // both; that gap predates the parser swap and is left as it was.
      if (node.type !== 'JSXElement' || !node.openingElement.selfClosing) return;
      const tag = node.openingElement.name;
      if (tag.type !== 'JSXIdentifier' || tag.name !== 'input') return;

      const attributes = new Map(
        node.openingElement.attributes.flatMap((attribute) =>
          attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier'
            ? [[attribute.name.name, attribute.value] as const]
            : []
        )
      );
      const type = attributes.get('type');
      // `type={'file'}` is a JSXExpressionContainer, not a Literal — the
      // TypeScript scan skipped it too, so the shapes stay aligned.
      if (type?.type !== 'Literal' || type.value !== 'file') return;

      const className = attributes.get('className');
      const classes =
        className?.type === 'Literal' && typeof className.value === 'string'
          ? className.value.split(/\s+/u).filter(Boolean)
          : [];
      records.push({ file: relative, classes });
    });
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
