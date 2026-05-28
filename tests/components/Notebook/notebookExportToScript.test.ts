/**
 * RL-043 Slice A fold F — language-aware notebook script export coverage.
 */

import { describe, expect, it } from 'vitest';

import {
  exportNotebookAsScript,
  pickNotebookExportLanguage,
} from '../../../src/renderer/components/Notebook/notebookExportToScript';
import type { NotebookV1 } from '../../../src/shared/notebook';

function notebook(cells: NotebookV1['cells']): NotebookV1 {
  return {
    version: 1,
    id: 'notebook-export',
    title: 'Data Check',
    createdAt: '2026-05-27T00:00:00.000Z',
    cells,
  };
}

describe('notebookExportToScript', () => {
  it('exports single-language Python notebooks as .py with Python comments', () => {
    const source = notebook([
      { kind: 'markdown', id: 'md-1', source: 'Load the data' },
      {
        kind: 'code',
        id: 'py-1',
        language: 'python',
        source: 'print("ok")',
        outputs: [],
      },
    ]);

    const exported = exportNotebookAsScript(source);

    expect(exported.language).toBe('python');
    expect(exported.suggestedFileName).toBe('data-check.py');
    expect(exported.source).toContain('# --- markdown md-1 ---');
    expect(exported.source).toContain('print("ok")');
  });

  it('exports single-language TypeScript notebooks as .ts', () => {
    const source = notebook([
      {
        kind: 'code',
        id: 'ts-1',
        language: 'typescript',
        source: 'const answer: number = 42;',
        outputs: [],
      },
    ]);

    const exported = exportNotebookAsScript(source);

    expect(exported.language).toBe('typescript');
    expect(exported.suggestedFileName).toBe('data-check.ts');
    expect(exported.source).toContain('// --- cell ts-1 (typescript) ---');
  });

  it('falls back to .txt for mixed-language notebooks', () => {
    const source = notebook([
      {
        kind: 'code',
        id: 'js-1',
        language: 'javascript',
        source: 'console.log(1);',
        outputs: [],
      },
      {
        kind: 'code',
        id: 'py-1',
        language: 'python',
        source: 'print(2)',
        outputs: [],
      },
    ]);

    expect(pickNotebookExportLanguage(source)).toBeNull();
    const exported = exportNotebookAsScript(source);
    expect(exported.language).toBeNull();
    expect(exported.suggestedFileName).toBe('data-check.txt');
  });
});
