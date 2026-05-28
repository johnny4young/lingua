/**
 * RL-100 Slice 2 — `.ipynb` importer adapter coverage.
 *
 * Pins the closed-enum outcomes, the cell-mapping table, language
 * inference, the lossy-warning surface, and the rejection paths.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ipynbImporterAdapter,
  mapWarningToTelemetryKind,
  type IpynbImporterPreview,
  type IpynbImporterResult,
} from '../../../src/shared/importers/ipynbImporter';
import {
  parseNotebook,
  MAX_CELLS_PER_NOTEBOOK,
  MAX_NOTEBOOK_BYTES,
} from '../../../src/shared/notebook';

const FIXTURE_ROOT = resolve(__dirname, '../../fixtures/ipynb');

function loadFixture(name: string): string {
  return readFileSync(resolve(FIXTURE_ROOT, name), 'utf-8');
}

describe('ipynbImporterAdapter — surface', () => {
  it('declares the canonical id + i18n keys', () => {
    expect(ipynbImporterAdapter.id).toBe('ipynb-notebook');
    expect(ipynbImporterAdapter.titleKey).toBe(
      'importPreview.importer.ipynbNotebook.title'
    );
    expect(ipynbImporterAdapter.descriptionKey).toBe(
      'importPreview.importer.ipynbNotebook.description'
    );
  });
});

describe('ipynbImporterAdapter.detect', () => {
  it('claims a real Jupyter v4 payload', () => {
    expect(ipynbImporterAdapter.detect(loadFixture('hello-python.ipynb'))).toBe(true);
  });

  it('claims a stripped JSON that mentions nbformat near the start', () => {
    expect(
      ipynbImporterAdapter.detect('{ "nbformat": 4, "cells": [] }')
    ).toBe(true);
  });

  it('claims valid notebooks even when metadata pushes cells beyond the initial probe window', () => {
    const source = JSON.stringify({
      metadata: { title: 'x'.repeat(5_000) },
      nbformat: 4,
      cells: [],
    });

    expect(ipynbImporterAdapter.detect(source)).toBe(true);
  });

  it('rejects a cURL command', () => {
    expect(ipynbImporterAdapter.detect('curl https://example.com')).toBe(false);
  });

  it('rejects non-JSON / non-object input', () => {
    expect(ipynbImporterAdapter.detect('not json')).toBe(false);
    expect(ipynbImporterAdapter.detect('[1, 2, 3]')).toBe(false);
    expect(ipynbImporterAdapter.detect('')).toBe(false);
  });

  it('rejects an unrelated JSON shape', () => {
    expect(
      ipynbImporterAdapter.detect(JSON.stringify({ hello: 'world' }))
    ).toBe(false);
  });
});

describe('ipynbImporterAdapter.preview — happy paths', () => {
  it('maps a Python hello-world notebook with outputs', () => {
    const outcome = ipynbImporterAdapter.preview(
      loadFixture('hello-python.ipynb')
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    expect(preview.kind).toBe('ipynb-notebook');
    expect(preview.cellCounts.total).toBe(3);
    expect(preview.cellCounts.code).toBe(2);
    expect(preview.cellCounts.markdown).toBe(1);
    expect(preview.cellCounts.droppedRaw).toBe(0);
    expect(preview.dominantLanguage).toBe('python');
    // execute_result stripped warning is expected when execute_result fires.
    expect(preview.warnings).toContain('ipynb-execute-result-stripped');
  });

  it('drops raw cells with the closed-enum warning', () => {
    const outcome = ipynbImporterAdapter.preview(
      loadFixture('mixed-markdown.ipynb')
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    expect(preview.cellCounts.droppedRaw).toBe(1);
    expect(preview.warnings).toContain('ipynb-raw-cell-dropped');
    expect(preview.dominantLanguage).toBe('javascript');
  });

  it('drops rich (image/png) outputs and surfaces an error traceback as stderr', () => {
    const outcome = ipynbImporterAdapter.preview(
      loadFixture('with-outputs.ipynb')
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    expect(preview.warnings).toContain('ipynb-rich-output-dropped');
    const codeCells = preview.notebook.cells.filter((c) => c.kind === 'code');
    expect(codeCells).toHaveLength(1);
    const cell = codeCells[0]!;
    if (cell.kind !== 'code') throw new Error('expected code cell');
    const stderr = cell.outputs.find((o) => o.stream === 'stderr');
    expect(stderr?.text).toContain('ValueError');
  });

  it('warns when execution_count metadata is dropped even without execute_result output', () => {
    const outcome = ipynbImporterAdapter.preview(
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: { kernelspec: { language: 'python' } },
        cells: [
          {
            cell_type: 'code',
            execution_count: 7,
            source: ['print("hi")'],
            outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi\n' }],
          },
        ],
      })
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.preview.warnings).toContain(
      'ipynb-execute-result-stripped'
    );
  });

  it('inherits the kernelspec language for code cells', () => {
    const outcome = ipynbImporterAdapter.preview(
      loadFixture('hello-python.ipynb')
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    const code = preview.notebook.cells.find((c) => c.kind === 'code');
    if (!code || code.kind !== 'code') throw new Error('expected code cell');
    expect(code.language).toBe('python');
  });

  it('round-trips through parseNotebook', () => {
    const outcome = ipynbImporterAdapter.preview(
      loadFixture('hello-python.ipynb')
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = ipynbImporterAdapter.import(
      outcome.preview
    ) as IpynbImporterResult;
    expect(parseNotebook(result.notebook).ok).toBe(true);
  });
});

describe('ipynbImporterAdapter.preview — language inference', () => {
  function payload(language: unknown): string {
    return JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { language } },
      cells: [
        { cell_type: 'code', source: ['x = 1'], outputs: [] },
      ],
    });
  }

  it('maps "python3" alias to python', () => {
    const outcome = ipynbImporterAdapter.preview(payload('python3'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    expect(preview.dominantLanguage).toBe('python');
    expect(preview.warnings).not.toContain('ipynb-unknown-language');
  });

  it('falls back to javascript + warning for an unsupported language', () => {
    const outcome = ipynbImporterAdapter.preview(payload('cobol'));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    expect(preview.dominantLanguage).toBe('javascript');
    expect(preview.warnings).toContain('ipynb-unknown-language');
  });

  it('does NOT emit the unknown-language warning when kernelspec is absent', () => {
    const outcome = ipynbImporterAdapter.preview(
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [],
      })
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    expect(preview.warnings).not.toContain('ipynb-unknown-language');
  });

  it('keeps the summary chip consistent with the seeded notebook for an empty .ipynb', () => {
    // Regression: an empty (or all-raw) notebook falls back to the
    // seeded blank notebook so the user lands on a runnable canvas.
    // The summary chip, the snippet band, and the committed notebook
    // must all agree — previously `cellCounts.total` reported 0 while
    // the band + notebook showed the 2 seeded cells.
    const outcome = ipynbImporterAdapter.preview(
      JSON.stringify({ nbformat: 4, metadata: {}, cells: [] })
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    expect(preview.cellCounts.total).toBe(preview.notebook.cells.length);
    expect(preview.cellSnippets.length).toBe(
      Math.min(preview.notebook.cells.length, 3)
    );
    expect(
      preview.cellCounts.code + preview.cellCounts.markdown
    ).toBe(preview.notebook.cells.length);
    expect(preview.notebook.cells.length).toBeGreaterThan(0);
  });

  it('reports dropped raw count alongside the seeded fallback for an all-raw .ipynb', () => {
    const outcome = ipynbImporterAdapter.preview(
      JSON.stringify({
        nbformat: 4,
        metadata: {},
        cells: [
          { cell_type: 'raw', source: 'raw payload' },
          { cell_type: 'raw', source: 'another raw' },
        ],
      })
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const preview = outcome.preview as IpynbImporterPreview;
    // Both raw cells are dropped; the user gets the seeded notebook.
    expect(preview.cellCounts.droppedRaw).toBe(2);
    expect(preview.cellCounts.total).toBe(preview.notebook.cells.length);
    expect(preview.warnings).toContain('ipynb-raw-cell-dropped');
  });
});

describe('ipynbImporterAdapter.preview — reject paths', () => {
  it('empty-input on a blank source', () => {
    const outcome = ipynbImporterAdapter.preview('   ');
    expect(outcome).toEqual({ ok: false, reason: 'empty-input' });
  });

  it('oversized when source exceeds MAX_NOTEBOOK_BYTES', () => {
    const huge = 'x'.repeat(MAX_NOTEBOOK_BYTES + 1);
    const outcome = ipynbImporterAdapter.preview(huge);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unsupported-feature');
    expect(outcome.detail).toBe('oversized');
  });

  it('oversized when UTF-8 bytes exceed MAX_NOTEBOOK_BYTES', () => {
    const hugeTitle = 'é'.repeat(Math.ceil(MAX_NOTEBOOK_BYTES / 2));
    const source = JSON.stringify({
      nbformat: 4,
      metadata: { title: hugeTitle },
      cells: [],
    });

    expect(source.length).toBeLessThan(MAX_NOTEBOOK_BYTES);
    expect(new TextEncoder().encode(source).length).toBeGreaterThan(
      MAX_NOTEBOOK_BYTES
    );

    const outcome = ipynbImporterAdapter.preview(source);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unsupported-feature');
    expect(outcome.detail).toBe('oversized');
  });

  it('malformed when the JSON does not parse', () => {
    const outcome = ipynbImporterAdapter.preview('{not json');
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed');
    expect(outcome.detail).toBe('malformed-json');
  });

  it('invalid-shape when cells field is missing', () => {
    const outcome = ipynbImporterAdapter.preview(
      JSON.stringify({ nbformat: 4 })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed');
    expect(outcome.detail).toBe('invalid-shape');
  });

  it('invalid-shape when a cell entry is not an object', () => {
    const outcome = ipynbImporterAdapter.preview(
      JSON.stringify({ nbformat: 4, cells: [null] })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed');
    expect(outcome.detail).toBe('invalid-shape');
  });

  it('invalid-shape when a cell type is unknown', () => {
    const outcome = ipynbImporterAdapter.preview(
      JSON.stringify({
        nbformat: 4,
        cells: [{ cell_type: 'future-cell', source: ['x'] }],
      })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('malformed');
    expect(outcome.detail).toBe('invalid-shape');
  });

  it('wrong-version for nbformat 3', () => {
    const outcome = ipynbImporterAdapter.preview(
      JSON.stringify({ nbformat: 3, cells: [] })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unsupported-feature');
    expect(outcome.detail).toBe('wrong-version');
  });

  it('too-many-cells beyond the schema cap', () => {
    const cells = Array.from(
      { length: MAX_CELLS_PER_NOTEBOOK + 1 },
      () => ({ cell_type: 'markdown', source: ['x'] })
    );
    const outcome = ipynbImporterAdapter.preview(
      JSON.stringify({ nbformat: 4, cells })
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.reason).toBe('unsupported-feature');
    expect(outcome.detail).toBe('too-many-cells');
  });
});

describe('ipynbImporterAdapter.import — round-trip', () => {
  it('returns title + notebook + dominantLanguage', () => {
    const outcome = ipynbImporterAdapter.preview(
      loadFixture('hello-python.ipynb')
    );
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const result = ipynbImporterAdapter.import(
      outcome.preview
    ) as IpynbImporterResult;
    expect(result.title).toMatch(/python/i);
    expect(result.notebook.cells.length).toBeGreaterThan(0);
    expect(result.dominantLanguage).toBe('python');
  });
});

describe('mapWarningToTelemetryKind', () => {
  it('maps every ipynb warning to a NOTEBOOK_WARNING_KINDS slot', () => {
    expect(mapWarningToTelemetryKind('ipynb-raw-cell-dropped')).toBe(
      'raw-cell-dropped'
    );
    expect(mapWarningToTelemetryKind('ipynb-rich-output-dropped')).toBe(
      'rich-output-dropped'
    );
    expect(mapWarningToTelemetryKind('ipynb-unknown-language')).toBe(
      'unknown-language'
    );
    expect(mapWarningToTelemetryKind('ipynb-execute-result-stripped')).toBe(
      'execute-result-stripped'
    );
  });

  it('returns null for curl-only warnings (no telemetry bucket)', () => {
    expect(mapWarningToTelemetryKind('curl-basic-auth')).toBeNull();
    expect(mapWarningToTelemetryKind('curl-other-flag')).toBeNull();
  });
});
