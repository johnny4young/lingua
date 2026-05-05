import type { TFunction } from 'i18next';
import {
  GUIDED_TOUR_SELECTORS,
  waitForGuidedTourSelector,
} from './guidedTourSelectors';

export type GuidedTourButtonKind = 'skip' | 'back' | 'next' | 'finish';

export type GuidedTourPlacement =
  | 'bottom'
  | 'bottom-end'
  | 'right'
  | 'right-start'
  | 'top';

export interface GuidedTourAdvanceOn {
  selector: string;
  event: keyof HTMLElementEventMap;
}

export interface GuidedTourStepOptions {
  id: string;
  title: string;
  text: string;
  attachTo: {
    selector: string;
    on: GuidedTourPlacement;
  };
  beforeShowPromise?: () => Promise<void>;
  advanceOn?: GuidedTourAdvanceOn;
  canClickTarget?: boolean;
  buttons: GuidedTourButtonKind[];
}

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

function attachTo(selector: string, on: GuidedTourPlacement): GuidedTourStepOptions['attachTo'] {
  return {
    selector,
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
      advanceOn: {
        selector: GUIDED_TOUR_SELECTORS.runButton,
        event: 'click',
      },
      canClickTarget: true,
      buttons: ['skip', 'back'],
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
      buttons: ['skip', 'back', 'next'],
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
      buttons: ['skip', 'back', 'next'],
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
      buttons: ['skip', 'back', 'next'],
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
      buttons: ['skip', 'back', 'next'],
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
      buttons: ['skip', 'back', 'finish'],
    },
  ];
}
