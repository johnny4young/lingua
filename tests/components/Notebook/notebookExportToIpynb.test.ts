/**
 * RL-043 Slice D — `.ipynb` export serializer + round-trip against the
 * RL-100 importer (fold A) with per-cell language preservation (fold B)
 * and execution-count (fold C).
 */

import { describe, it, expect } from 'vitest';
import { exportNotebookAsIpynb } from '../../../src/renderer/components/Notebook/notebookExportToIpynb';
import { ipynbImporterAdapter } from '../../../src/shared/importers/ipynbImporter';
import type {
  IpynbImporterPreview,
} from '../../../src/shared/importers/ipynbImporter';
import type { NotebookCellV1, NotebookV1 } from '../../../src/shared/notebook';

function makeNotebook(cells: NotebookCellV1[]): NotebookV1 {
  return {
    version: 1,
    id: 'nb-test',
    title: 'My Notebook',
    createdAt: '2026-06-20T00:00:00.000Z',
    cells,
  };
}

describe('exportNotebookAsIpynb', () => {
  it('serializes code + markdown cells to nbformat v4', () => {
    const result = exportNotebookAsIpynb(
      makeNotebook([
        { kind: 'markdown', id: 'm1', source: '# Title\nHello' },
        {
          kind: 'code',
          id: 'c1',
          language: 'typescript',
          source: 'const x: number = 1;',
          outputs: [{ kind: 'text', stream: 'stdout', text: '1' }],
        },
      ])
    );
    const doc = JSON.parse(result.json);
    expect(doc.nbformat).toBe(4);
    expect(doc.cells).toHaveLength(2);
    expect(doc.cells[0].cell_type).toBe('markdown');
    expect(doc.cells[0].id).toBe('m1');
    expect(doc.cells[1].cell_type).toBe('code');
    expect(doc.cells[1].id).toBe('c1');
    expect(doc.cells[1].source.join('')).toBe('const x: number = 1;');
    // Fold B — per-cell language stashed in private metadata.
    expect(doc.cells[1].metadata.lingua.language).toBe('typescript');
    expect(doc.cells[1].outputs[0]).toMatchObject({
      output_type: 'stream',
      name: 'stdout',
    });
    expect(doc.metadata.kernelspec.language).toBe('typescript');
    expect(doc.metadata.lingua.exportedFrom).toBe('lingua');
    expect(result.suggestedFileName).toBe('my-notebook.ipynb');
  });

  it('multi-line source becomes an nbformat line array (newline-terminated except last)', () => {
    const result = exportNotebookAsIpynb(
      makeNotebook([
        { kind: 'code', id: 'c1', language: 'javascript', source: 'a\nb\nc', outputs: [] },
      ])
    );
    const doc = JSON.parse(result.json);
    expect(doc.cells[0].source).toEqual(['a\n', 'b\n', 'c']);
  });

  it('fold C — exports execution_count from the [N] map, null when unknown', () => {
    const stamped = JSON.parse(
      exportNotebookAsIpynb(
        makeNotebook([
          { kind: 'code', id: 'c1', language: 'javascript', source: 'x', outputs: [] },
        ]),
        { executionOrder: { c1: 3 } }
      ).json
    );
    expect(stamped.cells[0].execution_count).toBe(3);
    const unstamped = JSON.parse(
      exportNotebookAsIpynb(
        makeNotebook([
          { kind: 'code', id: 'c1', language: 'javascript', source: 'x', outputs: [] },
        ])
      ).json
    );
    expect(unstamped.cells[0].execution_count).toBeNull();
  });

  it('fold A + B — round-trips through the importer, preserving mixed per-cell languages', () => {
    const original = makeNotebook([
      { kind: 'code', id: 'c1', language: 'javascript', source: 'const a = 1;', outputs: [] },
      {
        kind: 'code',
        id: 'c2',
        language: 'typescript',
        source: 'const b: number = 2;',
        outputs: [],
      },
      { kind: 'markdown', id: 'm1', source: '# Notes' },
    ]);
    const json = exportNotebookAsIpynb(original).json;
    const outcome = ipynbImporterAdapter.preview(json);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    const cells = preview.notebook.cells;
    expect(cells.map((c) => c.kind)).toEqual(['code', 'code', 'markdown']);
    expect(cells.map((c) => c.id)).toEqual(['c1', 'c2', 'm1']);
    const code = cells.filter((c) => c.kind === 'code');
    // Fold B — the kernelspec is single-language, but the per-cell
    // metadata kept c2 as TypeScript across the round-trip.
    if (code[0]?.kind === 'code') expect(code[0].language).toBe('javascript');
    if (code[1]?.kind === 'code') expect(code[1].language).toBe('typescript');
    if (code[0]?.kind === 'code') expect(code[0].source).toBe('const a = 1;');
  });

  it('round-trips stdout/stderr stream outputs', () => {
    const json = exportNotebookAsIpynb(
      makeNotebook([
        {
          kind: 'code',
          id: 'c1',
          language: 'javascript',
          source: 'console.log(1)',
          outputs: [
            { kind: 'text', stream: 'stdout', text: 'hello' },
            { kind: 'text', stream: 'stderr', text: 'oops' },
          ],
        },
      ])
    ).json;
    const outcome = ipynbImporterAdapter.preview(json);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    const cell = preview.notebook.cells.find((c) => c.kind === 'code');
    if (cell?.kind !== 'code') throw new Error('expected a code cell');
    expect(cell.outputs.find((o) => o.stream === 'stdout')?.text).toBe('hello');
    expect(cell.outputs.find((o) => o.stream === 'stderr')?.text).toBe('oops');
  });

  it('exports a markdown-only notebook as valid nbformat the importer accepts', () => {
    const json = exportNotebookAsIpynb(
      makeNotebook([{ kind: 'markdown', id: 'm1', source: 'just notes' }])
    ).json;
    expect(ipynbImporterAdapter.detect(json)).toBe(true);
    const outcome = ipynbImporterAdapter.preview(json);
    expect(outcome.ok).toBe(true);
  });
});
