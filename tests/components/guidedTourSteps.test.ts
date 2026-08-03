import { describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import {
  DONT_SHOW_AGAIN_TESTID,
  buildGuidedTourSteps,
} from '../../src/renderer/components/GuidedTour/guidedTourSteps';

function buildStepsWithHarness(
  overrides: Partial<Parameters<typeof buildGuidedTourSteps>[0]> = {}
) {
  return buildGuidedTourSteps({
    t: i18next.t.bind(i18next),
    ensureConsoleVisible: vi.fn(),
    getSuppressTourAutoStart: () => false,
    setSuppressTourAutoStart: vi.fn(),
    ...overrides,
  });
}

describe('buildGuidedTourSteps', () => {
  it('builds a focused editor-to-run-to-console sequence', () => {
    const steps = buildStepsWithHarness();

    expect(steps.map((step) => step.id)).toEqual([
      'tour-editor',
      'tour-run',
      'tour-console',
    ]);

    const runStep = steps[1];
    expect(runStep?.actionTarget).toBe('[data-tour-id="run-button"]');
    expect(runStep?.buttons).toEqual(['skip', 'back', 'run']);
  });

  it('uses stable button kinds that the provider can render with local controls', () => {
    const steps = buildStepsWithHarness();

    expect(steps[0]?.buttons).toEqual(['skip', 'next']);
    expect(steps.at(-1)?.buttons).toEqual(['skip', 'back', 'finish']);
    expect(DONT_SHOW_AGAIN_TESTID).toBe('guided-tour-dont-show-again');
  });

  it('runs step preparation callbacks before surfacing dependent UI', async () => {
    document.body.innerHTML = '<div id="guided-tour-console"></div>';
    const ensureConsoleVisible = vi.fn();
    const steps = buildStepsWithHarness({
      ensureConsoleVisible,
    });

    await steps[2]?.beforeShowPromise?.();

    expect(ensureConsoleVisible).toHaveBeenCalledTimes(1);
  });

  it('keeps the suppress-tour callbacks in the builder contract', () => {
    const setSuppress = vi.fn();
    const getSuppress = vi.fn(() => false);
    buildStepsWithHarness({
      getSuppressTourAutoStart: getSuppress,
      setSuppressTourAutoStart: setSuppress,
    });

    expect(getSuppress).not.toHaveBeenCalled();
    expect(setSuppress).not.toHaveBeenCalled();
  });
});
