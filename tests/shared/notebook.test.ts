/**
 * RL-043 Slice A — schema + parser + serializer coverage.
 *
 * Validates every closed-enum reject reason and the happy-path
 * round-trip so `.linguanb` documents that pass the parser today can
 * be round-tripped through `serializeNotebook` + reparsed byte-for-byte.
 */

import { describe, expect, it } from 'vitest';
import {
  createBlankNotebook,
  isNotebookCodeCell,
  isNotebookMarkdownCell,
  MAX_CELLS_PER_NOTEBOOK,
  MAX_CELL_SOURCE_LENGTH,
  MAX_NOTEBOOK_BYTES,
  MAX_OUTPUTS_PER_CELL,
  NOTEBOOK_CELL_KINDS,
  NOTEBOOK_CELL_LANGUAGES,
  NOTEBOOK_REJECT_REASONS,
  parseNotebook,
  serializeNotebook,
  type NotebookV1,
} from '../../src/shared/notebook';

function validNotebook(): NotebookV1 {
  return {
    version: 1,
    id: 'nb-test-1',
    title: 'Test',
    createdAt: '2026-05-26T12:00:00.000Z',
    cells: [
      { kind: 'markdown', id: 'cell-md', source: '# Hello' },
      {
        kind: 'code',
        id: 'cell-code',
        language: 'javascript',
        source: 'console.log("hi");',
        outputs: [{ kind: 'text', text: 'hi', stream: 'stdout' }],
      },
    ],
  };
}

describe('shared/notebook closed enums', () => {
  it('NOTEBOOK_REJECT_REASONS stays the closed set Slice A ships', () => {
    expect([...NOTEBOOK_REJECT_REASONS].sort()).toEqual(
      [
        'malformed-json',
        'wrong-version',
        'invalid-shape',
        'unknown-language',
        'oversized',
        'too-many-cells',
      ].sort()
    );
  });

  it('NOTEBOOK_CELL_LANGUAGES stays the closed set Slice A ships', () => {
    expect([...NOTEBOOK_CELL_LANGUAGES]).toEqual([
      'javascript',
      'typescript',
      'python',
    ]);
  });

  it('NOTEBOOK_CELL_KINDS exposes both markdown and code', () => {
    expect([...NOTEBOOK_CELL_KINDS].sort()).toEqual(['code', 'markdown']);
  });
});

describe('parseNotebook happy path', () => {
  it('parses a fully populated NotebookV1 object', () => {
    const result = parseNotebook(validNotebook());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notebook.title).toBe('Test');
    expect(result.notebook.cells).toHaveLength(2);
  });

  it('parses a JSON-stringified payload identically', () => {
    const raw = JSON.stringify(validNotebook());
    const result = parseNotebook(raw);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notebook.id).toBe('nb-test-1');
  });

  it('omits createdAt when missing on input but preserves it when present', () => {
    const nb = validNotebook();
    const result = parseNotebook(nb);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notebook.createdAt).toBe('2026-05-26T12:00:00.000Z');
  });
});

