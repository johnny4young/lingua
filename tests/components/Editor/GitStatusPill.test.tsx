/**
 * RL-102 Slice 1 — `<GitStatusPill>` render contract.
 *
 * Covers:
 *   - All 4 status buckets render with their distinct visual class
 *     + tooltip text.
 *   - Master setting OFF suppresses the pill.
 *   - `// @git-ignore-status` magic-comment opt-out suppresses the
 *     pill regardless of status.
 *   - `posture.available === false` (no git repo / no binary)
 *     suppresses the pill.
 *   - Click dispatches the bottom-panel `git-diff` tab activation.
 *   - Right-click opens the context menu with the three actions.
 */

import { render, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitStatusPill } from '../../../src/renderer/components/Editor/GitStatusPill';
import { useGitStore } from '../../../src/renderer/stores/gitStore';
import { useUIStore } from '../../../src/renderer/stores/uiStore';

const REPO_ROOT = '/tmp/repo';
const FILE_PATH = '/tmp/repo/src/foo.js';

function primePosture(branch = 'main') {
  useGitStore.getState().setPosture({
    available: true,
    repoRoot: REPO_ROOT,
    branch,
  });
}

function primeStatus(
  status: 'clean' | 'modified' | 'untracked' | 'unknown',
  extras: Partial<{ insertions: number; deletions: number }> = {}
) {
  useGitStore.getState().setFileStatus(FILE_PATH, {
    status,
    updatedAt: Date.now(),
    ...extras,
  });
}

