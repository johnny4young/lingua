import { describe, expect, it } from 'vitest';
import { shouldPrewarmPyodide } from '../../src/renderer/workers/python-worker-runtime';

describe('shouldPrewarmPyodide', () => {
  it('pre-warms only when the runtime index is fetched over the network', () => {
    expect(shouldPrewarmPyodide('https://cdn.example.com/pyodide/')).toBe(true);
    expect(shouldPrewarmPyodide('http://localhost:4173/pyodide/')).toBe(true);
    expect(shouldPrewarmPyodide('HTTPS://mirror.example.com/pyodide/')).toBe(true);
  });

  it('skips the redundant read for packaged desktop assets', () => {
    expect(shouldPrewarmPyodide('file:///Applications/lingua.app/Contents/Resources/pyodide/')).toBe(false);
    expect(shouldPrewarmPyodide('app://lingua/pyodide/')).toBe(false);
    expect(shouldPrewarmPyodide('lingua-asset://pyodide/')).toBe(false);
    expect(shouldPrewarmPyodide('')).toBe(false);
  });
});
