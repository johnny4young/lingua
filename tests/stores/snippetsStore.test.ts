import { describe, it, expect, beforeEach } from 'vitest';
import { useSnippetsStore } from '@/stores/snippetsStore';

describe('snippetsStore', () => {
  beforeEach(() => {
    useSnippetsStore.setState({ snippets: [] });
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

  it('should assign unique IDs to each snippet', () => {
    useSnippetsStore.getState().addSnippet({ language: 'go', label: 'A', description: '', code: '' });
    useSnippetsStore.getState().addSnippet({ language: 'go', label: 'B', description: '', code: '' });

    const { snippets } = useSnippetsStore.getState();
    expect(snippets[0].id).not.toBe(snippets[1].id);
  });
});
