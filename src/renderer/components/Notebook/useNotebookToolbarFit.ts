import type { RefObject } from 'react';
import { useOverflowStepFit } from '../../hooks/useOverflowStepFit';

/** The meta goes first, then kernel actions fold into ⋯, then the run range, and last the notice takes its own row. */
const STEPS = ['full', 'nometa', 'menu', 'runmenu', 'stacked'] as const;

export interface NotebookToolbarFit {
  readonly step: (typeof STEPS)[number];
  readonly showsMeta: boolean;
  readonly kernelInMenu: boolean;
  readonly runRangeInMenu: boolean;
}

/** Below this toolbar width the kernel actions always sit in ⋯. */
const MENU_BELOW_PX = 900;
const MENU = STEPS.indexOf('menu');
const RUN_MENU = STEPS.indexOf('runmenu');

const floorFor = (width: number) => (width > 0 && width < MENU_BELOW_PX ? MENU : 0);

/** The first step at which the row fits; `content` is whatever changes its natural width. */
export function useNotebookToolbarFit(rowRef: RefObject<HTMLElement | null>, content: string): NotebookToolbarFit {
  const index = useOverflowStepFit(rowRef, content, STEPS.length, floorFor);
  return {
    step: STEPS[index] ?? 'full',
    showsMeta: index === 0,
    kernelInMenu: index >= MENU,
    runRangeInMenu: index >= RUN_MENU,
  };
}
