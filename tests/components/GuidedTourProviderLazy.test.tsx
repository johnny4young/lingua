import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GuidedTourProvider } from '@/components/GuidedTour/GuidedTourProvider';
import { useGuidedTour } from '@/components/GuidedTour/guidedTourContext';

const mocks = vi.hoisted(() => ({
  loadRuntime: vi.fn(),
  pushStatusNotice: vi.fn(),
}));

const settingsState = {
  hasCompletedTour: false,
};

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('@/stores/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      pushStatusNotice: mocks.pushStatusNotice,
    }),
  },
}));

vi.mock('@/components/GuidedTour/guidedTourRuntimeLoader', () => ({
  loadGuidedTourRuntime: mocks.loadRuntime,
}));

function Harness() {
  const { isTourActive, startTour } = useGuidedTour();
  return (
    <>
      <button type="button" onClick={startTour}>
        Start tour
      </button>
      <output data-testid="tour-active">{String(isTourActive)}</output>
    </>
  );
}

function RuntimeProbe({
  onActiveChange,
  startRequest,
}: {
  onActiveChange: (active: boolean) => void;
  startRequest: number;
}) {
  return (
    <div data-testid="tour-runtime">
      <span data-testid="start-request">{startRequest}</span>
      <button type="button" onClick={() => onActiveChange(true)}>
        Activate runtime
      </button>
    </div>
  );
}

function renderProvider() {
  return render(
    <GuidedTourProvider
      controls={{
        closeOverlay: vi.fn(),
      }}
      hasActiveOverlay={false}
    >
      <Harness />
    </GuidedTourProvider>
  );
}

describe('GuidedTourProvider lazy runtime', () => {
  beforeEach(() => {
    mocks.loadRuntime.mockReset();
    mocks.pushStatusNotice.mockReset();
    vi.restoreAllMocks();
  });

  it('keeps the runtime unloaded until requested and reuses it afterward', async () => {
    mocks.loadRuntime.mockResolvedValue({
      GuidedTourRuntime: RuntimeProbe,
    });

    renderProvider();

    expect(mocks.loadRuntime).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tour-runtime')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Start tour' }));
    expect(await screen.findByTestId('tour-runtime')).toBeTruthy();
    expect(mocks.loadRuntime).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('start-request').textContent).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: 'Activate runtime' }));
    expect(screen.getByTestId('tour-active').textContent).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Start tour' }));
    await waitFor(() => {
      expect(screen.getByTestId('start-request').textContent).toBe('2');
    });
    expect(mocks.loadRuntime).toHaveBeenCalledTimes(1);
  });

  it('surfaces a localized notice and allows retry after a load failure', async () => {
    const error = new Error('tour chunk unavailable');
    mocks.loadRuntime.mockRejectedValueOnce(error).mockResolvedValueOnce({
      GuidedTourRuntime: RuntimeProbe,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderProvider();
    fireEvent.click(screen.getByRole('button', { name: 'Start tour' }));

    await waitFor(() => {
      expect(mocks.pushStatusNotice).toHaveBeenCalledWith({
        tone: 'error',
        messageKey: 'tour.error.loadFailed',
      });
    });
    expect(consoleError).toHaveBeenCalledWith(
      '[guided-tour] failed to load the tour runtime',
      error
    );
    expect(screen.queryByTestId('tour-runtime')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Start tour' }));
    expect(await screen.findByTestId('tour-runtime')).toBeTruthy();
    expect(mocks.loadRuntime).toHaveBeenCalledTimes(2);
  });
});
