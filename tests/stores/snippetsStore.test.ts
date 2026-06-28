import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockTrackEvent } = vi.hoisted(() => ({
  mockTrackEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/telemetry', () => ({
  trackEvent: mockTrackEvent,
}));

import { useSnippetsStore } from '@/stores/snippetsStore';

describe('snippetsStore', () => {
  beforeEach(() => {
    useSnippetsStore.setState({ snippets: [], pendingLinkedSnippetId: null });
  });

  it('should start with no snippets', () => {
    expect(useSnippetsStore.getState().snippets).toHaveLength(0);
  });

  it('should add a snippet with generated id and timestamp', () => {
    useSnippetsStore.getState().addSnippet({
      language: 'javascript',
      label: 'My Snippet',
      description: 'A test snippet',
      code: 'console.log("test")',
    });

    const { snippets } = useSnippetsStore.getState();
    expect(snippets).toHaveLength(1);
    expect(snippets[0].id).toBeTruthy();
    expect(snippets[0].label).toBe('My Snippet');
    expect(snippets[0].language).toBe('javascript');
    expect(snippets[0].createdAt).toBeGreaterThan(0);
  });

  it('should remove a snippet by id', () => {
    useSnippetsStore.getState().addSnippet({
      language: 'python',
      label: 'To Delete',
      description: '',
      code: 'print("bye")',
    });

    const id = useSnippetsStore.getState().snippets[0].id;
    useSnippetsStore.getState().removeSnippet(id);
    expect(useSnippetsStore.getState().snippets).toHaveLength(0);
  });

  it('restoreSnippet re-inserts a removed snippet at the given index', () => {
    const store = useSnippetsStore.getState();
    store.addSnippet({ language: 'python', label: 'A', description: '', code: 'a' });
    store.addSnippet({ language: 'python', label: 'B', description: '', code: 'b' });
    store.addSnippet({ language: 'python', label: 'C', description: '', code: 'c' });

    const middle = useSnippetsStore.getState().snippets[1]!;
    useSnippetsStore.getState().removeSnippet(middle.id);
    expect(
      useSnippetsStore.getState().snippets.map((s) => s.label)
    ).toEqual(['A', 'C']);

    useSnippetsStore.getState().restoreSnippet(middle, 1, 3);
    const after = useSnippetsStore.getState().snippets;
    expect(after.map((s) => s.label)).toEqual(['A', 'B', 'C']);
    expect(after[1]!.id).toBe(middle.id);
  });

  it('restoreSnippet is a no-op when the id already exists', () => {
    const store = useSnippetsStore.getState();
    store.addSnippet({ language: 'python', label: 'A', description: '', code: 'a' });
    const existing = useSnippetsStore.getState().snippets[0]!;

    useSnippetsStore.getState().restoreSnippet(existing, 0, 1);
    expect(useSnippetsStore.getState().snippets).toHaveLength(1);
  });

  it('restoreSnippet clamps an out-of-range index into the list', () => {
    const store = useSnippetsStore.getState();
    store.addSnippet({ language: 'python', label: 'A', description: '', code: 'a' });
    const removed = useSnippetsStore.getState().snippets[0]!;
    useSnippetsStore.getState().removeSnippet(removed.id);

    // Index 99 is well past the end; it must still land in-range.
    useSnippetsStore.getState().restoreSnippet(removed, 99, 1);
    expect(useSnippetsStore.getState().snippets).toHaveLength(1);
    expect(useSnippetsStore.getState().snippets[0]!.id).toBe(removed.id);
  });

  it('restoreSnippet does not exceed the pre-delete count after a replacement', () => {
    const store = useSnippetsStore.getState();
    store.addSnippet({ language: 'python', label: 'A', description: '', code: 'a' });
    store.addSnippet({ language: 'python', label: 'B', description: '', code: 'b' });
    const removed = useSnippetsStore.getState().snippets[0]!;
    useSnippetsStore.getState().removeSnippet(removed.id);
    store.addSnippet({ language: 'python', label: 'C', description: '', code: 'c' });

    useSnippetsStore.getState().restoreSnippet(removed, 0, 2);

    expect(useSnippetsStore.getState().snippets.map((s) => s.label)).toEqual([
      'B',
      'C',
    ]);
  });

  it('should update a snippet', () => {
    useSnippetsStore.getState().addSnippet({
      language: 'typescript',
      label: 'Original',
      description: 'Original desc',
      code: 'const x = 1;',
    });

    const id = useSnippetsStore.getState().snippets[0].id;
    useSnippetsStore.getState().updateSnippet(id, { label: 'Updated', code: 'const x = 2;' });

    const updated = useSnippetsStore.getState().snippets[0];
    expect(updated.label).toBe('Updated');
    expect(updated.code).toBe('const x = 2;');
    expect(updated.description).toBe('Original desc'); // unchanged
  });

  it('should update snippet language when requested', () => {
    useSnippetsStore.getState().addSnippet({
      language: 'javascript',
      label: 'Original',
      description: '',
      code: 'console.log("test")',
    });

    const id = useSnippetsStore.getState().snippets[0].id;
    useSnippetsStore.getState().updateSnippet(id, { language: 'typescript' });

    expect(useSnippetsStore.getState().snippets[0].language).toBe('typescript');
  });

  it('should assign unique IDs to each snippet', () => {
    useSnippetsStore.getState().addSnippet({ language: 'go', label: 'A', description: '', code: '' });
    useSnippetsStore.getState().addSnippet({ language: 'go', label: 'B', description: '', code: '' });

    const { snippets } = useSnippetsStore.getState();
    expect(snippets[0].id).not.toBe(snippets[1].id);
  });

  it('should return the new snippet id from addSnippet', () => {
    const snippetId = useSnippetsStore.getState().addSnippet({
      language: 'go',
      label: 'Return ID',
      description: '',
      code: 'package main',
    });

    expect(snippetId).toBe(useSnippetsStore.getState().snippets[0].id);
  });

  it('tracks pending deep-link snippet selection outside persisted snippets', () => {
    useSnippetsStore.getState().setPendingLinkedSnippetId('snippet-1');
    expect(useSnippetsStore.getState().pendingLinkedSnippetId).toBe('snippet-1');

    useSnippetsStore.getState().setPendingLinkedSnippetId(null);
    expect(useSnippetsStore.getState().pendingLinkedSnippetId).toBeNull();
  });

  it('blocks addSnippet past the Free ceiling and returns null without mutating state', async () => {
    const { useLicenseStore } = await import('@/stores/licenseStore');
    const { useUIStore } = await import('@/stores/uiStore');
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    useUIStore.setState({ statusNotice: null });

    // Fill exactly to the Free ceiling (5).
    for (let i = 0; i < 5; i += 1) {
      useSnippetsStore.getState().addSnippet({
        label: `snip ${i}`,
        description: '',
        code: '',
        language: 'javascript',
      });
    }
    expect(useSnippetsStore.getState().snippets).toHaveLength(5);

    const blocked = useSnippetsStore.getState().addSnippet({
      label: 'over',
      description: '',
      code: '',
      language: 'javascript',
    });
    expect(blocked).toBeNull();
    expect(useSnippetsStore.getState().snippets).toHaveLength(5);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
  });

  it('RL-065 — emits feature.blocked telemetry when addSnippet hits the Free ceiling', async () => {
    const { useLicenseStore } = await import('@/stores/licenseStore');
    useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
    mockTrackEvent.mockClear();

    for (let i = 0; i < 5; i += 1) {
      useSnippetsStore.getState().addSnippet({
        label: `snip ${i}`,
        description: '',
        code: '',
        language: 'javascript',
      });
    }
    // First 5 fit the budget — no telemetry.
    expect(
      mockTrackEvent.mock.calls.filter(([event]) => event === 'feature.blocked')
    ).toHaveLength(0);

    useSnippetsStore.getState().addSnippet({
      label: 'over',
      description: '',
      code: '',
      language: 'javascript',
    });

    expect(mockTrackEvent).toHaveBeenCalledWith(
      'feature.blocked',
      expect.objectContaining({ entitlement: 'snippets', tier: 'free' })
    );
  });
});
