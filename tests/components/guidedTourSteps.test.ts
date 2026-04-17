import { describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import type { Step } from 'shepherd.js';
import {
  DONT_SHOW_AGAIN_TESTID,
  buildGuidedTourSteps,
} from '../../src/renderer/components/GuidedTour/guidedTourSteps';

function buildStepsWithHarness(
  overrides: Partial<Parameters<typeof buildGuidedTourSteps>[0]> = {}
) {
  return buildGuidedTourSteps({
    t: i18next.t.bind(i18next),
    closeOverlay: vi.fn(),
    openPalette: vi.fn(),
    openSnippets: vi.fn(),
    ensureConsoleVisible: vi.fn(),
    ensureSidebarVisible: vi.fn(),
    getSuppressTourAutoStart: () => false,
    setSuppressTourAutoStart: vi.fn(),
    ...overrides,
  });
}

describe('buildGuidedTourSteps', () => {
  it('builds the expected onboarding sequence and keeps the run step interactive', () => {
    const steps = buildStepsWithHarness();

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

  it('attaches a when.show hook on every step that injects the don’t-show-again checkbox', () => {
    const setSuppress = vi.fn();
    const getSuppress = vi.fn(() => false);
    const steps = buildStepsWithHarness({
      getSuppressTourAutoStart: getSuppress,
      setSuppressTourAutoStart: setSuppress,
    });

    for (const step of steps) {
      expect(typeof step.when?.show).toBe('function');
    }

    // Simulate Shepherd rendering the first step: build a minimal DOM that
    // matches the markup Shepherd produces (.shepherd-footer inside the step
    // element) and invoke the lifecycle hook with that DOM attached.
    const stepEl = document.createElement('div');
    const footer = document.createElement('div');
    footer.className = 'shepherd-footer';
    stepEl.append(footer);

    const fakeStep = { getElement: () => stepEl } as unknown as Step;
    const hook = steps[0].when?.show;
    hook?.call(fakeStep);

    const checkbox = footer.querySelector<HTMLInputElement>(
      `[data-testid="${DONT_SHOW_AGAIN_TESTID}"] input[type="checkbox"]`
    );
    expect(checkbox).toBeTruthy();
    expect(checkbox?.checked).toBe(false);

    checkbox!.checked = true;
    checkbox!.dispatchEvent(new Event('change'));
    expect(setSuppress).toHaveBeenCalledWith(true);

    // Re-running the hook must be idempotent — the checkbox is not duplicated.
    hook?.call(fakeStep);
    expect(
      footer.querySelectorAll(`[data-testid="${DONT_SHOW_AGAIN_TESTID}"]`).length
    ).toBe(1);
  });

  it('reflects the current persisted suppress flag when the step opens', () => {
    const steps = buildStepsWithHarness({
      getSuppressTourAutoStart: () => true,
      setSuppressTourAutoStart: vi.fn(),
    });

    const stepEl = document.createElement('div');
    const footer = document.createElement('div');
    footer.className = 'shepherd-footer';
    stepEl.append(footer);

    const fakeStep = { getElement: () => stepEl } as unknown as Step;
    steps[0].when?.show?.call(fakeStep);

    const checkbox = footer.querySelector<HTMLInputElement>(
      `[data-testid="${DONT_SHOW_AGAIN_TESTID}"] input[type="checkbox"]`
    );
    expect(checkbox?.checked).toBe(true);
  });
});

