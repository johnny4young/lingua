/**
 * implementation — `.linguanb` importer adapter + registry detection
 * routing. Pins the lossless preview/import round-trip, the reject
 * mapping, and the critical ordering guard: a `.linguanb` (whose
 * envelope embeds an inner `"cells":` array) must route to the
 * linguanb adapter, NOT be stolen by the ipynb adapter's loose sniff.
 */

import { describe, expect, it } from 'vitest';
import {
  linguanbImporterAdapter,
  type LinguanbImporterPreview,
  type LinguanbImporterResult,
} from '../../../src/shared/importers/linguanbImporter';
import { detectImporter, getImporter } from '../../../src/shared/importers/registry';
import { serializeNotebookDocument } from '../../../src/shared/notebookDocument';
import type { NotebookCellV1, NotebookV1 } from '../../../src/shared/notebook';

function notebook(cells: NotebookCellV1[]): NotebookV1 {
  return {
    version: 1,
    id: 'nb-1',
    title: 'Demo',
    createdAt: '2026-06-20T00:00:00.000Z',
    cells,
  };
}

const CELLS: NotebookCellV1[] = [
  { kind: 'markdown', id: 'm1', source: '# Hi' },
  { kind: 'code', id: 'c1', language: 'typescript', source: 'const a: number = 1;', outputs: [] },
  { kind: 'code', id: 'c2', language: 'typescript', source: 'const b = 2;', outputs: [] },
];

function preview(source: string): LinguanbImporterPreview {
  const outcome = linguanbImporterAdapter.preview(source);
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error('expected ok preview');
  return outcome.preview as LinguanbImporterPreview;
}

describe('linguanbImporterAdapter — surface', () => {
  it('declares the canonical id + i18n keys', () => {
    expect(linguanbImporterAdapter.id).toBe('linguanb-notebook');
    expect(linguanbImporterAdapter.titleKey).toBe(
      'importPreview.importer.linguanbNotebook.title'
    );
    expect(linguanbImporterAdapter.descriptionKey).toBe(
      'importPreview.importer.linguanbNotebook.description'
    );
  });
});

describe('linguanbImporterAdapter.preview', () => {
  it('builds a lossless preview (counts, dominant language, title, no warnings)', () => {
    const p = preview(serializeNotebookDocument(notebook(CELLS)));
    expect(p.kind).toBe('linguanb-notebook');
    expect(p.title).toBe('Demo');
    expect(p.cellCounts).toEqual({ total: 3, code: 2, markdown: 1, droppedRaw: 0 });
    expect(p.dominantLanguage).toBe('typescript');
    expect(p.warnings).toEqual([]);
  });

  it('threads the execution-order map (implementation note)', () => {
    const p = preview(
      serializeNotebookDocument(notebook(CELLS), { executionOrder: { c1: 1, c2: 2 } })
    );
    expect(p.executionOrder).toEqual({ c1: 1, c2: 2 });
  });

  it('empty-input on blank source', () => {
    expect(linguanbImporterAdapter.preview('   ')).toEqual({ ok: false, reason: 'empty-input' });
  });

  it('maps malformed JSON to a malformed reject with the detail code', () => {
    const outcome = linguanbImporterAdapter.preview('{"format":"linguanb",');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed');
    expect(outcome.detail).toBe('malformed-json');
  });

  it('maps a future documentVersion to an unsupported-feature reject', () => {
    const outcome = linguanbImporterAdapter.preview(
      JSON.stringify({ format: 'linguanb', documentVersion: 2, notebook: notebook([]) })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unsupported-feature');
    expect(outcome.detail).toBe('wrong-version');
  });
});

describe('linguanbImporterAdapter.import', () => {
  it('round-trips the parsed notebook + execution order losslessly', () => {
    const original = notebook(CELLS);
    const p = preview(serializeNotebookDocument(original, { executionOrder: { c1: 1 } }));
    const result = linguanbImporterAdapter.import(p) as LinguanbImporterResult;
    expect(result.notebook).toEqual(original);
    expect(result.title).toBe('Demo');
    expect(result.dominantLanguage).toBe('typescript');
    expect(result.executionOrder).toEqual({ c1: 1 });
  });
});

describe('registry detection routing', () => {
  it('routes a .linguanb to the linguanb adapter, not ipynb', () => {
    const source = serializeNotebookDocument(notebook(CELLS));
    expect(detectImporter(source)).toBe('linguanb-notebook');
    expect(getImporter('linguanb-notebook')).toBe(linguanbImporterAdapter);
  });

  it('still routes a real .ipynb to the ipynb adapter', () => {
    const ipynb = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { language: 'python' } },
      cells: [{ cell_type: 'code', source: ["print('hi')"], outputs: [] }],
    });
    expect(detectImporter(ipynb)).toBe('ipynb-notebook');
  });
});
