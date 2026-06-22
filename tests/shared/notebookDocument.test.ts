/**
 * RL-043 Slice E — `.linguanb` native notebook document round-trip +
 * reject coverage. Pins the lossless serialize/parse contract, the
 * closed-enum rejects, the detect probe, and the execution-order
 * (fold B) sanitization.
 */

import { describe, expect, it } from 'vitest';
import {
  detectLinguanbDocument,
  parseNotebookDocument,
  serializeNotebookDocument,
  MAX_LINGUANB_BYTES,
} from '../../src/shared/notebookDocument';
import type { NotebookCellV1, NotebookV1 } from '../../src/shared/notebook';

function notebook(cells: NotebookCellV1[]): NotebookV1 {
  return {
    version: 1,
    id: 'nb-test',
    title: 'My Notebook',
    createdAt: '2026-06-20T00:00:00.000Z',
    cells,
  };
}

const SAMPLE_CELLS: NotebookCellV1[] = [
  { kind: 'markdown', id: 'm1', source: '# Title' },
  {
    kind: 'code',
    id: 'c1',
    language: 'typescript',
    source: 'const x: number = 1;',
    outputs: [{ kind: 'text', stream: 'stdout', text: '1' }],
  },
  {
    kind: 'code',
    id: 'c2',
    language: 'javascript',
    source: 'console.log(2)',
    outputs: [],
  },
];

describe('serializeNotebookDocument / parseNotebookDocument', () => {
  it('round-trips a notebook losslessly (ids, language, outputs, metadata)', () => {
    const original = notebook(SAMPLE_CELLS);
    const json = serializeNotebookDocument(original);
    const outcome = parseNotebookDocument(json);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.document.notebook).toEqual(original);
    // Per-cell language (incl. TS) + ids + outputs survive verbatim.
    const code = outcome.document.notebook.cells.filter((c) => c.kind === 'code');
    expect(code.map((c) => c.id)).toEqual(['c1', 'c2']);
    if (code[0]?.kind === 'code') expect(code[0].language).toBe('typescript');
    if (code[0]?.kind === 'code') {
      expect(code[0].outputs).toEqual([{ kind: 'text', stream: 'stdout', text: '1' }]);
    }
  });

  it('carries the format + documentVersion markers', () => {
    const doc = JSON.parse(serializeNotebookDocument(notebook(SAMPLE_CELLS)));
    expect(doc.format).toBe('linguanb');
    expect(doc.documentVersion).toBe(1);
    expect(doc.notebook.title).toBe('My Notebook');
  });

  it('fold B — round-trips the execution-order map, sanitized to cells + positive ints', () => {
    const json = serializeNotebookDocument(notebook(SAMPLE_CELLS), {
      executionOrder: { c1: 2, c2: 1, ghost: 9, c1bad: -3 },
    });
    const parsed = JSON.parse(json);
    // Unknown cell ids dropped on serialize.
    expect(parsed.executionOrder).toEqual({ c1: 2, c2: 1 });
    const outcome = parseNotebookDocument(json);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.document.executionOrder).toEqual({ c1: 2, c2: 1 });
  });

  it('omits executionOrder entirely when empty', () => {
    const parsed = JSON.parse(serializeNotebookDocument(notebook(SAMPLE_CELLS)));
    expect('executionOrder' in parsed).toBe(false);
  });

  it('rejects malformed JSON', () => {
    const outcome = parseNotebookDocument('{"format":"linguanb",');
    expect(outcome).toEqual({ ok: false, reason: 'malformed-json' });
  });

  it('rejects a non-linguanb envelope as invalid-shape', () => {
    const outcome = parseNotebookDocument(
      JSON.stringify({ documentVersion: 1, notebook: notebook([]) })
    );
    expect(outcome).toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('rejects a future documentVersion as wrong-version', () => {
    const outcome = parseNotebookDocument(
      JSON.stringify({ format: 'linguanb', documentVersion: 2, notebook: notebook([]) })
    );
    expect(outcome).toEqual({ ok: false, reason: 'wrong-version' });
  });

  it('rejects a missing documentVersion as invalid-shape, not wrong-version', () => {
    const outcome = parseNotebookDocument(
      JSON.stringify({ format: 'linguanb', notebook: notebook([]) })
    );
    expect(outcome).toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('maps a future INNER notebook version to wrong-version', () => {
    const outcome = parseNotebookDocument(
      JSON.stringify({
        format: 'linguanb',
        documentVersion: 1,
        notebook: { version: 2, id: 'x', title: 't', cells: [] },
      })
    );
    expect(outcome).toEqual({ ok: false, reason: 'wrong-version' });
  });

  it('maps a malformed INNER notebook to invalid-shape', () => {
    const outcome = parseNotebookDocument(
      JSON.stringify({
        format: 'linguanb',
        documentVersion: 1,
        notebook: { version: 1, id: '', title: 't', cells: [] },
      })
    );
    expect(outcome).toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('rejects an oversized source before parsing', () => {
    const huge = `{"format":"linguanb","x":"${'a'.repeat(MAX_LINGUANB_BYTES)}"}`;
    expect(parseNotebookDocument(huge)).toEqual({ ok: false, reason: 'oversized' });
  });

  it('round-trips an empty-cells notebook', () => {
    const outcome = parseNotebookDocument(serializeNotebookDocument(notebook([])));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.document.notebook.cells).toEqual([]);
  });
});

describe('detectLinguanbDocument', () => {
  it('claims a document with the format marker', () => {
    expect(detectLinguanbDocument(serializeNotebookDocument(notebook(SAMPLE_CELLS)))).toBe(true);
  });

  it('does NOT claim a Jupyter .ipynb (no format marker, has nbformat)', () => {
    expect(
      detectLinguanbDocument('{"nbformat":4,"cells":[{"cell_type":"code","source":[]}]}')
    ).toBe(false);
  });

  it('does NOT claim a bare NotebookV1 without the envelope marker', () => {
    expect(detectLinguanbDocument(JSON.stringify(notebook(SAMPLE_CELLS)))).toBe(false);
  });

  it('does NOT claim cURL / plain text / non-JSON', () => {
    expect(detectLinguanbDocument('curl https://x.dev')).toBe(false);
    expect(detectLinguanbDocument('format: linguanb but not json')).toBe(false);
  });
});
