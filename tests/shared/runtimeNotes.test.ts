/**
 * implementation — runtime context notes. The note keeps the model from suggesting
 * fixes the runtime cannot execute; these tests pin the mapping per
 * language / platform / JS runtime mode.
 */

import { describe, expect, it } from 'vitest';
import { runtimeNoteFor } from '../../src/shared/ai/runtimeNotes';

describe('runtimeNoteFor', () => {
  it('describes the sandboxed worker for JS without an explicit mode', () => {
    const note = runtimeNoteFor({ language: 'javascript', platform: 'web' });
    expect(note).toContain('Web Worker');
    expect(note).toContain('no Node.js built-ins');
  });

  it('describes desktop Node when the tab runs in node mode', () => {
    const note = runtimeNoteFor({
      language: 'typescript',
      platform: 'desktop',
      runtimeMode: 'node',
    });
    expect(note).toContain('Node.js child process');
    expect(note).not.toContain('Web Worker');
  });

  it('describes the browser-preview iframe mode', () => {
    const note = runtimeNoteFor({
      language: 'javascript',
      platform: 'web',
      runtimeMode: 'browser-preview',
    });
    expect(note).toContain('iframe');
  });

  it('pins Python to Pyodide with the micropip constraint', () => {
    const note = runtimeNoteFor({ language: 'python', platform: 'desktop' });
    expect(note).toContain('Pyodide');
    expect(note).toContain('micropip');
  });

  it('pins SQL to local DuckDB-WASM with no external connections', () => {
    const note = runtimeNoteFor({ language: 'sql', platform: 'web' });
    expect(note).toContain('DuckDB');
    expect(note).toContain('external database connections are not available');
  });

  it('mentions CORS for HTTP on web but not on desktop', () => {
    expect(runtimeNoteFor({ language: 'http', platform: 'web' })).toContain(
      'CORS'
    );
    expect(
      runtimeNoteFor({ language: 'http', platform: 'desktop' })
    ).toContain('no browser CORS');
  });

  it('describes the native toolchain for Go and Rust', () => {
    expect(runtimeNoteFor({ language: 'go', platform: 'desktop' })).toContain(
      'Go toolchain'
    );
    expect(runtimeNoteFor({ language: 'rust', platform: 'desktop' })).toContain(
      'Rust toolchain'
    );
  });

  it('returns undefined for a language it cannot describe', () => {
    expect(
      runtimeNoteFor({ language: 'plaintext', platform: 'web' })
    ).toBeUndefined();
  });
});
