import type { TFunction } from 'i18next';
import type { StepOptions, Tour } from 'shepherd.js';
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
}: BuildGuidedTourStepsOptions): StepOptions[] {
  return [
    {
      id: 'tour-editor',
      title: t('tour.step.editor.title'),
      text: t('tour.step.editor.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.editor, 'right-start'),
      buttons: [skipButton(t), nextButton(t)],
    },
    {
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
    },
    {
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
    },
    {
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
    },
    {
      id: 'tour-toolbar',
      title: t('tour.step.toolbar.title'),
      text: t('tour.step.toolbar.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.toolbarActions, 'bottom-end'),
      beforeShowPromise: async () => {
        closeOverlay();
        await waitForGuidedTourSelector(GUIDED_TOUR_SELECTORS.toolbarActions);
      },
      buttons: [skipButton(t), backButton(t), nextButton(t)],
    },
    {
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
    },
    {
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
    },
  ];
}
