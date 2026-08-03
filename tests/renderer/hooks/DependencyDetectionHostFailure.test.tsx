import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DependencyDetectionHost } from '../../../src/renderer/hooks/DependencyDetectionHost';
import { useSettingsStore } from '../../../src/renderer/stores/settingsStore';

vi.mock('../../../src/renderer/hooks/DependencyDetectionHookRuntime', () => {
  throw new Error('simulated dependency-detection chunk failure');
});

describe('DependencyDetectionHost chunk failure', () => {
  let idleCallback: (() => void) | undefined;

  beforeEach(() => {
    idleCallback = undefined;
    vi.stubGlobal(
      'requestIdleCallback',
      vi.fn((callback: () => void) => {
        idleCallback = callback;
        return 1;
      })
    );
    vi.stubGlobal('cancelIdleCallback', vi.fn());
    useSettingsStore.setState({ dependencyDetectionEnabled: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the surrounding shell mounted when the optional chunk rejects', async () => {
    render(
      <>
        <div data-testid="shell-content">Workspace</div>
        <DependencyDetectionHost />
      </>
    );

    await act(async () => {
      idleCallback?.();
      await Promise.resolve();
    });

    expect(screen.getByTestId('shell-content').textContent).toBe('Workspace');
  });
});
