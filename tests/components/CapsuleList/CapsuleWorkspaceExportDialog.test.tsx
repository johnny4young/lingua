import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const trackEvent = vi.fn();
vi.mock('../../../src/renderer/utils/telemetry', () => ({
  trackEvent: (...args: unknown[]) => trackEvent(...args),
}));

import { CapsuleWorkspaceExportDialog } from '../../../src/renderer/components/CapsuleList/CapsuleWorkspaceExportDialog';
import { useEditorStore, createDefaultTab } from '../../../src/renderer/stores/editorStore';
import { parseCapsuleWorkspace } from '../../../src/shared/capsuleWorkspace';
import { FIXTURE_MINIMAL_JS } from '../../shared/runCapsule.fixtures';

const writeText = vi.fn<(_: string) => Promise<void>>();

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockResolvedValue();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  });
  const primary = {
    ...createDefaultTab('javascript'),
    id: 'primary',
    name: FIXTURE_MINIMAL_JS.tab.name ?? 'main.js',
    content: FIXTURE_MINIMAL_JS.source.content,
    isDirty: false,
  };
  const helper = {
    ...createDefaultTab('typescript'),
    id: 'helper',
    name: 'helper.ts',
    relativePath: 'src/helper.ts',
    filePath: '/Users/private/repo/src/helper.ts',
    content: 'export const answer = 42;',
    isDirty: true,
  };
  useEditorStore.setState({ tabs: [primary, helper], activeTabId: 'helper' });
});

describe('CapsuleWorkspaceExportDialog', () => {
  it('requires explicit selection and review before copying an exact bounded artifact', async () => {
    render(<CapsuleWorkspaceExportDialog capsule={FIXTURE_MINIMAL_JS} onClose={vi.fn()} />);
    const copy = screen.getByTestId('capsule-workspace-copy') as HTMLButtonElement;
    expect(copy.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('capsule-workspace-select-helper'));
    expect(copy.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('capsule-workspace-review-confirmation'));
    expect(copy.disabled).toBe(false);
    fireEvent.click(copy);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const json = writeText.mock.calls[0]![0];
    const parsed = parseCapsuleWorkspace(json);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.files).toHaveLength(1);
    expect(parsed.value.files[0]).toMatchObject({
      path: 'src/helper.ts',
      content: 'export const answer = 42;',
    });
    expect(json).not.toContain('/Users/private');
    expect(trackEvent).toHaveBeenCalledWith('capsule.exported', {
      trigger: 'list-export-workspace',
      sizeBucket: expect.any(String),
    });
  });

  it('resets the review confirmation when the selected payload changes', () => {
    useEditorStore.setState(state => ({
      tabs: [
        ...state.tabs,
        {
          ...createDefaultTab('python'),
          id: 'second',
          name: 'second.py',
          content: 'print(42)',
          isDirty: false,
        },
      ],
    }));
    render(<CapsuleWorkspaceExportDialog capsule={FIXTURE_MINIMAL_JS} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-workspace-select-helper'));
    const review = screen.getByTestId('capsule-workspace-review-confirmation') as HTMLInputElement;
    fireEvent.click(review);
    expect(review.checked).toBe(true);
    fireEvent.click(screen.getByTestId('capsule-workspace-select-second'));
    expect(review.checked).toBe(false);
  });

  it('surfaces possible secrets while preserving the exact preview', () => {
    const secret = 'const token = "ghp_123456789012345678901234567890123456";';
    useEditorStore.setState(state => ({
      tabs: state.tabs.map(tab => (tab.id === 'helper' ? { ...tab, content: secret } : tab)),
    }));
    render(<CapsuleWorkspaceExportDialog capsule={FIXTURE_MINIMAL_JS} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('capsule-workspace-select-helper'));
    expect(screen.getByTestId('capsule-workspace-secret-warning')).toBeTruthy();
    expect(screen.getByTestId('capsule-workspace-preview-content').textContent).toContain(secret);
  });
});
