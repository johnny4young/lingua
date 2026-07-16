/**
 * IT2-D3 — bootstrap progress store + the loading-line composer.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  formatBootstrapProgress,
  formatMegabytes,
  useBootstrapProgressStore,
} from '../../src/renderer/stores/bootstrapProgressStore';

beforeEach(() => {
  useBootstrapProgressStore.getState().clear();
});

describe('bootstrapProgressStore', () => {
  it('reports and clears', () => {
    useBootstrapProgressStore.getState().report({
      language: 'python',
      loadedBytes: 1024,
      totalBytes: 2048,
    });
    expect(useBootstrapProgressStore.getState().progress).toEqual({
      language: 'python',
      loadedBytes: 1024,
      totalBytes: 2048,
    });
    useBootstrapProgressStore.getState().clear();
    expect(useBootstrapProgressStore.getState().progress).toBeNull();
  });

  it('does not let one runtime clear another runtime\'s active sample', () => {
    useBootstrapProgressStore.getState().report({
      language: 'ruby',
      loadedBytes: 1024,
      totalBytes: null,
    });
    useBootstrapProgressStore.getState().clear('python');
    expect(useBootstrapProgressStore.getState().progress?.language).toBe('ruby');
    useBootstrapProgressStore.getState().clear('ruby');
    expect(useBootstrapProgressStore.getState().progress).toBeNull();
  });
});

describe('formatMegabytes', () => {
  it('keeps one decimal under 10 MB and rounds above', () => {
    expect(formatMegabytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatMegabytes(34.4 * 1024 * 1024)).toBe('34 MB');
  });
});

describe('formatBootstrapProgress', () => {
  const base = 'Loading Python runtime (Pyodide)...';

  it('renders loaded / total with a known Content-Length', () => {
    expect(
      formatBootstrapProgress(base, {
        language: 'python',
        loadedBytes: 34 * 1024 * 1024,
        totalBytes: 60 * 1024 * 1024,
      })
    ).toBe('Loading Python runtime (Pyodide)... 34 MB / 60 MB');
  });

  it('renders loaded-only when the total is unknown (indeterminate)', () => {
    expect(
      formatBootstrapProgress(base, {
        language: 'python',
        loadedBytes: 5 * 1024 * 1024,
        totalBytes: null,
      })
    ).toBe('Loading Python runtime (Pyodide)... 5.0 MB');
  });
});
