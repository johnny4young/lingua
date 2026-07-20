/**
 * implementation - Python dependency detector tests.
 */

import { describe, expect, it } from 'vitest';
import { detectPythonDependencies } from '../../../src/shared/dependencies/pythonDetector';

describe('detectPythonDependencies', () => {
  it('returns an empty array for an empty buffer', () => {
    expect(detectPythonDependencies('')).toEqual([]);
  });

  it('extracts a plain `import` statement', () => {
    expect(detectPythonDependencies('import numpy')).toEqual([
      { name: 'numpy', kind: 'import' },
    ]);
  });

  it('extracts `from x import y`', () => {
    expect(detectPythonDependencies('from pandas import DataFrame')).toEqual([
      { name: 'pandas', kind: 'from' },
    ]);
  });

  it('normalises dotted modules to the top-level package', () => {
    expect(
      detectPythonDependencies('from pkg.sub.deep import thing')
    ).toEqual([{ name: 'pkg', submodule: 'sub.deep', kind: 'from' }]);
  });

  it('handles multi-import + aliases', () => {
    const result = detectPythonDependencies(
      'import numpy as np, pandas as pd, scipy'
    );
    expect(result.map((d) => d.name).sort()).toEqual([
      'numpy',
      'pandas',
      'scipy',
    ]);
  });

  it('skips stdlib modules', () => {
    expect(
      detectPythonDependencies('import os\nimport sys\nfrom collections import Counter')
    ).toEqual([]);
  });

  it('skips relative imports', () => {
    expect(
      detectPythonDependencies('from . import sibling\nfrom .pkg import x')
    ).toEqual([]);
  });

  it('ignores imports inside line comments', () => {
    expect(
      detectPythonDependencies('# import lodash\n# from numpy import x')
    ).toEqual([]);
  });

  it('ignores imports inside single-line strings', () => {
    expect(
      detectPythonDependencies(
        'msg = "import requests"\nother = \'from flask import x\''
      )
    ).toEqual([]);
  });

  it('ignores imports inside triple-quoted strings', () => {
    expect(
      detectPythonDependencies(
        '"""\nfake docstring with\nimport requests\nfrom flask import x\n"""\nimport numpy'
      )
    ).toEqual([{ name: 'numpy', kind: 'import' }]);
  });

  it('handles `import x as y`', () => {
    expect(detectPythonDependencies('import numpy as np')).toEqual([
      { name: 'numpy', kind: 'import' },
    ]);
  });

  it('handles an import followed by a semicolon statement separator', () => {
    expect(detectPythonDependencies('import numpy as np; print(np.arange(3))')).toEqual([
      { name: 'numpy', kind: 'import' },
    ]);
  });

  it('de-duplicates across import shapes', () => {
    expect(
      detectPythonDependencies('import numpy\nfrom numpy import array')
    ).toEqual([{ name: 'numpy', kind: 'import' }]);
  });
});
