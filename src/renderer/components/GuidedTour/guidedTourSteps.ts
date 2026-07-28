import type { TFunction } from 'i18next';
import {
  GUIDED_TOUR_SELECTORS,
  waitForGuidedTourSelector,
} from './guidedTourSelectors';

export type GuidedTourButtonKind = 'skip' | 'back' | 'next' | 'run' | 'finish';

export type GuidedTourPlacement =
  | 'bottom'
  | 'bottom-end'
  | 'right'
  | 'right-start'
  | 'top';

export interface GuidedTourStepOptions {
  id: string;
  title: string;
  text: string;
  attachTo: {
    selector: string;
    on: GuidedTourPlacement;
  };
  beforeShowPromise?: () => Promise<void>;
  actionTarget?: string;
  buttons: GuidedTourButtonKind[];
}

interface GuidedTourStepControls {
  ensureConsoleVisible: () => void;
}

interface BuildGuidedTourStepsOptions extends GuidedTourStepControls {
  t: TFunction;
  /** Initial value of the don't-show-again checkbox; reflects settings. */
  getSuppressTourAutoStart: () => boolean;
  /** Called when the user ticks or clears the checkbox inside a step. */
  setSuppressTourAutoStart: (value: boolean) => void;
}

export const DONT_SHOW_AGAIN_TESTID = 'guided-tour-dont-show-again';

function attachTo(selector: string, on: GuidedTourPlacement): GuidedTourStepOptions['attachTo'] {
  return {
    selector,
    on,
  };
}

export function buildGuidedTourSteps({
  t,
  ensureConsoleVisible,
  getSuppressTourAutoStart,
  setSuppressTourAutoStart,
}: BuildGuidedTourStepsOptions): GuidedTourStepOptions[] {
  // Keep these callbacks in the signature so the builder owns the complete tour
  // contract. The provider reads the current checkbox state directly when it
  // renders each step, so no DOM injection hook is needed.
  void getSuppressTourAutoStart;
  void setSuppressTourAutoStart;

  return [
    {
      id: 'tour-editor',
      title: t('tour.step.editor.title'),
      text: t('tour.step.editor.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.editor, 'right-start'),
      buttons: ['skip', 'next'],
    },
    {
      id: 'tour-run',
      title: t('tour.step.run.title'),
      text: t('tour.step.run.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.runButton, 'bottom'),
      actionTarget: GUIDED_TOUR_SELECTORS.runButton,
      buttons: ['skip', 'back', 'run'],
    },
    {
      id: 'tour-console',
      title: t('tour.step.console.title'),
      text: t('tour.step.console.text'),
      attachTo: attachTo(GUIDED_TOUR_SELECTORS.console, 'top'),
      beforeShowPromise: async () => {
        ensureConsoleVisible();
        await waitForGuidedTourSelector(GUIDED_TOUR_SELECTORS.console);
      },
      buttons: ['skip', 'back', 'finish'],
    },
  ];
}
