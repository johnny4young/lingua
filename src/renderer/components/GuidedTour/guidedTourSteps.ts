import type { TFunction } from 'i18next';
import type { Step, StepOptions, Tour } from 'shepherd.js';
import {
  GUIDED_TOUR_SELECTORS,
  waitForGuidedTourSelector,
} from './guidedTourSelectors';

interface GuidedTourStepControls {
  closeOverlay: () => void;
  openPalette: () => void;
  openSnippets: () => void;
  ensureConsoleVisible: () => void;
  ensureSidebarVisible: () => void;
}

interface BuildGuidedTourStepsOptions extends GuidedTourStepControls {
  t: TFunction;
  /** Initial value of the don't-show-again checkbox; reflects settings. */
  getSuppressTourAutoStart: () => boolean;
  /** Called when the user ticks or clears the checkbox inside a step. */
  setSuppressTourAutoStart: (value: boolean) => void;
}

export const DONT_SHOW_AGAIN_TESTID = 'guided-tour-dont-show-again';

/**
 * Injects a "Don't show again" checkbox into Shepherd's footer. Shepherd owns
 * the DOM for each step; we attach the checkbox via the `when.show` lifecycle
 * hook so it gets rebuilt whenever the step is reopened (preventing stale
 * listeners). The handler calls the settings store directly so toggling is
 * persisted immediately — no extra confirm-on-close path to keep in sync.
 */
export function attachDontShowAgain(
  step: Step,
  t: TFunction,
  getSuppressTourAutoStart: () => boolean,
  setSuppressTourAutoStart: (value: boolean) => void
): void {
  // Shepherd 15 exposes the mounted step root through `getElement()`; older
  // versions used `step.el`. Keep both in the fallback chain so the injection
  // stays robust across minor upgrades.
  const element =
    step.getElement?.() ??
    (step as unknown as { el?: HTMLElement | null }).el ??
    null;
  if (!element) return;
  const footer = element.querySelector<HTMLElement>('.shepherd-footer');
  if (!footer) return;
  if (footer.querySelector(`[data-testid="${DONT_SHOW_AGAIN_TESTID}"]`)) return;

  const wrapper = document.createElement('label');
  wrapper.className = 'guided-tour-dont-show-again';
  wrapper.setAttribute('data-testid', DONT_SHOW_AGAIN_TESTID);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'guided-tour-dont-show-again-input';
  input.checked = getSuppressTourAutoStart();
  input.addEventListener('change', () => {
    setSuppressTourAutoStart(input.checked);
  });

  const text = document.createElement('span');
  text.textContent = t('tour.options.dontShowAgain');

  wrapper.append(input, text);
  footer.prepend(wrapper);
}

function backButton(t: TFunction) {
  return {
    action(this: Tour) {
      this.back();
    },
    classes: 'guided-tour-button guided-tour-button-secondary shepherd-button-secondary',
    text: t('tour.buttons.back'),
  };
}

function nextButton(t: TFunction) {
  return {
    action(this: Tour) {
      this.next();
    },
    classes: 'guided-tour-button guided-tour-button-primary',
    text: t('tour.buttons.next'),
  };
}

function finishButton(t: TFunction) {
  return {
    action(this: Tour) {
      this.complete();
    },
    classes: 'guided-tour-button guided-tour-button-primary',
    text: t('tour.buttons.finish'),
  };
}

function skipButton(t: TFunction) {
  return {
    action(this: Tour) {
      void this.cancel();
    },
    classes: 'guided-tour-button guided-tour-button-ghost shepherd-button-secondary',
    text: t('tour.buttons.skip'),
  };
}

function attachTo(selector: string, on: NonNullable<StepOptions['attachTo']>['on']): StepOptions['attachTo'] {
  return {
    element: () => document.querySelector<HTMLElement>(selector),
    on,
  };
}

export function buildGuidedTourSteps({
  t,
  closeOverlay,
  openPalette,
  openSnippets,
  ensureConsoleVisible,
  ensureSidebarVisible,
  getSuppressTourAutoStart,
  setSuppressTourAutoStart,
}: BuildGuidedTourStepsOptions): StepOptions[] {
  function handleStepShow(this: Step) {
    // Defer to the next tick so Shepherd has finished mounting the step's
    // DOM before we look up the footer. In Shepherd 15 `getElement()` can
    // return null during the synchronous show() callback. The tour-level
    // MutationObserver in `GuidedTourProvider` is the primary injection
    // path; this hook is kept as a belt-and-suspenders fallback since
    // `attachDontShowAgain` is idempotent.
    attachDontShowAgain(this, t, getSuppressTourAutoStart, setSuppressTourAutoStart);
  }
  const whenShow = { show: handleStepShow };
  const withCheckbox = (options: StepOptions): StepOptions => ({
    ...options,
    when: {
      ...(options.when ?? {}),
      ...whenShow,
    },
  });
  return [
    withCheckbox({
      id: 'tour-editor',
      title: t('tour.step.editor.title'),
      text: t('tour.step.editor.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.editor, 'right-start'),
      buttons: [skipButton(t), nextButton(t)],
    }),
    withCheckbox({
      id: 'tour-run',
      title: t('tour.step.run.title'),
      text: t('tour.step.run.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.runButton, 'bottom'),
      advanceOn: {
        selector: GUIDED_TOUR_SELECTORS.runButton,
        event: 'click',
      },
      canClickTarget: true,
      buttons: [skipButton(t), backButton(t)],
    }),
    withCheckbox({
      id: 'tour-console',
      title: t('tour.step.console.title'),
      text: t('tour.step.console.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.console, 'top'),
      beforeShowPromise: async () => {
        closeOverlay();
        ensureConsoleVisible();
        await waitForGuidedTourSelector(GUIDED_TOUR_SELECTORS.console);
      },
      buttons: [skipButton(t), backButton(t), nextButton(t)],
    }),
    withCheckbox({
      id: 'tour-explorer',
      title: t('tour.step.explorer.title'),
      text: t('tour.step.explorer.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.explorer, 'right'),
      beforeShowPromise: async () => {
        closeOverlay();
        ensureSidebarVisible();
        await waitForGuidedTourSelector(GUIDED_TOUR_SELECTORS.explorer);
      },
      buttons: [skipButton(t), backButton(t), nextButton(t)],
    }),
    withCheckbox({
      id: 'tour-toolbar',
      title: t('tour.step.toolbar.title'),
      text: t('tour.step.toolbar.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.toolbarActions, 'bottom-end'),
      beforeShowPromise: async () => {
        closeOverlay();
        await waitForGuidedTourSelector(GUIDED_TOUR_SELECTORS.toolbarActions);
      },
      buttons: [skipButton(t), backButton(t), nextButton(t)],
    }),
    withCheckbox({
      id: 'tour-snippets',
      title: t('tour.step.snippets.title'),
      text: t('tour.step.snippets.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.snippetsSave, 'right-start'),
      beforeShowPromise: async () => {
        closeOverlay();
        openSnippets();
        await waitForGuidedTourSelector(GUIDED_TOUR_SELECTORS.snippetsSave);
      },
      buttons: [skipButton(t), backButton(t), nextButton(t)],
    }),
    withCheckbox({
      id: 'tour-command-palette',
      title: t('tour.step.commandPalette.title'),
      text: t('tour.step.commandPalette.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.commandPaletteSearch, 'bottom'),
      beforeShowPromise: async () => {
        closeOverlay();
        openPalette();
        await waitForGuidedTourSelector(GUIDED_TOUR_SELECTORS.commandPaletteSearch);
      },
      buttons: [skipButton(t), backButton(t), finishButton(t)],
    }),
  ];
}