describe('parseNotebook reject paths (closed enum)', () => {
  it('malformed-json on an unparseable string', () => {
    const result = parseNotebook('{not json');
    expect(result).toEqual({ ok: false, reason: 'malformed-json' });
  });

  it('wrong-version when version !== 1', () => {
    const result = parseNotebook({ ...validNotebook(), version: 2 });
    expect(result).toEqual({ ok: false, reason: 'wrong-version' });
  });

  it('invalid-shape on missing id', () => {
    const nb = validNotebook();
    const broken = { ...nb, id: '' };
    const result = parseNotebook(broken);
    expect(result).toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('invalid-shape when cells field is not an array', () => {
    const nb = validNotebook();
    const broken = { ...nb, cells: 'oops' };
    const result = parseNotebook(broken);
    expect(result).toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('invalid-shape on duplicate cell ids', () => {
    const nb = validNotebook();
    const broken: NotebookV1 = {
      ...nb,
      cells: [nb.cells[0]!, nb.cells[0]!],
    };
    const result = parseNotebook(broken);
    expect(result).toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('invalid-shape on malformed createdAt timestamp', () => {
    const nb = validNotebook();
    const broken = { ...nb, createdAt: 'not-a-date' };
    const result = parseNotebook(broken);
    expect(result).toEqual({ ok: false, reason: 'invalid-shape' });
  });

  it('unknown-language for an unrecognized cell language', () => {
    const nb = validNotebook();
    const broken: NotebookV1 = {
      ...nb,
      cells: [
        {
          kind: 'code',
          id: 'cell-unknown',
          // @ts-expect-error - testing parser rejects unknown language
          language: 'cobol',
          source: '',
          outputs: [],
        },
      ],
    };
    const result = parseNotebook(broken);
    expect(result).toEqual({ ok: false, reason: 'unknown-language' });
  });

  it('oversized when serialized JSON exceeds MAX_NOTEBOOK_BYTES', () => {
    const big = 'x'.repeat(MAX_NOTEBOOK_BYTES + 1);
    const result = parseNotebook(big);
    expect(result).toEqual({ ok: false, reason: 'oversized' });
  });

  it('oversized when UTF-8 bytes exceed MAX_NOTEBOOK_BYTES', () => {
    const title = 'é'.repeat(Math.ceil(MAX_NOTEBOOK_BYTES / 2));
    const raw = JSON.stringify({ ...validNotebook(), title });

    expect(raw.length).toBeLessThan(MAX_NOTEBOOK_BYTES);
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(
      MAX_NOTEBOOK_BYTES
    );
    expect(parseNotebook(raw)).toEqual({ ok: false, reason: 'oversized' });
  });

  it('oversized when a single cell source exceeds MAX_CELL_SOURCE_LENGTH', () => {
    const nb: NotebookV1 = {
      ...validNotebook(),
      cells: [
        {
          kind: 'code',
          id: 'cell-big',
          language: 'javascript',
          source: 'x'.repeat(MAX_CELL_SOURCE_LENGTH + 1),
          outputs: [],
        },
      ],
    };
    const result = parseNotebook(nb);
    expect(result).toEqual({ ok: false, reason: 'oversized' });
  });

  it('oversized when outputs exceed MAX_OUTPUTS_PER_CELL', () => {
    const nb: NotebookV1 = {
      ...validNotebook(),
      cells: [
        {
          kind: 'code',
          id: 'cell-loud',
          language: 'javascript',
          source: '',
          outputs: Array.from({ length: MAX_OUTPUTS_PER_CELL + 1 }, (_, i) => ({
            kind: 'text' as const,
            text: String(i),
            stream: 'stdout' as const,
          })),
        },
      ],
    };
    const result = parseNotebook(nb);
    expect(result).toEqual({ ok: false, reason: 'oversized' });
  });

  it('too-many-cells when cells.length exceeds MAX_CELLS_PER_NOTEBOOK', () => {
    const cells = Array.from({ length: MAX_CELLS_PER_NOTEBOOK + 1 }, (_, i) => ({
      kind: 'markdown' as const,
      id: `cell-${i}`,
      source: 'x',
    }));
    const result = parseNotebook({ ...validNotebook(), cells });
    expect(result).toEqual({ ok: false, reason: 'too-many-cells' });
  });
});

describe('serializeNotebook + round-trip', () => {
  it('returns a pretty-printed JSON string that round-trips through parseNotebook', () => {
    const nb = validNotebook();
    const json = serializeNotebook(nb);
    expect(json).not.toBeNull();
    expect(json).toContain('  ');
    const reparsed = parseNotebook(json!);
    expect(reparsed.ok).toBe(true);
    if (!reparsed.ok) return;
    expect(reparsed.notebook).toEqual(nb);
  });

  it('returns null when the serialized payload exceeds MAX_NOTEBOOK_BYTES', () => {
    const huge: NotebookV1 = {
      ...validNotebook(),
      cells: [
        {
          kind: 'markdown',
          id: 'cell-large',
          source: 'x'.repeat(MAX_NOTEBOOK_BYTES),
        },
      ],
    };
    expect(serializeNotebook(huge)).toBeNull();
  });

  it('returns null when the serialized UTF-8 byte size exceeds MAX_NOTEBOOK_BYTES', () => {
    const huge: NotebookV1 = {
      ...validNotebook(),
      cells: [
        {
          kind: 'markdown',
          id: 'cell-large',
          source: 'é'.repeat(Math.ceil(MAX_NOTEBOOK_BYTES / 2)),
        },
      ],
    };

    const raw = JSON.stringify(huge, null, 2);
    expect(raw.length).toBeLessThan(MAX_NOTEBOOK_BYTES);
    expect(new TextEncoder().encode(raw).length).toBeGreaterThan(
      MAX_NOTEBOOK_BYTES
    );
    expect(serializeNotebook(huge)).toBeNull();
  });
});

describe('createBlankNotebook + cell guards', () => {
  it('seeds a welcome markdown + a runnable JS code cell', () => {
    const nb = createBlankNotebook({ id: 'nb-x', title: 'Untitled notebook' });
    expect(nb.cells).toHaveLength(2);
    expect(nb.cells[0]?.kind).toBe('markdown');
    expect(nb.cells[1]?.kind).toBe('code');
    expect(parseNotebook(nb).ok).toBe(true);
  });

  it('isNotebookCodeCell + isNotebookMarkdownCell are mutually exclusive', () => {
    const nb = createBlankNotebook({ id: 'nb-y', title: 'T' });
    for (const cell of nb.cells) {
      const isCode = isNotebookCodeCell(cell);
      const isMd = isNotebookMarkdownCell(cell);
      expect(isCode).not.toBe(isMd);
    }
  });
});
