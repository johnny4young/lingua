import { describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { buildGuidedTourSteps } from '../../src/renderer/components/GuidedTour/guidedTourSteps';

describe('buildGuidedTourSteps', () => {
  it('builds the expected onboarding sequence and keeps the run step interactive', () => {
    const steps = buildGuidedTourSteps({
      t: i18next.t.bind(i18next),
      closeOverlay: vi.fn(),
      openPalette: vi.fn(),
      openSnippets: vi.fn(),
      ensureConsoleVisible: vi.fn(),
      ensureSidebarVisible: vi.fn(),
    });

    expect(steps.map((step) => step.id)).toEqual([
      'tour-editor',
      'tour-run',
      'tour-console',
      'tour-explorer',
      'tour-toolbar',
      'tour-snippets',
      'tour-command-palette',
    ]);

    const runStep = steps[1];
    expect(runStep?.advanceOn).toEqual({
      selector: '[data-tour-id="run-button"]',
      event: 'click',
    });
    expect(runStep?.canClickTarget).toBe(true);
    expect(runStep?.buttons?.some((button) => button.text === 'Next')).toBe(false);
  });
});

