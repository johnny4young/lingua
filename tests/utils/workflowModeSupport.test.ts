import { describe, expect, it } from 'vitest';
import {
  coerceWorkflowModeInShell,
  supportsWorkflowModeInShell,
} from '@/utils/workflowModeSupport';

describe('workflowModeSupport', () => {
  it('keeps Python Debug desktop-only', () => {
    expect(supportsWorkflowModeInShell('python', 'debug', false)).toBe(true);
    expect(supportsWorkflowModeInShell('python', 'debug', true)).toBe(false);
    expect(coerceWorkflowModeInShell('debug', 'python', true)).toBe('scratchpad');
  });

  it('preserves shell-independent modes', () => {
    expect(supportsWorkflowModeInShell('javascript', 'debug', true)).toBe(true);
    expect(supportsWorkflowModeInShell('python', 'scratchpad', true)).toBe(true);
  });
});
