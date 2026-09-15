/**
 * `src/web/main.tsx` is the only module in `src/web` allowed to import renderer
 * stores, telemetry and i18n. These tests boot the real entry point with React
 * rendering stubbed and prove it connects both adapters to the app before the
 * first render.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';

const { render, trackEvent, adapterStateAtRender } = vi.hoisted(() => ({
  render: vi.fn(),
  trackEvent: vi.fn(async () => {}),
  adapterStateAtRender: { updatesMessage: undefined as string | undefined },
}));

vi.mock('react-dom/client', () => ({
  createRoot: () => ({
    render: (tree: unknown) => {
      render(tree);
      // Record what a component would see if it asked on its first render.
      void window.lingua.updates.getState().then((state) => {
        adapterStateAtRender.updatesMessage = state.message;
      });
    },
  }),
}));
vi.mock('../../src/renderer/App', () => ({ App: () => null }));
vi.mock('../../src/renderer/testing/e2eHooks', () => ({ installE2eHooks: () => {} }));
vi.mock('../../src/web/serviceWorker', () => ({
  manageServiceWorker: async () => {},
  shouldRegisterServiceWorkerForMode: () => false,
}));
vi.mock('../../src/renderer/utils/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/renderer/utils/telemetry')>()),
  trackEvent,
}));

import { useUIStore } from '../../src/renderer/stores/uiStore';

describe('web entry point', () => {
  beforeAll(async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    await import('../../src/web/main');
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
  });

  it('connects the adapter to the app translations before the first render', async () => {
    await vi.waitFor(() =>
      expect(adapterStateAtRender.updatesMessage).toBe(
        'Automatic updates are not available in the web version.'
      )
    );
    await expect(window.lingua.go.detect()).resolves.toEqual({
      installed: false,
      error:
        'Go compilation is not available in the web version. Open the file in Lingua Desktop to compile Go code.',
    });
  });

  it('connects the file system adapter to status notices and telemetry', async () => {
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;

    await expect(window.lingua.fs.selectDirectory()).resolves.toEqual({ canceled: true });

    expect(useUIStore.getState().statusNotice).toMatchObject({
      tone: 'warning',
      messageKey: 'fileTree.web.directoryUnsupported',
    });
    expect(trackEvent).toHaveBeenCalledWith('runtime.fs_directory_picker_unsupported', {
      userAgentBucket: 'other',
    });
  });
});
