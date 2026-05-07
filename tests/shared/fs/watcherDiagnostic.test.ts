import { describe, expect, it } from 'vitest';
import {
  buildWatcherDiagnostic,
  classifyWatcherError,
} from '#src/shared/fs/watcherDiagnostic';

describe('classifyWatcherError', () => {
  it('returns unknown for null / undefined inputs', () => {
    expect(classifyWatcherError(null)).toBe('unknown');
    expect(classifyWatcherError(undefined)).toBe('unknown');
  });

  it('classifies EACCES / EPERM as permission-denied', () => {
    const err = new Error('EACCES: permission denied');
    (err as Error & { code?: string }).code = 'EACCES';
    expect(classifyWatcherError(err)).toBe('permission-denied');

    const eperm = Object.assign(new Error('not permitted'), { code: 'EPERM' });
    expect(classifyWatcherError(eperm)).toBe('permission-denied');
  });

  it('classifies EMFILE / ENOSPC / ENFILE as system-limit', () => {
    expect(
      classifyWatcherError(Object.assign(new Error('too many open files'), { code: 'EMFILE' })),
    ).toBe('system-limit');
    expect(
      classifyWatcherError(Object.assign(new Error('no space left'), { code: 'ENOSPC' })),
    ).toBe('system-limit');
    expect(
      classifyWatcherError(Object.assign(new Error('file table overflow'), { code: 'ENFILE' })),
    ).toBe('system-limit');
  });

  it('classifies ENOENT as path-not-found', () => {
    const err = Object.assign(new Error('no such file'), { code: 'ENOENT' });
    expect(classifyWatcherError(err)).toBe('path-not-found');
  });

  it('falls back to message-based pattern when error has no code', () => {
    expect(classifyWatcherError(new Error('EACCES: permission denied'))).toBe('permission-denied');
    expect(classifyWatcherError(new Error('EMFILE: too many open files'))).toBe('system-limit');
    expect(classifyWatcherError(new Error('inotify watch limit reached'))).toBe('system-limit');
    expect(classifyWatcherError(new Error('ENOENT: no such file'))).toBe('path-not-found');
  });

  it('handles plain string errors via the message fallback', () => {
    expect(classifyWatcherError('EACCES at /protected')).toBe('permission-denied');
    expect(classifyWatcherError('something exploded')).toBe('unknown');
  });

  it('handles plain object errors with code property', () => {
    expect(classifyWatcherError({ code: 'EACCES', message: 'denied' })).toBe('permission-denied');
    expect(classifyWatcherError({ code: 'ENOSPC', message: 'no space' })).toBe('system-limit');
    expect(classifyWatcherError({ code: 'ENOENT', message: 'missing' })).toBe('path-not-found');
  });

  it('returns unknown for unrecognized errors', () => {
    expect(classifyWatcherError(new Error('something weird happened'))).toBe('unknown');
    expect(classifyWatcherError({ kind: 'odd' })).toBe('unknown');
    expect(classifyWatcherError(42)).toBe('unknown');
  });
});

describe('buildWatcherDiagnostic', () => {
  it('returns a fully-shaped diagnostic with the classified kind', () => {
    const err = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    const diagnostic = buildWatcherDiagnostic(err, 'root_42', 'src/foo');

    expect(diagnostic).toEqual({
      kind: 'permission-denied',
      rootId: 'root_42',
      relativePath: 'src/foo',
      errorMessage: 'EACCES: permission denied',
    });
  });

  it('uses the string error verbatim when not an Error instance', () => {
    const diagnostic = buildWatcherDiagnostic('plain string failure', 'r', '');
    expect(diagnostic.errorMessage).toBe('plain string failure');
    expect(diagnostic.kind).toBe('unknown');
  });

  it('falls back to unknown error for non-Error non-string inputs', () => {
    const diagnostic = buildWatcherDiagnostic({ weird: true }, 'r', '');
    expect(diagnostic.errorMessage).toBe('unknown error');
    expect(diagnostic.kind).toBe('unknown');
  });
});
