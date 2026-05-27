/**
 * RL-039 Slice B fold E — `useLessonProgressStore` tests.
 *
 * Covers:
 *   - Initial empty state.
 *   - recordOpened seeds `'opened'` status + sticky promotion.
 *   - recordRun promotes to `'passed'` when all assertions pass.
 *   - Sticky `'passed'` survives a follow-up failed run (lastResult updates).
 *   - markSkipped sets status, no downgrade from `'passed'`.
 *   - resetAll wipes every entry (fold F).
 *   - LRU cap drops the oldest entry.
 *   - Sanitize-on-rehydrate drops tampered values silently.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  LESSON_PROGRESS_CAP,
  resetLessonProgressStoreForTests,
  useLessonProgressStore,
} from '../../src/renderer/stores/lessonProgressStore';

beforeEach(() => {
  localStorage.clear();
  resetLessonProgressStoreForTests();
});

describe('useLessonProgressStore', () => {
  it('starts empty', () => {
    expect(useLessonProgressStore.getState().entries).toEqual({});
    expect(useLessonProgressStore.getState().passedCount()).toBe(0);
  });

  it('recordOpened seeds an `opened` entry', () => {
    useLessonProgressStore.getState().recordOpened('js-fizzbuzz');
    expect(useLessonProgressStore.getState().getEntry('js-fizzbuzz')?.status).toBe(
      'opened'
    );
  });

  it('recordRun promotes to `passed` when all assertions pass', () => {
    useLessonProgressStore.getState().recordRun('js-fizzbuzz', {
      passed: 3,
      total: 3,
    });
    expect(useLessonProgressStore.getState().getEntry('js-fizzbuzz')?.status).toBe(
      'passed'
    );
    expect(useLessonProgressStore.getState().passedCount()).toBe(1);
  });

  it('recordRun stores attempted when partial', () => {
    useLessonProgressStore.getState().recordRun('js-fizzbuzz', {
      passed: 1,
      total: 3,
    });
    expect(useLessonProgressStore.getState().getEntry('js-fizzbuzz')?.status).toBe(
      'attempted'
    );
    expect(useLessonProgressStore.getState().passedCount()).toBe(0);
  });

  it('`passed` is sticky — a follow-up failure does not demote', () => {
    useLessonProgressStore.getState().recordRun('js-x', { passed: 3, total: 3 });
    useLessonProgressStore.getState().recordRun('js-x', { passed: 1, total: 3 });
    expect(useLessonProgressStore.getState().getEntry('js-x')?.status).toBe('passed');
    expect(useLessonProgressStore.getState().getEntry('js-x')?.lastResult).toEqual({
      passed: 1,
      total: 3,
    });
  });

  it('recordOpened does NOT demote attempted / passed entries', () => {
    useLessonProgressStore.getState().recordRun('js-y', { passed: 1, total: 2 });
    useLessonProgressStore.getState().recordOpened('js-y');
    expect(useLessonProgressStore.getState().getEntry('js-y')?.status).toBe(
      'attempted'
    );
  });

  it('markSkipped sets `skipped`, never demotes `passed`', () => {
    useLessonProgressStore.getState().markSkipped('js-skip');
    expect(useLessonProgressStore.getState().getEntry('js-skip')?.status).toBe(
      'skipped'
    );
    useLessonProgressStore.getState().recordRun('js-locked', { passed: 2, total: 2 });
    useLessonProgressStore.getState().markSkipped('js-locked');
    expect(useLessonProgressStore.getState().getEntry('js-locked')?.status).toBe(
      'passed'
    );
  });

  it('resetAll wipes every entry (fold F)', () => {
    useLessonProgressStore.getState().recordOpened('js-a');
    useLessonProgressStore.getState().recordOpened('js-b');
    expect(useLessonProgressStore.getState().touchedCount()).toBe(2);
    useLessonProgressStore.getState().resetAll();
    expect(useLessonProgressStore.getState().entries).toEqual({});
  });

  it('rejects negative / inverted run summaries silently', () => {
    useLessonProgressStore
      .getState()
      .recordRun('js-bad', { passed: 5, total: 2 });
    expect(useLessonProgressStore.getState().getEntry('js-bad')).toBeUndefined();
  });

  it('rejects fractional persisted counters and invalid timestamps on rehydrate', async () => {
    localStorage.setItem(
      'lingua-lesson-progress',
      JSON.stringify({
        state: {
          entries: {
            'js-fractional': {
              recipeId: 'js-fractional',
              status: 'attempted',
              lastSeenAt: '2026-05-26T00:00:00.000Z',
              attemptCount: 1.5,
            },
            'js-invalid-date': {
              recipeId: 'js-invalid-date',
              status: 'opened',
              lastSeenAt: 'not-a-date',
              attemptCount: 1,
            },
          },
        },
        version: 1,
      })
    );
    await (
      useLessonProgressStore as typeof useLessonProgressStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    expect(useLessonProgressStore.getState().entries).toEqual({});
  });

  it('sanitizes a tampered persisted blob on rehydrate', async () => {
    localStorage.setItem(
      'lingua-lesson-progress',
      JSON.stringify({
        state: {
          entries: {
            'js-good': {
              recipeId: 'js-good',
              status: 'passed',
              lastSeenAt: '2026-05-26T00:00:00.000Z',
              attemptCount: 1,
            },
            'js-tampered': {
              recipeId: 'js-different',
              status: 'tier-one-pro-only',
              lastSeenAt: 'never',
              attemptCount: -42,
            },
          },
        },
        version: 1,
      })
    );
    await (
      useLessonProgressStore as typeof useLessonProgressStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();
    const entries = useLessonProgressStore.getState().entries;
    expect(entries['js-good']?.status).toBe('passed');
    expect(entries['js-tampered']).toBeUndefined();
  });

  it('LRU cap drops the oldest entry past the cap', () => {
    // Seed CAP entries with monotonically increasing timestamps.
    const baseTime = Date.UTC(2026, 0, 1);
    for (let i = 0; i < LESSON_PROGRESS_CAP; i += 1) {
      const id = `recipe-${i}`;
      useLessonProgressStore.setState((state) => ({
        entries: {
          ...state.entries,
          [id]: {
            recipeId: id,
            status: 'opened',
            lastSeenAt: new Date(baseTime + i * 1000).toISOString(),
            attemptCount: 0,
          },
        },
      }));
    }
    // Adding one more triggers eviction of the oldest (`recipe-0`).
    useLessonProgressStore.getState().recordOpened('recipe-fresh');
    expect(useLessonProgressStore.getState().getEntry('recipe-0')).toBeUndefined();
    expect(useLessonProgressStore.getState().getEntry('recipe-fresh')).toBeDefined();
    expect(useLessonProgressStore.getState().touchedCount()).toBe(
      LESSON_PROGRESS_CAP
    );
  });

  it('rehydrate enforces the cap by keeping newest entries', async () => {
    const baseTime = Date.UTC(2026, 0, 1);
    const entries: Record<string, unknown> = {};
    for (let i = 0; i < LESSON_PROGRESS_CAP + 2; i += 1) {
      const id = `persisted-${i}`;
      entries[id] = {
        recipeId: id,
        status: 'opened',
        lastSeenAt: new Date(baseTime + i * 1000).toISOString(),
        attemptCount: 0,
      };
    }
    localStorage.setItem(
      'lingua-lesson-progress',
      JSON.stringify({ state: { entries }, version: 1 })
    );

    await (
      useLessonProgressStore as typeof useLessonProgressStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    const restored = useLessonProgressStore.getState().entries;
    expect(Object.keys(restored)).toHaveLength(LESSON_PROGRESS_CAP);
    expect(restored['persisted-0']).toBeUndefined();
    expect(restored['persisted-1']).toBeUndefined();
    expect(restored[`persisted-${LESSON_PROGRESS_CAP + 1}`]).toBeDefined();
  });
});
