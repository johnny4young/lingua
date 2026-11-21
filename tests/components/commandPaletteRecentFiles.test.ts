import { describe, expect, it, vi } from 'vitest';
import {
  buildRecentFileEntries,
  RECENT_FILE_ROWS,
  type RecentFileSources,
} from '../../src/renderer/components/CommandPalette/commandPaletteRecentFiles';
import type { LastAnswer } from '../../src/renderer/utils/lastAnswer';

const answer = (numeral: string, ranAt: number, extra: Partial<LastAnswer> = {}): LastAnswer => ({
  kind: 'code',
  status: 'ok',
  numeral,
  ranAt,
  ...extra,
});

function sources(overrides: Partial<RecentFileSources> = {}): RecentFileSources {
  return {
    tabs: [],
    recentFiles: [],
    answerForPath: () => undefined,
    openTab: vi.fn(),
    reopenFile: vi.fn(),
    ...overrides,
  };
}

describe('buildRecentFileEntries', () => {
  it('orders tabs and closed files by their latest activity and caps the rows', () => {
    const entries = buildRecentFileEntries(
      sources({
        tabs: [
          { id: 'a', name: 'a.py', language: 'python', lastEditedAt: 10 },
          { id: 'b', name: 'b.js', language: 'javascript', lastAnswer: answer('42', 40) },
          { id: 'c', name: 'c.ts', language: 'typescript' },
        ],
        recentFiles: [{ filePath: '/d.rb', name: 'd.rb', language: 'ruby', openedAt: 30 }],
      })
    );
    expect(entries.map(entry => entry.label)).toEqual(['b.js', 'd.rb', 'a.py']);
    expect(entries).toHaveLength(RECENT_FILE_ROWS);
    expect(entries.every(entry => entry.category === 'file')).toBe(true);
  });

  it('names SQL and HTTP tabs by what answered and leaves utilities out', () => {
    const entries = buildRecentFileEntries(
      sources({
        tabs: [
          { id: 'sql', name: 'SQL', language: 'sql', kind: 'sql', lastAnswer: answer('12', 3, { kind: 'sql', unit: 'rows', subject: 'orders by city' }) },
          { id: 'u', name: 'Utilities', language: 'plaintext', kind: 'utilities', lastEditedAt: 9 },
        ],
      })
    );
    expect(entries.map(entry => [entry.label, entry.language])).toEqual([['orders by city', 'sql']]);
  });

  it('reads a closed file answer from the saved session, dates an open file by its last open, and keeps unanswered files name-only', () => {
    const entries = buildRecentFileEntries(
      sources({
        tabs: [{ id: 'open', name: 'open.py', language: 'python', filePath: '/open.py' }],
        recentFiles: [
          { filePath: '/open.py', name: 'open.py', language: 'python', openedAt: 3 },
          { filePath: '/closed.py', name: 'closed.py', language: 'python', openedAt: 2 },
          { filePath: '/plain.py', name: 'plain.py', language: 'python', openedAt: 1 },
        ],
        answerForPath: path => (path === '/closed.py' ? answer('1.24', 5, { label: 's' }) : undefined),
      })
    );
    expect(entries.map(entry => entry.label)).toEqual(['closed.py', 'open.py', 'plain.py']);
    expect(entries[0]?.answer?.numeral).toBe('1.24');
    expect(entries[1]?.answer).toBeUndefined();
  });

  it('opens a tab by id and reopens a closed file by path', () => {
    const calls: string[] = [];
    const entries = buildRecentFileEntries(
      sources({
        tabs: [{ id: 't', name: 't.js', language: 'javascript', lastEditedAt: 2 }],
        recentFiles: [{ filePath: '/f.go', name: 'f.go', language: 'go', openedAt: 1 }],
        openTab: id => calls.push(`tab:${id}`),
        reopenFile: file => calls.push(`file:${file.path}`),
      })
    );
    entries.forEach(entry => entry.action());
    expect(calls).toEqual(['tab:t', 'file:/f.go']);
  });
});