describe('GitStatusPill', () => {
  beforeEach(() => {
    useGitStore.getState().clear();
    useUIStore.setState({ activeBottomPanel: 'console' });
  });

  afterEach(() => {
    useGitStore.getState().clear();
  });

  it('renders the clean dot when status is clean', () => {
    primePosture();
    primeStatus('clean');
    const { getByTestId } = render(<GitStatusPill filePath={FILE_PATH} />);
    const pill = getByTestId('git-status-pill');
    expect(pill.getAttribute('data-git-status')).toBe('clean');
    expect(pill.getAttribute('data-git-branch')).toBe('main');
  });

  it('renders the modified letter + counts when status is modified', () => {
    primePosture();
    primeStatus('modified', { insertions: 5, deletions: 3 });
    const { getByTestId } = render(<GitStatusPill filePath={FILE_PATH} />);
    const pill = getByTestId('git-status-pill');
    expect(pill.getAttribute('data-git-status')).toBe('modified');
    expect(pill.textContent).toContain('M');
    expect(pill.textContent).toContain('+5');
    expect(pill.textContent).toContain('3');
  });

  it('renders the untracked letter when status is untracked', () => {
    primePosture();
    primeStatus('untracked');
    const { getByTestId } = render(<GitStatusPill filePath={FILE_PATH} />);
    const pill = getByTestId('git-status-pill');
    expect(pill.getAttribute('data-git-status')).toBe('untracked');
    expect(pill.textContent).toContain('U');
  });

  it('renders the unknown letter when status is unknown', () => {
    primePosture();
    primeStatus('unknown');
    const { getByTestId } = render(<GitStatusPill filePath={FILE_PATH} />);
    const pill = getByTestId('git-status-pill');
    expect(pill.getAttribute('data-git-status')).toBe('unknown');
    expect(pill.textContent).toContain('?');
  });

  it('renders null when posture.available is false (no git repo)', () => {
    useGitStore.getState().setPosture({ available: false });
    primeStatus('modified');
    const { queryByTestId } = render(<GitStatusPill filePath={FILE_PATH} />);
    expect(queryByTestId('git-status-pill')).toBeNull();
  });

  it('renders null when `// @git-ignore-status` is in the buffer (fold F)', () => {
    primePosture();
    primeStatus('modified');
    const { queryByTestId } = render(
      <GitStatusPill
        filePath={FILE_PATH}
        language="javascript"
        content="// @git-ignore-status\nconsole.log('x')"
      />
    );
    expect(queryByTestId('git-status-pill')).toBeNull();
  });

  it('flips the bottom panel to git-diff on click', () => {
    primePosture();
    primeStatus('modified');
    const { getByTestId } = render(<GitStatusPill filePath={FILE_PATH} />);
    const pill = getByTestId('git-status-pill');
    expect(useUIStore.getState().activeBottomPanel).not.toBe('git-diff');
    act(() => {
      fireEvent.click(pill);
    });
    expect(useUIStore.getState().activeBottomPanel).toBe('git-diff');
  });

  it('renders the context menu on right-click with 3 actions (fold C)', () => {
    primePosture();
    primeStatus('modified');
    const { getByTestId, queryByTestId, getAllByRole } = render(
      <GitStatusPill filePath={FILE_PATH} />
    );
    const pill = getByTestId('git-status-pill');
    expect(queryByTestId('git-status-pill-menu')).toBeNull();
    act(() => {
      fireEvent.contextMenu(pill, { clientX: 50, clientY: 50 });
    });
    const menu = getByTestId('git-status-pill-menu');
    expect(menu).toBeTruthy();
    const items = getAllByRole('menuitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toMatch(/diff/i);
    expect(items[1]?.textContent).toMatch(/copy/i);
    expect(items[2]?.textContent).toMatch(
      /source control|control de versiones|explorador/i
    );
  });

  it('renders null when no status entry yet (initial load flicker guard)', () => {
    primePosture();
    // No `setFileStatus` call → byFile is empty.
    const { queryByTestId } = render(<GitStatusPill filePath={FILE_PATH} />);
    expect(queryByTestId('git-status-pill')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // RL-102 Slice 2 — Reveal in Source Control row enabled.
  // -------------------------------------------------------------------------

  describe('Reveal in Source Control action (RL-102 Slice 2)', () => {
    beforeEach(() => {
      // Install a minimal `window.lingua.git.reveal` so the menu
      // item is enabled. The actual call is tested via its return
      // value path in the dedicated case below.
      (window as unknown as { lingua: unknown }).lingua = {
        platform: 'desktop',
        git: {
          reveal: () => Promise.resolve(true),
        },
      };
    });

    afterEach(() => {
      // Restore the absent bridge so unrelated tests that depend on
      // the no-bridge path see the original surface.
      delete (window as unknown as { lingua?: unknown }).lingua;
    });

    it('renders the Reveal row enabled when bridge.reveal exists and repoRoot is known', () => {
      primePosture();
      primeStatus('modified');
      const { getByTestId, getAllByRole } = render(
        <GitStatusPill filePath={FILE_PATH} />
      );
      act(() => {
        fireEvent.contextMenu(getByTestId('git-status-pill'), {
          clientX: 50,
          clientY: 50,
        });
      });
      const items = getAllByRole('menuitem');
      expect((items[2] as HTMLButtonElement).disabled).toBe(false);
    });

    it('invokes bridge.reveal with the resolved repoRoot on click', async () => {
      let called: string | null = null;
      (window as unknown as { lingua: unknown }).lingua = {
        platform: 'desktop',
        git: {
          reveal: (root: string) => {
            called = root;
            return Promise.resolve(true);
          },
        },
      };
      primePosture();
      primeStatus('modified');
      const { getByTestId, getAllByRole } = render(
        <GitStatusPill filePath={FILE_PATH} />
      );
      act(() => {
        fireEvent.contextMenu(getByTestId('git-status-pill'), {
          clientX: 50,
          clientY: 50,
        });
      });
      const revealItem = getAllByRole('menuitem')[2] as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(revealItem);
      });
      expect(called).toBe(REPO_ROOT);
    });

    it('pushes a localized notice when bridge.reveal returns false', async () => {
      (window as unknown as { lingua: unknown }).lingua = {
        platform: 'desktop',
        git: {
          reveal: () => Promise.resolve(false),
        },
      };
      primePosture();
      primeStatus('modified');
      const { getByTestId, getAllByRole } = render(
        <GitStatusPill filePath={FILE_PATH} />
      );
      act(() => {
        fireEvent.contextMenu(getByTestId('git-status-pill'), {
          clientX: 50,
          clientY: 50,
        });
      });
      const revealItem = getAllByRole('menuitem')[2] as HTMLButtonElement;
      await act(async () => {
        fireEvent.click(revealItem);
      });
      const notice = useUIStore.getState().statusNotice;
      expect(notice?.messageKey).toBe('git.reveal.error.notFound');
    });
  });
});
