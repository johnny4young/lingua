import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { RuntimeModeSelector } from '../../src/renderer/components/Toolbar/RuntimeModeSelector';
import { useEditorStore } from '../../src/renderer/stores/editorStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';

const originalLingua = window.lingua;

describe('desktop runtime selector availability', () => {
  beforeEach(async () => {
    await initI18n('en');
    useUIStore.setState({ statusNotice: null });
    useEditorStore.setState({
      tabs: [{ id: 'js-1', name: 'main.js', language: 'javascript', content: '', isDirty: false }],
      activeTabId: 'js-1',
    });
    Object.defineProperty(window, 'lingua', {
      configurable: true,
      value: {
        platform: 'darwin',
        openExternal: vi.fn().mockResolvedValue(true),
        node: { detect: vi.fn().mockResolvedValue({ installed: false }) },
        deno: { detect: vi.fn().mockResolvedValue({ installed: true }) },
        bun: { detect: vi.fn().mockResolvedValue({ installed: true }) },
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'lingua', { configurable: true, value: originalLingua });
  });

  it('explains missing Node and opens recovery without switching the active tab', async () => {
    const user = userEvent.setup();
    render(<RuntimeModeSelector />);
    await user.click(screen.getByTestId('runtime-mode-selector-button'));
    const node = screen.getByTestId('runtime-mode-option-node');
    await waitFor(() => expect(node.textContent).toContain('Install Node.js'));
    await user.click(node);
    expect(useEditorStore.getState().tabs[0]?.runtimeMode).toBeUndefined();
    expect(useUIStore.getState().statusNotice).toMatchObject({
      messageKey: 'nativeToolchain.missing.message',
      values: { toolchain: 'Node.js' },
    });
  });
});
