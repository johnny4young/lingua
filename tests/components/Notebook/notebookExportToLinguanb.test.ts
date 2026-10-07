import { describe, expect, it } from 'vitest';
import { exportNotebookAsLinguanb } from '../../../src/renderer/components/Notebook/notebookExportToLinguanb';
import { MAX_LINGUANB_BYTES } from '../../../src/shared/notebookDocument';
import type { NotebookV1 } from '../../../src/shared/notebook';

function notebookWithSource(source: string): NotebookV1 {
  return {
    schemaVersion: 1,
    id: 'nb',
    title: 'My Notes',
    language: 'javascript',
    cells: [{ id: 'c1', kind: 'code', language: 'javascript', source }],
  } as unknown as NotebookV1;
}

describe('exportNotebookAsLinguanb', () => {
  it('exports a reopenable document with a kebab-cased name', () => {
    const result = exportNotebookAsLinguanb(notebookWithSource('1 + 1'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestedFileName).toBe('my-notes.linguanb');
    expect(result.json).toContain('"format": "linguanb"');
  });

  it('refuses a document the reader would reject as oversized', () => {
    const result = exportNotebookAsLinguanb(notebookWithSource('x'.repeat(MAX_LINGUANB_BYTES)));
    expect(result).toEqual({ ok: false, reason: 'oversized', limitKb: MAX_LINGUANB_BYTES / 1024 });
  });
});
