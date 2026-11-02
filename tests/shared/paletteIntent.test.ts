import { describe, expect, it } from 'vitest';
import { detectPaletteIntent } from '../../src/shared/paletteIntent';

const kind = (query: string) => detectPaletteIntent(query).kind;

describe('detectPaletteIntent', () => {
  it('reads file names and paths as files', () => {
    for (const query of ['main.py', 'README.md', 'App.TSX', 'config.yml', 'src/app', './util.ts', '@types/node', 'src/']) expect(kind(query)).toBe('file');
  });

  it('reads questions in English and Spanish', () => {
    for (const query of ['why does quicksort drop duplicates', 'what is a closure', '¿por qué falla esto?', 'is this loop quadratic?']) {
      expect(kind(query)).toBe('question');
    }
  });

  it('keeps commands, short queries and numbers as commands', () => {
    for (const query of ['open settings', 'toggle vim mode', 'format json', 'how to', 'run?', 'v1.2', '1.5', '1/2', '../..', 'console.log', 'JSON.parse', 'Settings', '']) {
      expect(kind(query)).toBe('command');
    }
  });

  it('treats a leading ! as a command and drops it from the search', () => {
    expect(detectPaletteIntent('!why does x fail')).toEqual({ kind: 'command', query: 'why does x fail' });
    expect(detectPaletteIntent('  ! main.py ')).toEqual({ kind: 'command', query: 'main.py' });
  });

  it('trims the query it hands on', () => {
    expect(detectPaletteIntent('  main.py ')).toEqual({ kind: 'file', query: 'main.py' });
  });
});
