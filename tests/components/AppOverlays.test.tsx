import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const lifecycle = vi.hoisted(() => ({ mounts: 0 }));

vi.mock('../../src/renderer/components/CommandPalette/CommandPalette', async () => {
  const React = await import('react');

  return {
    CommandPalette: ({ variant = 'all' }: { variant?: 'all' | 'recent' }) => {
      const [mountId] = React.useState(() => ++lifecycle.mounts);
      return React.createElement(
        'div',
        { 'data-testid': 'mock-command-palette' },
        `${mountId}:${variant}`
      );
    },
  };
});

vi.mock('../../src/renderer/stores/recipeStore', () => {
  const state = {
    overlayOpen: false,
    closeOverlay: vi.fn(),
    openOverlay: vi.fn(),
  };
  const useRecipeStore = Object.assign(
    (selector: (value: typeof state) => unknown) => selector(state),
    { getState: () => state }
  );
  return { useRecipeStore };
});

import { AppOverlays, type AppOverlaysProps } from '../../src/renderer/components/AppOverlays';

const callbacks: Omit<AppOverlaysProps, 'overlay'> = {
  openOverlay: vi.fn(),
  closeOverlay: vi.fn(),
  onStartGuidedTour: vi.fn(),
  onOpenDeveloperUtility: vi.fn(),
  run: vi.fn(),
  isRunning: false,
  exportProjectBundle: vi.fn(),
};

describe('AppOverlays', () => {
  beforeEach(() => {
    lifecycle.mounts = 0;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  // Overlays load behind a lazy boundary, so the first paint of each is a
  // Suspense fallback and the queries have to be async. The behaviour under
  // test is unchanged: switching variant must REMOUNT (mount id 1 -> 2), not
  // reuse the palette with new props.
  it('remounts the command palette when switching to recent commands', async () => {
    const { rerender } = render(<AppOverlays overlay="palette" {...callbacks} />);
    expect((await screen.findByTestId('mock-command-palette')).textContent).toBe('1:all');

    rerender(<AppOverlays overlay="recent-commands" {...callbacks} />);
    expect((await screen.findByTestId('mock-command-palette')).textContent).toBe('2:recent');
  });
});
