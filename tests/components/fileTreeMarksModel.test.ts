import { describe, expect, it } from 'vitest';
import { gitMarksFrom, tallyTests } from '../../src/renderer/components/FileTree/fileTreeMarks';

describe('fileTreeMarks', () => {
  it('marks untracked folders, their contents and an untracked project root', () => {
    const marks = gitMarksFrom({ paths: [{ path: 'a.ts', status: 'modified' }, { path: 'new/', status: 'untracked' }], truncated: false });
    expect(marks.count).toBe(2);
    expect(marks.markFor('a.ts')).toBe('modified');
    expect(marks.markFor('new')).toBe('untracked');
    expect(marks.markFor('new/deep/b.ts')).toBe('untracked');
    expect(marks.markFor('newer.ts')).toBeUndefined();
    expect(gitMarksFrom({ paths: [{ path: '', status: 'untracked' }], truncated: false }).markFor('src/x.ts')).toBe('untracked');
    expect(marks.shown).toBe('2');
    expect(gitMarksFrom({ paths: [{ path: 'a.ts', status: 'modified' }], truncated: true }).shown).toBe('1+');
  });

  it('counts stale results as waiting and build diagnostics as a failure without a test', () => {
    const { all, byFile } = tallyTests([
      { file: 'a.test.ts', path: ['a'], status: 'passed', stale: true },
      { file: 'a.test.ts', path: ['b'], status: 'passed' },
      { file: 'b.test.ts', path: [], status: 'failed', runnable: false },
    ]);
    expect(byFile.get('a.test.ts')).toEqual({ passed: 1, total: 2, tone: 'pending' });
    expect(byFile.get('b.test.ts')).toEqual({ passed: 0, total: 0, tone: 'failed' });
    expect(all).toEqual({ passed: 1, total: 2, tone: 'failed' });
  });
});
