import { describe, expect, it } from 'vitest';
import {
  DEPENDENCY_ADAPTER_LANGUAGES,
  isDependencyAdapterLanguage,
  loadDependencyAdapter,
  maybeLoadDependencyAdapter,
  sourceMayReferenceDependencies,
} from '../../../src/shared/dependencies/registry';

describe('dependency adapter registry', () => {
  it('keeps language eligibility closed and prototype-safe', () => {
    expect(DEPENDENCY_ADAPTER_LANGUAGES).toEqual(['javascript', 'typescript', 'python']);
    expect(isDependencyAdapterLanguage('javascript')).toBe(true);
    expect(isDependencyAdapterLanguage('python')).toBe(true);
    expect(isDependencyAdapterLanguage('go')).toBe(false);
    expect(isDependencyAdapterLanguage('toString')).toBe(false);
  });

  it('conservatively identifies source that can reference a package', () => {
    expect(
      sourceMayReferenceDependencies('javascript', 'const answer = 40 + 2;\nconsole.log(answer);\n')
    ).toBe(false);
    expect(
      sourceMayReferenceDependencies('typescript', "import type { Config } from 'toolkit';")
    ).toBe(true);
    expect(
      sourceMayReferenceDependencies('javascript', "const module = await import('lodash');")
    ).toBe(true);
    expect(sourceMayReferenceDependencies('python', 'print("hello")')).toBe(false);
    expect(sourceMayReferenceDependencies('python', 'from numpy import array')).toBe(true);
  });

  it('loads and reuses the language adapters on demand', async () => {
    const first = await loadDependencyAdapter('javascript');
    const second = await loadDependencyAdapter('javascript');
    const typescript = await loadDependencyAdapter('typescript');
    const python = await loadDependencyAdapter('python');

    expect(first).toBe(second);
    expect(first.detect("import sortBy from 'lodash';")).toEqual([
      { name: 'lodash', kind: 'import' },
    ]);
    expect(typescript.language).toBe('typescript');
    expect(python.detect('import numpy as np')).toEqual([{ name: 'numpy', kind: 'import' }]);
  });

  it('returns null without loading an adapter for unsupported languages', async () => {
    await expect(maybeLoadDependencyAdapter(null)).resolves.toBeNull();
    await expect(maybeLoadDependencyAdapter('go')).resolves.toBeNull();
  });
});
